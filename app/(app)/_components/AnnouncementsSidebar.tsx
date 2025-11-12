// app/(app)/_components/AnnouncementsSidebar.tsx
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { getServerSupabase } from '@/supabase/server';

/** DB row shape from `announcements_active_v` */
type Announcement = {
    id: string;
    title: string;
    body: string;
    pinned: boolean;
    starts_at: string | null;
    ends_at: string | null;
    company_id: string | null;
    home_id: string | null;
};

type Level = '1_ADMIN' | '2_COMPANY' | '3_MANAGER' | '4_STAFF';

type CompanyRow = { id: string; name: string | null };
type HomeRow = { id: string; name: string | null };

/** Safely narrow unknown → Level (fallback to '4_STAFF') */
function asLevel(x: unknown): Level {
    if (typeof x === 'string') {
        if (x === '1_ADMIN' || x === '2_COMPANY' || x === '3_MANAGER' || x === '4_STAFF') {
            return x;
        }
    }
    return '4_STAFF';
}

/** Revalidate the (app) layout so the rail updates instantly everywhere */
function revalidateAll() {
    revalidatePath('/', 'layout');
}

export default async function AnnouncementsSidebar() {
    const supabase = await getServerSupabase();

    // Effective level (typed via guard; no generics on rpc)
    const { data: levelRaw } = await supabase.rpc('get_effective_level');
    const level: Level = asLevel(levelRaw);
    const isAdmin = level === '1_ADMIN';
    const isCompany = level === '2_COMPANY';
    const isManager = level === '3_MANAGER';
    const canCreate = isAdmin || isCompany || isManager;

    // Fetch announcements (scrollable list)
    const { data: announcements, error } = await supabase
        .from('announcements_active_v')
        .select('id, title, body, pinned, starts_at, ends_at, company_id, home_id')
        .order('pinned', { ascending: false })
        .order('starts_at', { ascending: false })
        .limit(20)
        .returns<Announcement[]>();

    if (error) {
        // Fail quietly if view/policies aren’t ready.
        return null;
    }

    // Creator pickers (respect RLS; typed)
    let companies: CompanyRow[] = [];
    let homes: HomeRow[] = [];
    if (canCreate) {
        if (isCompany || isAdmin) {
            const { data: comps } = await supabase
                .from('companies')
                .select('id, name')
                .order('name', { ascending: true })
                .limit(50)
                .returns<CompanyRow[]>();
            companies = comps ?? [];
        }
        if (isManager || isAdmin) {
            const { data: hs } = await supabase
                .from('homes')
                .select('id, name')
                .order('name', { ascending: true })
                .limit(100)
                .returns<HomeRow[]>();
            homes = hs ?? [];
        }
    }

    /** Server Action: dismiss (clear) — non-admins cannot dismiss global admin posts */
    async function dismissAnnouncement(formData: FormData) {
        'use server';
        const s = await getServerSupabase();
        const { data: ur } = await s.auth.getUser();
        const my = ur.user?.id;
        const announcement_id = String(formData.get('announcement_id') ?? '');
        const scope_company_id = String(formData.get('scope_company_id') ?? '');
        const scope_home_id = String(formData.get('scope_home_id') ?? '');

        const { data: myLevelRaw } = await s.rpc('get_effective_level');
        const myLevel: Level = asLevel(myLevelRaw);

        if (!my || !announcement_id) return;

        const isGlobalAdminAnnouncement = scope_company_id === '' && scope_home_id === '';
        if (isGlobalAdminAnnouncement && myLevel !== '1_ADMIN') {
            return; // silently ignore for non-admins
        }

        await s.from('announcement_reads').upsert({
            announcement_id,
            user_id: my,
            read_at: new Date().toISOString(),
            dismissed: true,
        });

        revalidateAll();
    }

    /** Server Action: delete announcement
     *  Allow Admin/Company/Manager in UI; rely on RLS to enforce scope.
     */
    async function deleteAnnouncement(formData: FormData) {
        'use server';
        const s = await getServerSupabase();
        const { data: ur } = await s.auth.getUser();
        const my = ur.user?.id;
        if (!my) return;

        const announcement_id = String(formData.get('announcement_id') ?? '');
        if (!announcement_id) return;

        await s.from('announcements').delete().eq('id', announcement_id).limit(1);

        revalidateAll();
    }

    /** Server Action: create announcement (pinned; duration clamped 1..30) */
    async function createAnnouncement(formData: FormData) {
        'use server';
        const s = await getServerSupabase();
        const { data: ur } = await s.auth.getUser();
        const my = ur.user?.id;
        if (!my) return;

        const { data: lvlRaw } = await s.rpc('get_effective_level');
        const lvl: Level = asLevel(lvlRaw);

        const titleInput = (formData.get('title')?.toString() ?? '').trim();
        const body = (formData.get('body')?.toString() ?? '').trim();
        if (!body) return;

        const daysRaw = Number(formData.get('days') ?? 1);
        const days = Math.max(1, Math.min(30, Number.isFinite(daysRaw) ? daysRaw : 1));

        const now = new Date();
        const ends = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
        const title = titleInput || (body.length > 60 ? `${body.slice(0, 60)}…` : body);
        const pin = true;

        if (lvl === '1_ADMIN') {
            await s.from('announcements').insert({
                title,
                body,
                pinned: pin,
                company_id: null,
                home_id: null,
                starts_at: now.toISOString(),
                ends_at: ends,
            });
            revalidateAll();
            return;
        }

        if (lvl === '2_COMPANY') {
            const company_id = (formData.get('company_id')?.toString() ?? '').trim();
            if (!company_id) return;
            await s.from('announcements').insert({
                title,
                body,
                pinned: pin,
                company_id,
                home_id: null,
                starts_at: now.toISOString(),
                ends_at: ends,
            });
            revalidateAll();
            return;
        }

        if (lvl === '3_MANAGER') {
            // Managers: one or more homes; default to all visible homes if none selected
            const selected = formData.getAll('home_ids').map((v) => String(v));
            let targetHomes = selected;

            if (targetHomes.length === 0) {
                type HomeIdRow = { id: string };
                const { data: hs } = await s.from('homes').select('id').limit(100).returns<HomeIdRow[]>();
                targetHomes = (hs ?? []).map((h) => h.id);
            }

            if (targetHomes.length === 0) return;

            const rows = targetHomes.map((home_id) => ({
                title,
                body,
                pinned: pin,
                company_id: null,
                home_id,
                starts_at: now.toISOString(),
                ends_at: ends,
            }));

            await s.from('announcements').insert(rows);
            revalidateAll();
        }
    }

    return (
        // Wrapper aligns under the header; includes sliding panel + modal
        <aside className="hidden 2xl:block fixed right-0 top-14 bottom-0 z-20">
            {/* Slide toggle (CSS-only) */}
            <input id="ann-rail-toggle" type="checkbox" className="sr-only peer" />

            {/* Sliding panel */}
            <div
                className="absolute right-0 top-0 bottom-0 w-[250px] border-l p-3 overflow-y-auto
           transition-transform duration-300 ease-out
           peer-checked:translate-x-full"
                style={{ background: 'var(--panel-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
            >
                <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold">Announcements</h2>
                    <Link href="/announcements" className="text-xs underline" style={{ color: 'var(--sub)' }}>
                        View all
                    </Link>
                </div>

                {(!announcements || announcements.length === 0) && (
                    <p className="text-xs mt-2" style={{ color: 'var(--sub)' }}>
                        No announcements.
                    </p>
                )}

                <div className="mt-3 flex flex-col gap-3">
                    {announcements?.map((a) => {
                        const isGlobalAdminAnnouncement = !a.company_id && !a.home_id;
                        return (
                            <form
                                key={a.id}
                                className="rounded-lg p-3 ring-1 hover:ring-2 transition"
                                style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}
                            >
                                <input type="hidden" name="announcement_id" value={a.id} />
                                <input type="hidden" name="scope_company_id" value={a.company_id ?? ''} />
                                <input type="hidden" name="scope_home_id" value={a.home_id ?? ''} />

                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                        {a.pinned && <span className="text-xs">📌</span>}
                                        <h3 className="text-sm font-medium break-words">{a.title}</h3>
                                    </div>
                                    <ScopePill company_id={a.company_id} home_id={a.home_id} />
                                </div>

                                <p className="mt-1 text-xs leading-5 break-words" style={{ color: 'var(--sub)' }}>
                                    {a.body.length > 220 ? `${a.body.slice(0, 220)}…` : a.body}
                                </p>

                                {/* controls */}
                                <div className="mt-3 flex items-center gap-2">
                                    {/* Dismiss: everyone except non-admins on global admin post */}
                                    {(!isGlobalAdminAnnouncement || isAdmin) ? (
                                        <button
                                            formAction={dismissAnnouncement}
                                            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] ring-1 hover:ring-2 transition"
                                            style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                                            title="Hide this announcement for me"
                                        >
                                            <span aria-hidden>✖</span>
                                            <span>Dismiss</span>
                                        </button>
                                    ) : (
                                        <span className="text-[11px]" style={{ color: 'var(--sub)' }}>Admin notice</span>
                                    )}

                                    {/* Delete offered for Admin/Company/Manager; RLS enforces actual permission */}
                                    {(isAdmin || isCompany || isManager) && (
                                        <button
                                            formAction={deleteAnnouncement}
                                            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] ring-1 hover:ring-2 transition"
                                            style={{
                                                background: 'linear-gradient(135deg, rgba(244,63,94,0.08), rgba(244,63,94,0.12))',
                                                borderColor: 'var(--ring)',
                                                color: 'var(--ink)',
                                            }}
                                            title="Delete from database for everyone"
                                        >
                                            <span aria-hidden>🗑️</span>
                                            <span>Delete</span>
                                        </button>
                                    )}
                                </div>
                            </form>
                        );
                    })}
                </div>

                {/* Bottom: Create Announcement (role-gated) */}
                {canCreate && (
                    <div className="mt-4">
                        <div className="relative">
                            <input id="ann-create-toggle" type="checkbox" className="sr-only peer" />
                            <label
                                htmlFor="ann-create-toggle"
                                className="inline-flex items-center justify-center px-3 py-2 rounded-md ring-1 text-xs font-medium cursor-pointer"
                                style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                            >
                                Create an Announcement
                            </label>

                            {/* Overlay + Modal */}
                            <div className="fixed inset-0 z-50 hidden items-center justify-center bg-black/40 backdrop-blur-sm peer-checked:flex">
                                <div
                                    className="w-[min(92vw,560px)] max-h-[80vh] overflow-auto rounded-xl p-4 ring-1"
                                    style={{ background: 'var(--panel-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <h3 className="text-sm font-semibold">Create announcement</h3>
                                        <label
                                            htmlFor="ann-create-toggle"
                                            className="text-xs cursor-pointer underline"
                                            style={{ color: 'var(--sub)' }}
                                        >
                                            Close
                                        </label>
                                    </div>

                                    <form action={createAnnouncement} className="space-y-3">
                                        {/* Title (optional) */}
                                        <div>
                                            <label className="text-xs block mb-1" style={{ color: 'var(--sub)' }}>
                                                Title (optional)
                                            </label>
                                            <input
                                                name="title"
                                                type="text"
                                                className="w-full rounded-md px-3 py-2 ring-1"
                                                style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                                                placeholder="Short title"
                                                maxLength={120}
                                            />
                                        </div>

                                        {/* Message */}
                                        <div>
                                            <label className="text-xs block mb-1" style={{ color: 'var(--sub)' }}>
                                                Message
                                            </label>
                                            <textarea
                                                name="body"
                                                required
                                                className="w-full min-h-[120px] rounded-md px-3 py-2 ring-1"
                                                style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                                                placeholder="Type your announcement..."
                                                maxLength={4000}
                                            />
                                        </div>

                                        {/* Duration */}
                                        <div className="flex items-center gap-2">
                                            <label htmlFor="days" className="text-xs" style={{ color: 'var(--sub)' }}>
                                                Display for (days)
                                            </label>
                                            <input
                                                id="days"
                                                name="days"
                                                type="number"
                                                min={1}
                                                max={30}
                                                defaultValue={7}
                                                className="w-20 rounded-md px-2 py-1 ring-1"
                                                style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                                            />
                                            <span className="text-[11px]" style={{ color: 'var(--sub)' }}>
                                                Max 30 days
                                            </span>
                                        </div>

                                        {/* Scope helpers */}
                                        {isAdmin && (
                                            <p className="text-xs" style={{ color: 'var(--sub)' }}>
                                                Scope: <strong>Everyone</strong>. Admin announcements are pinned.
                                            </p>
                                        )}

                                        {isCompany && (
                                            <div>
                                                <label className="text-xs block mb-1" style={{ color: 'var(--sub)' }}>
                                                    Company
                                                </label>
                                                <select
                                                    name="company_id"
                                                    required
                                                    className="w-full rounded-md px-3 py-2 ring-1"
                                                    style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                                                >
                                                    <option value="" disabled>
                                                        Select company…
                                                    </option>
                                                    {companies.map((c) => (
                                                        <option key={c.id} value={c.id}>
                                                            {c.name ?? 'Unnamed company'}
                                                        </option>
                                                    ))}
                                                </select>
                                                <p className="text-[11px] mt-1" style={{ color: 'var(--sub)' }}>
                                                    Visible to all members of the selected company.
                                                </p>
                                            </div>
                                        )}

                                        {isManager && (
                                            <div>
                                                <label className="text-xs block mb-1" style={{ color: 'var(--sub)' }}>
                                                    Homes (select one or more)
                                                </label>
                                                <select
                                                    name="home_ids"
                                                    multiple
                                                    className="w-full rounded-md px-3 py-2 ring-1 min-h-[100px]"
                                                    style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                                                >
                                                    {homes.map((h) => (
                                                        <option key={h.id} value={h.id}>
                                                            {h.name ?? 'Unnamed home'}
                                                        </option>
                                                    ))}
                                                </select>
                                                <p className="text-[11px] mt-1" style={{ color: 'var(--sub)' }}>
                                                    If none selected, it will post to all homes you manage.
                                                </p>
                                            </div>
                                        )}

                                        <div className="pt-1 flex items-center justify-end gap-2">
                                            <label
                                                htmlFor="ann-create-toggle"
                                                className="px-3 py-2 rounded-md ring-1 text-xs cursor-pointer"
                                                style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                                            >
                                                Cancel
                                            </label>

                                            {/* This label toggles the checkbox BEFORE the form submits, closing the modal instantly */}
                                            <label htmlFor="ann-create-toggle" className="inline-block">
                                                <input
                                                    type="submit"
                                                    value="Post announcement"
                                                    className="px-3 py-2 rounded-md text-xs font-semibold shadow-sm cursor-pointer"
                                                    style={{
                                                        background: 'linear-gradient(135deg, #7C3AED 0%, #6366F1 50%, #3B82F6 100%)',
                                                        border: '1px solid rgba(255,255,255,0.14)',
                                                        color: '#fff',
                                                        boxShadow: '0 6px 20px rgba(99,102,241,0.35)',
                                                    }}
                                                />
                                            </label>
                                        </div>
                                    </form>
                                </div>
                            </div>
                            {/* /overlay */}
                        </div>
                    </div>
                )}
            </div>

            {/* Slide handle (thinner; ~8px) */}
            <label
                htmlFor="ann-rail-toggle"
                className="absolute top-1/2 -translate-y-1/2 h-12 w-2
           flex items-center justify-center cursor-pointer
           transition-all duration-300 ease-out
           rounded-l-md border-l border-y
           right-[250px] peer-checked:right-0
           hover:scale-105"
                style={{
                    background: 'var(--panel-bg)',
                    borderColor: 'var(--ring)',
                    color: 'var(--ink)',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
                }}
                aria-label="Toggle announcements sidebar"
                title="Toggle announcements"
            >
                <svg
                    viewBox="0 0 24 24"
                    className="h-2 w-2 transition-transform duration-300 rotate-180 peer-checked:rotate-0"
                    aria-hidden="true"
                >
                    <path
                        d="M9 6l6 6-6 6"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
            </label>
        </aside>
    );
}

/* --- tiny UI helpers (server-rendered) --- */
function Pill({ children }: { children: React.ReactNode }) {
    return (
        <span
            className="text-[10px] font-medium px-2 py-0.5 rounded-full ring-1"
            style={{ background: 'var(--nav-item-bg)', color: 'var(--sub)', borderColor: 'var(--ring)' }}
        >
            {children}
        </span>
    );
}

function ScopePill(props: { company_id: string | null; home_id: string | null }) {
    const { company_id, home_id } = props;
    if (home_id) return <Pill>Home</Pill>;
    if (company_id) return <Pill>Company</Pill>;
    return <Pill>Global</Pill>;
}

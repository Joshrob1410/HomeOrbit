// app/(app)/_components/Sidebar.tsx
import Link from 'next/link';
import type { ReactNode } from 'react';
import Image from 'next/image';
import { getServerSupabase } from '@/supabase/server';

/**
 * Server component - no hooks.
 * lg+ fixed sidebar, hidden on mobile.
 * Role-aware + Theme-aware (gets theme via prop from layout),
 * while visuals (bg/borders/text) are driven by CSS variables for instant repaint.
 */

// Tone variant helper
type Tone =
    | 'indigo'
    | 'violet'
    | 'fuchsia'
    | 'emerald'
    | 'cyan'
    | 'amber'
    | 'rose'
    | 'slate'
    | 'teal'
    | 'sky';

function getTone(tone: Tone, dark: boolean) {
    // Dark (Orbit): darker chip bg + stronger ring + brighter text + punchier hover ring
    if (dark) {
        switch (tone) {
            case 'indigo':
                return {
                    chipBg: 'bg-indigo-500/30',
                    chipRing: 'ring-indigo-400/50',
                    chipText: 'text-indigo-200',
                    rowHoverRing: 'hover:ring-indigo-400/40',
                };
            case 'violet':
                return {
                    chipBg: 'bg-violet-500/30',
                    chipRing: 'ring-violet-400/50',
                    chipText: 'text-violet-200',
                    rowHoverRing: 'hover:ring-violet-400/40',
                };
            case 'fuchsia':
                return {
                    chipBg: 'bg-fuchsia-500/30',
                    chipRing: 'ring-fuchsia-400/50',
                    chipText: 'text-fuchsia-200',
                    rowHoverRing: 'hover:ring-fuchsia-400/40',
                };
            case 'emerald':
                return {
                    chipBg: 'bg-emerald-500/30',
                    chipRing: 'ring-emerald-400/50',
                    chipText: 'text-emerald-200',
                    rowHoverRing: 'hover:ring-emerald-400/40',
                };
            case 'cyan':
                return {
                    chipBg: 'bg-cyan-500/30',
                    chipRing: 'ring-cyan-400/50',
                    chipText: 'text-cyan-200',
                    rowHoverRing: 'hover:ring-cyan-400/40',
                };
            case 'amber':
                return {
                    chipBg: 'bg-amber-500/30',
                    chipRing: 'ring-amber-400/50',
                    chipText: 'text-amber-200',
                    rowHoverRing: 'hover:ring-amber-400/40',
                };
            case 'rose':
                return {
                    chipBg: 'bg-rose-500/30',
                    chipRing: 'ring-rose-400/50',
                    chipText: 'text-rose-200',
                    rowHoverRing: 'hover:ring-rose-400/40',
                };
            case 'slate':
                return {
                    chipBg: 'bg-slate-500/30',
                    chipRing: 'ring-slate-400/50',
                    chipText: 'text-slate-200',
                    rowHoverRing: 'hover:ring-slate-400/40',
                };
            case 'teal':
                return {
                    chipBg: 'bg-teal-500/30',
                    chipRing: 'ring-teal-400/50',
                    chipText: 'text-teal-200',
                    rowHoverRing: 'hover:ring-teal-400/40',
                };
            case 'sky':
            default:
                return {
                    chipBg: 'bg-sky-500/30',
                    chipRing: 'ring-sky-400/50',
                    chipText: 'text-sky-200',
                    rowHoverRing: 'hover:ring-sky-400/40',
                };
        }
    }

    // Light mode unchanged (subtle chips, gentle rings)
    switch (tone) {
        case 'indigo':
            return { chipBg: 'bg-indigo-50', chipRing: 'ring-indigo-200', chipText: 'text-indigo-700', rowHoverRing: 'hover:ring-indigo-100' };
        case 'violet':
            return { chipBg: 'bg-violet-50', chipRing: 'ring-violet-200', chipText: 'text-violet-700', rowHoverRing: 'hover:ring-violet-100' };
        case 'fuchsia':
            return { chipBg: 'bg-fuchsia-50', chipRing: 'ring-fuchsia-200', chipText: 'text-fuchsia-700', rowHoverRing: 'hover:ring-fuchsia-100' };
        case 'emerald':
            return { chipBg: 'bg-emerald-50', chipRing: 'ring-emerald-200', chipText: 'text-emerald-700', rowHoverRing: 'hover:ring-emerald-100' };
        case 'cyan':
            return { chipBg: 'bg-cyan-50', chipRing: 'ring-cyan-200', chipText: 'text-cyan-700', rowHoverRing: 'hover:ring-cyan-100' };
        case 'amber':
            return { chipBg: 'bg-amber-50', chipRing: 'ring-amber-200', chipText: 'text-amber-700', rowHoverRing: 'hover:ring-amber-100' };
        case 'rose':
            return { chipBg: 'bg-rose-50', chipRing: 'ring-rose-200', chipText: 'text-rose-700', rowHoverRing: 'hover:ring-rose-100' };
        case 'slate':
            return { chipBg: 'bg-slate-50', chipRing: 'ring-slate-200', chipText: 'text-slate-700', rowHoverRing: 'hover:ring-slate-100' };
        case 'teal':
            return { chipBg: 'bg-teal-50', chipRing: 'ring-teal-200', chipText: 'text-teal-700', rowHoverRing: 'hover:ring-teal-100' };
        case 'sky':
        default:
            return { chipBg: 'bg-sky-50', chipRing: 'ring-sky-200', chipText: 'text-sky-700', rowHoverRing: 'hover:ring-sky-100' };
    }
}

export default async function Sidebar({ orbitInitial }: { orbitInitial: boolean }) {
    const supabase = await getServerSupabase();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    // Theme comes from layout prop (no request-cookie read)
    const dark = !!orbitInitial;

    // Defaults
    type AppLevel = '1_ADMIN' | '2_COMPANY' | '3_MANAGER' | '4_STAFF';
    let level: AppLevel = '4_STAFF';
    let bankOnly = false;

    if (user) {
        const { data: lvlData } = await supabase.rpc('get_effective_level');
        const raw: string = typeof lvlData === 'string' ? lvlData : '';
        level =
            raw === '1_ADMIN'
                ? '1_ADMIN'
                : raw === '2_COMPANY'
                    ? '2_COMPANY'
                    : raw === '3_MANAGER'
                        ? '3_MANAGER'
                        : '4_STAFF';

        const [bank, home] = await Promise.all([
            supabase
                .from('bank_memberships')
                .select('id', { head: false, count: 'exact' })
                .eq('user_id', user.id)
                .limit(1),
            supabase
                .from('home_memberships')
                .select('home_id', { head: false, count: 'exact' })
                .eq('user_id', user.id)
                .limit(1),
        ]);

        const hasBank = !!(bank.data && bank.data.length > 0);
        const hasHome = !!(home.data && home.data.length > 0);
        bankOnly = hasBank && !hasHome;
    }

    const isAdmin = level === '1_ADMIN';
    const isCompany = level === '2_COMPANY';
    const isManager = level === '3_MANAGER';

    // --- company feature flags (default TRUE; admins bypass) ---
    type AppFeature =
        | 'TRAINING'
        | 'BOOKINGS'
        | 'ROTAS'
        | 'TIMESHEETS'
        | 'ANNUAL_LEAVE'
        | 'BUDGETS'
        | 'SUPERVISIONS'
        | 'PAYSLIPS'
        | 'APPOINTMENTS'
        | 'POLICIES'
        | 'MANAGEMENT'
        | 'LICENSES';

    const featureMap = new Map<AppFeature, boolean>();

    if (!isAdmin) {
        const { data: companyIds } = await supabase.rpc('user_company_ids'); // returns uuid[]
        const companyId: string | null =
            Array.isArray(companyIds) && companyIds.length ? companyIds[0] : null;

        if (companyId) {
            const { data: rows } = await supabase
                .from('company_features_effective_v')
                .select('feature,is_enabled')
                .eq('company_id', companyId);

            for (const r of rows ?? []) {
                featureMap.set(r.feature as AppFeature, !!r.is_enabled);
            }
        }
    }

    const featureOn = (f: AppFeature) =>
        isAdmin ? true : featureMap.get(f) ?? true;

    // booleans rewritten to respect flags:
    const showManagement =
        (isAdmin || isCompany || isManager) && featureOn('MANAGEMENT');
    const showBudgets = !bankOnly && featureOn('BUDGETS');
    const showAppointments = !bankOnly && featureOn('APPOINTMENTS');

    // --- drafts + pending counts (RLS ensures scoping per user/role) ---
    let draftsCount = 0;
    let pendingApprovalCount = 0;

    if (user) {
        const { count: dCount } = await supabase
            .from('form_entries')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'DRAFT');
        draftsCount = dCount ?? 0;

        if (isManager || isCompany || isAdmin) {
            const { count: pCount } = await supabase
                .from('form_entries')
                .select('id', { count: 'exact', head: true })
                .eq('status', 'PENDING_APPROVAL');
            pendingApprovalCount = pCount ?? 0;
        }
    }

    return (
        <aside
            className="hidden lg:flex flex-col fixed left-0 top-14 bottom-0 w-64 border-r"
            style={{
                borderColor: 'var(--ring)',
                backgroundImage: 'var(--panel-bg)',
            }}
        >
            <div className="flex-1 overflow-y-auto">
                {/* Brand card */}
                <div className="p-4">
                    <div
                        className="rounded-xl p-3 ring-1"
                        style={{
                            background: 'var(--card-grad)',
                            borderColor: 'var(--ring)',
                            color: 'var(--ink)',
                        }}
                    >
                        <div className="flex items-center gap-3">
                            <div className="h-9 w-9 rounded-xl overflow-hidden ring-2 ring-white/80 shadow-sm">
                                <Image
                                    src="/logo.png"
                                    alt="Company logo"
                                    width={36}
                                    height={36}
                                    className="h-full w-full object-contain"
                                    priority
                                />
                            </div>

                            <div>
                                <div
                                    className="text-sm font-semibold"
                                    style={{ color: 'var(--ink)' }}
                                >
                                    Quick links
                                </div>
                                <div
                                    className="text-[12px]"
                                    style={{ color: 'var(--sub)' }}
                                >
                                    Navigate fast
                                </div>
                            </div>
                        </div>

                        {/* Dashboard primary button */}
                        <div className="mt-3">
                            <Link
                                href="/dashboard"
                                className="inline-flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white shadow-sm ring-1 transition"
                                style={{
                                    backgroundImage:
                                        'linear-gradient(90deg, #7C3AED 0%, #6366F1 50%, #3B82F6 100%)',
                                    borderColor: dark
                                        ? 'rgba(99,102,241,0.30)'
                                        : 'rgba(99,102,241,0.35)',
                                }}
                            >
                                <IconHome />
                                <span>Dashboard</span>
                            </Link>
                        </div>
                    </div>
                </div>

                {/* Navigation */}
                <nav className="px-4 pb-6 space-y-6 text-[13px]">
                    {/* Tasks */}
                    <Section title="Tasks" dark={dark}>
                        <Item
                            href="/due"
                            label="Tasks Due"
                            icon={<IconTasksDue />}
                            tone="teal"
                            dark={dark}
                        />
                        <Item
                            href="/drafts"
                            label="Drafts"
                            icon={<IconTasks />}
                            tone="amber"
                            dark={dark}
                            badgeCount={draftsCount}
                        />
                        {(isManager || isCompany || isAdmin) && (
                            <Item
                                href="/pending-approval"
                                label="Pending approval"
                                icon={<IconPending />}
                                tone="rose"
                                dark={dark}
                                badgeCount={pendingApprovalCount}
                            />
                        )}
                    </Section>

                    {/* Day-to-day */}
                    <Section title="Day-to-day" dark={dark}>
                        <Item
                            href="/young-people"
                            label="Young people"
                            icon={<IconYoungPerson />}
                            tone="teal"
                            dark={dark}
                        />
                        <Item
                            href="/cars"
                            label="Cars"
                            icon={<IconCar />}
                            tone="cyan"
                            dark={dark}
                        />
                        <Item
                            href="/homes"
                            label="Homes"
                            icon={<IconHouse />}
                            tone="emerald"
                            dark={dark}
                        />
                        {showBudgets && (
                            <Item
                                href="/budgets"
                                label="Budgets"
                                icon={<IconBudget />}
                                tone="emerald"
                                dark={dark}
                            />
                        )}
                        {featureOn('SUPERVISIONS') && (
                            <Item
                                href="/supervisions"
                                label="Supervisions"
                                icon={<IconSupervision />}
                                tone="sky"
                                dark={dark}
                            />
                        )}
                        {showAppointments && (
                            <Item
                                href="/appointments"
                                label="Appointments"
                                icon={<IconAppointment />}
                                tone="amber"
                                dark={dark}
                            />
                        )}
                    </Section>

                    {/* My work */}
                    <Section title="My work" dark={dark}>
                        {featureOn('ROTAS') && (
                            <Item
                                href="/rotas"
                                label="Rotas"
                                icon={<IconRota />}
                                tone="fuchsia"
                                dark={dark}
                            />
                        )}
                        {featureOn('TRAINING') && (
                            <Item
                                href="/training"
                                label="Training"
                                icon={<IconBook />}
                                tone="indigo"
                                dark={dark}
                            />
                        )}
                        {featureOn('BOOKINGS') && (
                            <Item
                                href="/bookings"
                                label="Training booking"
                                icon={<IconCalendar />}
                                tone="violet"
                                dark={dark}
                            />
                        )}
                        {featureOn('TIMESHEETS') && (
                            <Item
                                href="/timesheets"
                                label="Timesheets"
                                icon={<IconClock />}
                                tone="cyan"
                                dark={dark}
                            />
                        )}
                        {featureOn('ANNUAL_LEAVE') && (
                            <Item
                                href="/annual-leave"
                                label="Annual leave"
                                icon={<IconLeave />}
                                tone="rose"
                                dark={dark}
                            />
                        )}
                        {featureOn('PAYSLIPS') && (
                            <Item
                                href="/payslips"
                                label="Payslips"
                                icon={<IconPayslip />}
                                tone="teal"
                                dark={dark}
                            />
                        )}
                        {featureOn('POLICIES') && (
                            <Item
                                href="/policies"
                                label="Policies"
                                icon={<IconPolicy />}
                                tone="slate"
                                dark={dark}
                            />
                        )}
                    </Section>

                    {/* Management */}
                    {showManagement && (
                        <Section title="Management" dark={dark}>
                            <Item
                                href="/Management"
                                label="Management"
                                icon={<IconOrg />}
                                tone="indigo"
                                dark={dark}
                            />
                            <Item
                                href="/form-builder"
                                label="Form builder"
                                icon={<IconFormBuilder />}
                                tone="violet"
                                dark={dark}
                            />
                            <Item
                                href="/form-scheduler"
                                label="Form Scheduler"
                                icon={<IconFormScheduler />}
                                tone="teal"
                                dark={dark}
                            />
                            <Item
                                href="/audit"
                                label="Audits"
                                icon={<IconAudit />}
                                tone="amber"
                                dark={dark}
                            />
                            {isAdmin && featureOn('LICENSES') && (
                                <Item
                                    href="/licenses"
                                    label="Licenses"
                                    icon={<IconLicense />}
                                    tone="rose"
                                    dark={dark}
                                />
                            )}
                        </Section>
                    )}
                </nav>
            </div>

            <div className="border-t p-4" style={{ borderColor: 'var(--ring)' }}>
                <Link
                    href="/help-centre"
                    className="group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold ring-1 transition"
                    style={{
                        background: 'var(--card-grad)',
                        borderColor: 'var(--ring-strong)',
                        color: 'var(--ink)',
                    }}
                >
                    <IconHelp />
                    <span>Help Centre</span>
                </Link>
            </div>
        </aside>
    );
}

/* --------------------------  Building blocks  -------------------------- */

function Section({
    title,
    children,
    dark,
}: {
    title: string;
    children: ReactNode;
    dark: boolean;
}) {
    return (
        <div className="space-y-2">
            <div className="px-1 flex items-center gap-2">
                <span
                    className={`h-px flex-1 bg-gradient-to-r ${dark
                            ? 'from-indigo-500/20 via-violet-500/20 to-blue-500/20'
                            : 'from-indigo-200 via-violet-200 to-blue-200'
                        }`}
                />
                <span
                    className={`text-xs font-semibold ${dark ? 'text-slate-300' : 'text-slate-600'
                        }`}
                >
                    {title}
                </span>
                <span
                    className={`h-px flex-1 bg-gradient-to-r ${dark
                            ? 'from-blue-500/20 via-violet-500/20 to-indigo-500/20'
                            : 'from-blue-200 via-violet-200 to-indigo-200'
                        }`}
                />
            </div>
            <ul className="space-y-1">{children}</ul>
        </div>
    );
}

function Item({
    href,
    label,
    icon,
    tone = 'indigo',
    dark,
    badgeCount,
}: {
    href: string;
    label: string;
    icon: ReactNode;
    tone?: Tone;
    dark: boolean;
    badgeCount?: number;
}) {
    const t = getTone(tone, dark);
    const showBadge = typeof badgeCount === 'number' && badgeCount > 0;
    const badgeValue =
        typeof badgeCount === 'number' && badgeCount > 99 ? '99+' : badgeCount;

    return (
        <li>
            <Link
                href={href}
                className={`group flex items-center gap-3 rounded-lg px-2 py-2 ring-1 ring-transparent transition bg-[var(--nav-item-bg)] hover:bg-[var(--nav-item-bg-hover)] ${t.rowHoverRing}`}
                style={{ color: 'var(--ink)' }}
            >
                {/* Tone-forward chip: colored bg + colored ring + bright text */}
                <span
                    className={`h-7 w-7 grid place-items-center rounded-md ring-1 ${t.chipBg} ${t.chipRing} ${t.chipText}`}
                >
                    {icon}
                </span>

                <span className="flex-1 truncate">{label}</span>

                {showBadge && (
                    <span
                        className={`ml-2 inline-flex min-w-[1.5rem] justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${dark ? 'bg-rose-500 text-white' : 'bg-rose-500 text-white'
                            }`}
                    >
                        {badgeValue}
                    </span>
                )}
            </Link>
        </li>
    );
}

/* --------------------------  Icons  -------------------------- */

function IconHome() {
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            stroke="currentColor"
            fill="none"
            strokeWidth={1.6}
            aria-hidden
        >
            <path d="M3 10.5l9-7 9 7" />
            <path d="M5 10v9h14v-9" />
        </svg>
    );
}
function IconHelp() {
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            stroke="currentColor"
            fill="none"
            strokeWidth={1.6}
            aria-hidden
        >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16h.01" />
            <path d="M12 12a3 3 0 1 0-3-3" />
        </svg>
    );
}
function IconSupervision() {
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            stroke="currentColor"
            fill="none"
            strokeWidth={1.6}
            aria-hidden
        >
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M7 8h10M7 12h6M7 16h4" />
            <path d="M4 4l2-2h12l2 2" />
        </svg>
    );
}
function IconPayslip() {
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            stroke="currentColor"
            fill="none"
            strokeWidth={1.6}
            aria-hidden
        >
            <path d="M7 3h10a2 2 0 0 1 2 2v13l-2-1-2 1-2-1-2 1-2-1-2 1V5a2 2 0 0 1 2-2z" />
            <path d="M11 9c0-1.2.8-2 2-2h1" />
            <path d="M10 12h4" />
            <path d="M10 15h6" />
        </svg>
    );
}
function IconBook() {
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            stroke="currentColor"
            fill="none"
            strokeWidth={1.6}
            aria-hidden
        >
            <path d="M6 17V5a2 2 0 0 1 2-2h10v14" />
            <path d="M4 19a2 2 0 0 1 2-2h12" />
            <path d="M8 6h10" />
        </svg>
    );
}
function IconCalendar() {
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            stroke="currentColor"
            fill="none"
            strokeWidth={1.6}
            aria-hidden
        >
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
    );
}
function IconRota() {
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            stroke="currentColor"
            fill="none"
            strokeWidth={1.6}
            aria-hidden
        >
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="M7 9h10M7 13h6" />
        </svg>
    );
}
function IconBudget() {
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            stroke="currentColor"
            fill="none"
            strokeWidth={1.6}
            aria-hidden
        >
            <path d="M3 12h18" />
            <path d="M5 9h14a2 2 0 0 1 2 2v6H3v-6a2 2 0 0 1 2-2z" />
            <circle cx="7.5" cy="15" r="1" />
        </svg>
    );
}
function IconClock() {
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            stroke="currentColor"
            fill="none"
            strokeWidth={1.6}
            aria-hidden
        >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 3" />
        </svg>
    );
}
function IconAppointment() {
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            stroke="currentColor"
            fill="none"
            strokeWidth={1.6}
            aria-hidden
        >
            <path d="M4 7h16M7 3v4M17 3v4" />
            <rect x="4" y="7" width="16" height="14" rx="2" />
            <path d="M8 12h4" />
        </svg>
    );
}
function IconLeave() {
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            stroke="currentColor"
            fill="none"
            strokeWidth={1.6}
            aria-hidden
        >
            <path d="M4 7h16M7 3v4M17 3v4" />
            <rect x="4" y="7" width="16" height="14" rx="2" />
            <path d="M8 12h5M14 16h2" />
            <path d="M6 18l3-3" />
        </svg>
    );
}
function IconOrg() {
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            stroke="currentColor"
            fill="none"
            strokeWidth={1.6}
            aria-hidden
        >
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <path d="M7 10v4M17 10v4M10 7h4M7 17h10" />
        </svg>
    );
}
function IconLicense() {
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            stroke="currentColor"
            fill="none"
            strokeWidth={1.6}
            aria-hidden
        >
            <path d="M12 3l7 3v5c0 5-3.5 8.5-7 9-3.5-.5-7-4-7-9V6l7-3z" />
            <path d="M9 12l2 2 4-4" />
        </svg>
    );
}
function IconPolicy() {
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            stroke="currentColor"
            fill="none"
            strokeWidth={1.6}
            aria-hidden
        >
            <path d="M7 3h7l5 5v13H7z" />
            <path d="M14 3v5h5" />
            <path d="M10 8h2M10 12h6M10 16h6" />
        </svg>
    );
}

function IconTasks() {
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            stroke="currentColor"
            fill="none"
            strokeWidth={1.6}
            aria-hidden
        >
            <rect x="4" y="3" width="16" height="18" rx="2" />
            <path d="M8 7h8M8 11h8M8 15h5" />
            <path d="M6 7l.8.8L8 6.5" />
        </svg>
    );
}

function IconPending() {
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            stroke="currentColor"
            fill="none"
            strokeWidth={1.6}
            aria-hidden
        >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
        </svg>
    );
}

function IconTasksDue() {
    // Calendar with a highlighted "today" dot
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            stroke="currentColor"
            fill="none"
            strokeWidth={1.6}
            aria-hidden
        >
            <rect x="4" y="5" width="16" height="15" rx="2" />
            <path d="M8 3v4M16 3v4M4 9h16" />
            <circle cx="15" cy="14" r="1.4" />
        </svg>
    );
}

function IconYoungPerson() {
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            stroke="currentColor"
            fill="none"
            strokeWidth={1.6}
            aria-hidden
        >
            <circle cx="12" cy="9" r="3.2" />
            <path d="M6 19c.8-2.4 2.9-4 6-4s5.2 1.6 6 4" />
        </svg>
    );
}

function IconCar() {
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            stroke="currentColor"
            fill="none"
            strokeWidth={1.6}
            aria-hidden
        >
            <path d="M5 16l-1-3 1.5-4.5A2 2 0 0 1 7.4 7h9.2a2 2 0 0 1 1.9 1.5L20 13l-1 3" />
            <path d="M4 16h16" />
            <circle cx="7.5" cy="16.5" r="1.2" />
            <circle cx="16.5" cy="16.5" r="1.2" />
        </svg>
    );
}

function IconHouse() {
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            stroke="currentColor"
            fill="none"
            strokeWidth={1.6}
            aria-hidden
        >
            <path d="M4 11l8-7 8 7" />
            <path d="M6 10v9h12v-9" />
            <path d="M10 19v-5h4v5" />
        </svg>
    );
}

function IconFormBuilder() {
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            stroke="currentColor"
            fill="none"
            strokeWidth={1.6}
            aria-hidden
        >
            <rect x="4" y="3" width="12" height="18" rx="2" />
            <path d="M8 7h6M8 11h4M8 15h3" />
            <path d="M15.5 8.5l2.5-2.5 2 2-2.5 2.5-2 .5z" />
        </svg>
    );
}

function IconFormScheduler() {
    // Clipboard with a calendar/clock hint
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            stroke="currentColor"
            fill="none"
            strokeWidth={1.6}
            aria-hidden
        >
            <rect x="6" y="4" width="12" height="16" rx="2" />
            <path d="M9 4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6H9V4.5z" />
            <circle cx="12" cy="13" r="3" />
            <path d="M12 12v1.5l1 1" />
        </svg>
    );
}

function IconAudit() {
    // Document with magnifying glass
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            stroke="currentColor"
            fill="none"
            strokeWidth={1.6}
            aria-hidden
        >
            <path d="M7 3h7l5 5v13H7z" />
            <path d="M14 3v5h5" />
            <circle cx="11" cy="13" r="2.5" />
            <path d="M13 15l2 2" />
        </svg>
    );
}

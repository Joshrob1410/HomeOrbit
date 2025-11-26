// app/(app)/young-people/page.tsx
'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/supabase/client';
import { getEffectiveLevel, type AppLevel } from '@/supabase/roles';

/** ========= Branding ========= */
const BRAND_GRADIENT =
    'linear-gradient(135deg, #7C3AED 0%, #6366F1 50%, #3B82F6 100%)';

type Level = AppLevel;

type ViewState =
    | { status: 'loading' }
    | { status: 'signed_out' }
    | {
        status: 'ready';
        level: Level;
        companies: { id: string; name: string }[];
        selectedCompanyId: string | null;
    };

type Home = {
    id: string;
    name: string;
    company_id: string;
};

type YoungPerson = {
    id: string;
    company_id: string;
    home_id: string | null;
    full_name: string;
    date_of_birth: string | null;
    legal_status: string | null;
};


type HomeFilterValue = 'ALL' | string;

export default function Page() {
    const [view, setView] = useState<ViewState>({ status: 'loading' });

    const [homes, setHomes] = useState<Home[]>([]);
    const [loadingHomes, setLoadingHomes] = useState(false);

    const [youngPeople, setYoungPeople] = useState<YoungPerson[]>([]);
    const [loadingYoungPeople, setLoadingYoungPeople] = useState(false);

    const [selectedHomeId, setSelectedHomeId] =
        useState<HomeFilterValue>('ALL');

    const [search, setSearch] = useState('');

    /** ========= Derived flags ========= */
    const isReady = view.status === 'ready';
    const level: Level | null = isReady ? view.level : null;
    const isAdmin = level === '1_ADMIN';
    const isCompany = level === '2_COMPANY';
    const isManager = level === '3_MANAGER';
    const isStaff = level === '4_STAFF';
    const selectedCompanyId =
        view.status === 'ready' ? view.selectedCompanyId : null;

    /** ========= Initial load: session + level + company scope ========= */
    useEffect(() => {
        let cancelled = false;

        (async () => {
            const { data: s } = await supabase.auth.getSession();
            const session = s?.session;
            if (!session) {
                if (!cancelled) setView({ status: 'signed_out' });
                return;
            }

            const lvl = await getEffectiveLevel();

            if (lvl === '1_ADMIN') {
                // Admin: load all companies
                const { data: companies, error } = await supabase
                    .from('companies')
                    .select('id,name')
                    .order('name', { ascending: true });

                if (cancelled) return;

                if (error) {
                    console.error('❌ load companies failed', error);
                    setView({
                        status: 'ready',
                        level: lvl,
                        companies: [],
                        selectedCompanyId: null,
                    });
                    return;
                }

                const list = companies ?? [];
                setView({
                    status: 'ready',
                    level: lvl,
                    companies: list,
                    selectedCompanyId: list[0]?.id ?? null,
                });
                return;
            }

            // Non-admin: work out "my" company via helper
            const { data: myCompanyId, error: myCompanyErr } =
                await supabase.rpc('_my_company');

            if (cancelled) return;

            if (myCompanyErr) {
                console.error('❌ _my_company failed', myCompanyErr);
                setView({
                    status: 'ready',
                    level: lvl,
                    companies: [],
                    selectedCompanyId: null,
                });
                return;
            }

            let companies: { id: string; name: string }[] = [];
            if (myCompanyId) {
                const { data: companyRow, error: companyErr } = await supabase
                    .from('companies')
                    .select('id,name')
                    .eq('id', myCompanyId)
                    .maybeSingle();

                if (!cancelled) {
                    if (companyErr) {
                        console.error(
                            '❌ load my company name failed',
                            companyErr
                        );
                    } else if (companyRow) {
                        companies = [companyRow as { id: string; name: string }];
                    }
                }
            }

            if (!cancelled) {
                setView({
                    status: 'ready',
                    level: lvl,
                    companies,
                    selectedCompanyId: (myCompanyId as string | null) ?? null,
                });
            }
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    /** ========= Load homes for filters ========= */
    useEffect(() => {
        if (!isReady) return;

        let cancelled = false;
        setLoadingHomes(true);

        (async () => {
            const { data, error } = await supabase.rpc('homes_list_for_ui', {
                p_company_id: selectedCompanyId,
            });

            if (cancelled) return;

            if (error) {
                console.error('❌ homes_list_for_ui failed', error);
                setHomes([]);
                setLoadingHomes(false);
                return;
            }

            const list = (data ?? []) as Home[];
            setHomes(list);

            // Ensure selectedHomeId is valid for current scope
            setSelectedHomeId((prev) => {
                if (prev !== 'ALL' && list.some((h) => h.id === prev)) {
                    return prev;
                }

                // Managers & staff often only have one home; default to ALL or first
                if ((isManager || isStaff) && list.length === 1) {
                    return list[0].id;
                }

                return 'ALL';
            });

            setLoadingHomes(false);
        })();

        return () => {
            cancelled = true;
        };
    }, [isReady, selectedCompanyId, isManager, isStaff]);

    /** ========= Load young people according to scope + filters ========= */
    useEffect(() => {
        if (!isReady) return;

        let cancelled = false;
        setLoadingYoungPeople(true);

        (async () => {
            let query = supabase
                .from('young_people')
                .select(
                    'id, company_id, home_id, full_name, date_of_birth, legal_status'
                )
                .order('full_name', { ascending: true });


            // Company filter for admin/company-level
            if ((isAdmin || isCompany) && selectedCompanyId) {
                query = query.eq('company_id', selectedCompanyId);
            }

            // Home filter (purely UI; RLS still guards access)
            if (selectedHomeId !== 'ALL') {
                query = query.eq('home_id', selectedHomeId);
            }

            const { data, error } = await query;

            if (cancelled) return;

            if (error) {
                console.error('❌ load young_people failed', error);
                setYoungPeople([]);
                setLoadingYoungPeople(false);
                return;
            }

            setYoungPeople((data ?? []) as YoungPerson[]);
            setLoadingYoungPeople(false);
        })();

        return () => {
            cancelled = true;
        };
    }, [isReady, isAdmin, isCompany, selectedCompanyId, selectedHomeId]);

    /** ========= Derived maps / filtered list ========= */
    const homeById = useMemo(() => {
        const m = new Map<string, Home>();
        for (const h of homes) m.set(h.id, h);
        return m;
    }, [homes]);

    const companyById = useMemo(() => {
        const m = new Map<string, { id: string; name: string }>();
        if (view.status === 'ready') {
            for (const c of view.companies) m.set(c.id, c);
        }
        return m;
    }, [view]);

    const filteredYoungPeople = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return youngPeople;
        return youngPeople.filter((yp) =>
            (yp.full_name ?? '').toLowerCase().includes(q)
        );
    }, [youngPeople, search]);

    /** ========= Guards ========= */
    if (view.status === 'loading') {
        return (
            <div className="p-4 md:p-6" style={{ color: 'var(--sub)' }}>
                Loading young people…
            </div>
        );
    }

    if (view.status === 'signed_out') {
        return null;
    }

    /** ========= UI ========= */
    const currentCompanyName =
        selectedCompanyId && companyById.get(selectedCompanyId)?.name;

    return (
        <div className="p-4 md:p-6 space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
                <div className="space-y-1">
                    <h1
                        className="text-xl md:text-2xl font-semibold tracking-tight"
                        style={{ color: 'var(--ink)' }}
                    >
                        Young People
                    </h1>
                    <p className="text-sm" style={{ color: 'var(--sub)' }}>
                        View the young people you have access to, and open their
                        files to see logs and forms.
                    </p>
                    {currentCompanyName && (
                        <p
                            className="text-xs mt-1"
                            style={{ color: 'var(--sub)' }}
                        >
                            Company:{' '}
                            <span className="font-medium">
                                {currentCompanyName}
                            </span>
                        </p>
                    )}
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-col md:flex-row gap-3 md:items-end md:justify-between">
                <div className="flex flex-col sm:flex-row gap-3">
                    {isAdmin && (
                        <div className="min-w-[220px]">
                            <label
                                className="block text-xs mb-1"
                                style={{ color: 'var(--sub)' }}
                            >
                                Company
                            </label>
                            <select
                                className="w-full rounded-md px-2 py-2 text-sm ring-1"
                                style={{
                                    background: 'var(--nav-item-bg)',
                                    color: 'var(--ink)',
                                    borderColor: 'var(--ring)',
                                }}
                                value={selectedCompanyId ?? ''}
                                onChange={(e) => {
                                    const id =
                                        e.target.value === ''
                                            ? null
                                            : e.target.value;
                                    setView((v) =>
                                        v.status !== 'ready'
                                            ? v
                                            : {
                                                ...v,
                                                selectedCompanyId: id,
                                            }
                                    );
                                    // Reset home filter on company change
                                    setSelectedHomeId('ALL');
                                }}
                            >
                                {view.companies.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div className="min-w-[220px]">
                        <label
                            className="block text-xs mb-1"
                            style={{ color: 'var(--sub)' }}
                        >
                            Home
                        </label>
                        <select
                            className="w-full rounded-md px-2 py-2 text-sm ring-1"
                            style={{
                                background: 'var(--nav-item-bg)',
                                color: 'var(--ink)',
                                borderColor: 'var(--ring)',
                            }}
                            value={selectedHomeId}
                            onChange={(e) =>
                                setSelectedHomeId(
                                    (e.target.value ||
                                        'ALL') as HomeFilterValue
                                )
                            }
                            disabled={loadingHomes || homes.length === 0}
                        >
                            <option value="ALL">
                                {isAdmin || isCompany
                                    ? 'All homes'
                                    : 'All my homes'}
                            </option>
                            {homes.map((h) => (
                                <option key={h.id} value={h.id}>
                                    {h.name}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Search */}
                <div className="w-full md:max-w-xs">
                    <label
                        className="block text-xs mb-1"
                        style={{ color: 'var(--sub)' }}
                    >
                        Search by name
                    </label>
                    <input
                        type="text"
                        className="w-full rounded-md px-2 py-2 text-sm ring-1"
                        style={{
                            background: 'var(--nav-item-bg)',
                            color: 'var(--ink)',
                            borderColor: 'var(--ring)',
                        }}
                        placeholder="Start typing a name…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
            </div>

            {/* Young people list */}
            <div
                className="rounded-xl ring-1 overflow-hidden"
                style={{
                    background: 'var(--card-grad)',
                    borderColor: 'var(--ring)',
                }}
            >
                <div
                    className="px-3 py-2 flex items-center justify-between"
                    style={{
                        borderBottom: '1px solid var(--ring)',
                        background: 'var(--nav-item-bg)',
                    }}
                >
                    <div
                        className="font-medium text-sm"
                        style={{ color: 'var(--ink)' }}
                    >
                        Young people
                    </div>
                    <div className="text-xs" style={{ color: 'var(--sub)' }}>
                        {loadingYoungPeople
                            ? 'Loading…'
                            : `${filteredYoungPeople.length} young person${filteredYoungPeople.length === 1 ? '' : 's'
                            }`}
                    </div>
                </div>

                {loadingYoungPeople ? (
                    <div className="p-4 text-sm" style={{ color: 'var(--sub)' }}>
                        Loading young people…
                    </div>
                ) : filteredYoungPeople.length === 0 ? (
                    <div className="p-4 text-sm" style={{ color: 'var(--sub)' }}>
                        No young people found for your current filters.
                    </div>
                ) : (
                    <div className="p-3 md:p-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4 justify-items-center">
                            {filteredYoungPeople.map((yp) => {
                                const home = yp.home_id
                                    ? homeById.get(yp.home_id)
                                    : null;
                                const homeName =
                                    home?.name ?? '— (no home set)';
                                const companyName =
                                    yp.company_id &&
                                    companyById.get(yp.company_id)?.name;
                                const dobLabel = yp.date_of_birth
                                    ? new Date(
                                        yp.date_of_birth as string
                                    ).toLocaleDateString()
                                    : '—';

                                return (
                                    <Link
                                        key={yp.id}
                                        href={`/young-people/${yp.id}`}
                                        className="group w-full max-w-[260px] rounded-xl ring-1 transition-transform hover:-translate-y-[2px] hover:shadow-md"
                                        style={{
                                            background: 'var(--nav-item-bg)',
                                            borderColor: 'var(--ring)',
                                        }}
                                    >
                                        <div className="flex flex-col items-center text-center gap-2 px-3 py-4">
                                            {/* Stickman avatar */}
                                            <div
                                                className="flex h-12 w-12 items-center justify-center rounded-full text-2xl md:text-3xl"
                                                style={{
                                                    background:
                                                        'rgba(124,58,237,0.15)',
                                                    color: 'var(--ink)',
                                                }}
                                            >
                                                <span className="translate-y-[1px]">
                                                    🧍
                                                </span>
                                            </div>

                                            {/* Name + small metadata */}
                                            <div className="space-y-1">
                                                <div
                                                    className="text-sm font-semibold group-hover:underline"
                                                    style={{
                                                        color: 'var(--ink)',
                                                    }}
                                                >
                                                    {yp.full_name || 'Unnamed'}
                                                </div>
                                                <div
                                                    className="text-[11px] space-y-0.5"
                                                    style={{
                                                        color: 'var(--sub)',
                                                    }}
                                                >
                                                    <div>{homeName}</div>
                                                    {isAdmin && companyName && (
                                                        <div>{companyName}</div>
                                                    )}
                                                    {dobLabel !== '—' && (
                                                        <div>
                                                            DoB: {dobLabel}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            <div
                                                className="text-[11px] mt-1"
                                                style={{ color: 'var(--sub)' }}
                                            >
                                                Click to open file
                                            </div>
                                        </div>
                                    </Link>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>


            {/* Orbit-friendly select / input tweaks */}
            <style jsx global>{`
                [data-orbit='1'] select,
                [data-orbit='1'] input[type='text'],
                [data-orbit='1'] textarea {
                    color-scheme: dark;
                    background: var(--nav-item-bg);
                    color: var(--ink);
                    border-color: var(--ring);
                }
                [data-orbit='1'] select option {
                    color: var(--ink);
                    background-color: #0b1221;
                }
                @-moz-document url-prefix() {
                    [data-orbit='1'] select option {
                        background-color: #0b1221;
                    }
                }
                [data-orbit='1'] select:where(:not(:disabled)) {
                    opacity: 1;
                }
            `}</style>
        </div>
    );
}

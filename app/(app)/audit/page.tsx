'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/supabase/client';
import { getEffectiveLevel, type AppLevel } from '@/supabase/roles';

// Put this just above AuditEvent
type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json }
    | Json[];

type AuditEvent = {
    id: string;
    created_at: string;
    actor_name: string | null;
    actor_email: string | null;
    actor_level: string | null;
    company_id: string | null;
    home_id: string | null;
    subject_user_id: string | null;
    subject_name: string | null;
    category: string;
    action: string;
    entity_type: string;
    entity_id: string | null;
    summary: string | null;
    diff: Json | null;
    meta: Json | null;
};


type CompanyRow = {
    id: string;
    name: string | null;
};

type HomeRow = {
    id: string;
    name: string | null;
    company_id: string | null;
};

type Filters = {
    search: string;
    companyId: string;
    homeId: string;
    actorName: string;
    subjectName: string;
    fromDate: string; // yyyy-mm-dd
    toDate: string;   // yyyy-mm-dd
};

const initialFilters: Filters = {
    search: '',
    companyId: '',
    homeId: '',
    actorName: '',
    subjectName: '',
    fromDate: '',
    toDate: '',
};

export default function AuditPage() {
    const router = useRouter();

    const [level, setLevel] = useState<AppLevel | null>(null);
    const [events, setEvents] = useState<AuditEvent[]>([]);
    const [companies, setCompanies] = useState<CompanyRow[]>([]);
    const [homes, setHomes] = useState<HomeRow[]>([]);
    const [filters, setFilters] = useState<Filters>(initialFilters);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        async function load() {
            try {
                setLoading(true);
                setError(null);

                const lvl = await getEffectiveLevel();
                setLevel(lvl);


                if (cancelled) return;

                // Staff have no access at all
                if (lvl === '4_STAFF') {
                    router.replace('/dashboard');
                    return;
                }

                setLevel(lvl);

                // 1) Load audit events (RLS should already scope by user)
                const { data: eventsData, error: eventsError } = await supabase
                    .from('audit_events')
                    .select('*')
                    .order('created_at', { ascending: false })
                    .limit(500);

                if (cancelled) return;

                if (eventsError) {
                    console.error(eventsError);
                    setError('Failed to load audit events.');
                } else {
                    setEvents((eventsData ?? []) as AuditEvent[]);
                }

                // 2) Load companies / homes for filter dropdowns based on role
                await loadFilterScope(lvl, cancelled);
            } catch (err) {
                if (!cancelled) {
                    console.error(err);
                    setError('Something went wrong while loading audit data.');
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        async function loadFilterScope(lvl: AppLevel, cancelled: boolean) {
            if (cancelled) return;

            // Admin: can see everything
            if (lvl === '1_ADMIN') {
                const [{ data: companiesData }, { data: homesData }] = await Promise.all([
                    supabase.from('companies').select('id, name').order('name'),
                    supabase.from('homes').select('id, name, company_id').order('name'),
                ]);

                if (cancelled) return;

                setCompanies((companiesData ?? []) as CompanyRow[]);
                setHomes((homesData ?? []) as HomeRow[]);
                return;
            }

            // Company-level: restrict companies to those they have access to, + homes within those companies
            if (lvl === '2_COMPANY') {
                const { data: membershipData } = await supabase
                    .from('company_memberships')
                    .select('company_id, has_company_access')
                    .eq('has_company_access', true);

                if (cancelled) return;

                const companyIds = (membershipData ?? []).map((m) => m.company_id);
                if (companyIds.length === 0) {
                    setCompanies([]);
                    setHomes([]);
                    return;
                }

                const [{ data: companiesData }, { data: homesData }] = await Promise.all([
                    supabase
                        .from('companies')
                        .select('id, name')
                        .in('id', companyIds)
                        .order('name'),
                    supabase
                        .from('homes')
                        .select('id, name, company_id')
                        .in('company_id', companyIds)
                        .order('name'),
                ]);

                if (cancelled) return;

                setCompanies((companiesData ?? []) as CompanyRow[]);
                setHomes((homesData ?? []) as HomeRow[]);

                // If they only have 1 company, pre-select it in the filter
                if (companyIds.length === 1) {
                    setFilters((prev) => ({ ...prev, companyId: companyIds[0] }));
                }

                return;
            }

            // Manager: show only homes they manage, and the corresponding companies.
            if (lvl === '3_MANAGER') {
                // home_memberships is RLS-scoped; managers can see memberships for their managed homes
                const { data: membershipData } = await supabase
                    .from('home_memberships')
                    .select('home_id, role');

                if (cancelled) return;

                const managerHomeIds = Array.from(
                    new Set(
                        (membershipData ?? [])
                            .filter((m) => m.role === 'MANAGER')
                            .map((m) => m.home_id),
                    ),
                );

                if (managerHomeIds.length === 0) {
                    setHomes([]);
                    setCompanies([]);
                    return;
                }

                const { data: homesData } = await supabase
                    .from('homes')
                    .select('id, name, company_id')
                    .in('id', managerHomeIds)
                    .order('name');

                if (cancelled) return;

                const homesRows = (homesData ?? []) as HomeRow[];
                setHomes(homesRows);

                const companyIds = Array.from(
                    new Set(homesRows.map((h) => h.company_id).filter(Boolean) as string[]),
                );

                if (companyIds.length > 0) {
                    const { data: companiesData } = await supabase
                        .from('companies')
                        .select('id, name')
                        .in('id', companyIds)
                        .order('name');

                    if (cancelled) return;

                    setCompanies((companiesData ?? []) as CompanyRow[]);

                    // If only 1 company, pre-select it
                    if (companyIds.length === 1) {
                        setFilters((prev) => ({ ...prev, companyId: companyIds[0] }));
                    }
                }

                // If they only manage 1 home, pre-select it
                if (managerHomeIds.length === 1) {
                    setFilters((prev) => ({ ...prev, homeId: managerHomeIds[0] }));
                }

                return;
            }
        }

        load();

        return () => {
            cancelled = true;
        };
    }, [router]);

    // Apply client-side filters on the events we have
    const filteredEvents = useMemo(() => {
        const {
            search,
            companyId,
            homeId,
            actorName,
            subjectName,
            fromDate,
            toDate,
        } = filters;

        const searchTerm = search.trim().toLowerCase();
        const actorTerm = actorName.trim().toLowerCase();
        const subjectTerm = subjectName.trim().toLowerCase();

        const fromTime = fromDate ? new Date(fromDate).getTime() : null;
        const toTime = toDate ? new Date(toDate + 'T23:59:59').getTime() : null;

        return events.filter((e) => {
            // Company / home restriction
            if (companyId && e.company_id !== companyId) return false;
            if (homeId && e.home_id !== homeId) return false;

            // Date range
            const createdAt = new Date(e.created_at).getTime();
            if (fromTime !== null && createdAt < fromTime) return false;
            if (toTime !== null && createdAt > toTime) return false;

            // Actor / subject filters
            if (
                actorTerm &&
                !(e.actor_name ?? '')
                    .toLowerCase()
                    .includes(actorTerm)
            ) {
                return false;
            }

            if (
                subjectTerm &&
                !(e.subject_name ?? '')
                    .toLowerCase()
                    .includes(subjectTerm)
            ) {
                return false;
            }

            // Free text search (summary / action / entity_type)
            if (searchTerm) {
                const blob = [
                    e.summary ?? '',
                    e.action ?? '',
                    e.entity_type ?? '',
                    e.category ?? '',
                ]
                    .join(' ')
                    .toLowerCase();

                if (!blob.includes(searchTerm)) return false;
            }

            return true;
        });
    }, [events, filters]);

    const canShowCompanyFilter = level === '1_ADMIN' || level === '2_COMPANY';
    const canShowHomeFilter = level === '1_ADMIN' || level === '2_COMPANY' || level === '3_MANAGER';

    if (loading && !level) {
        return <div className="text-sm text-neutral-400">Loading audit events…</div>;
    }

    if (error) {
        return <div className="text-sm text-red-500">{error}</div>;
    }

    if (level === '4_STAFF') {
        return null; // redirected away
    }

    return (
        <div className="space-y-5">
            <header className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                <div>
                    <h1 className="text-xl font-semibold">Audit log</h1>
                    <p className="text-sm text-neutral-500">
                        See who changed what, and when. Scope is based on your role.
                    </p>
                </div>
                <button
                    type="button"
                    className="mt-2 inline-flex items-center rounded-full border border-neutral-700 px-3 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-800/70 sm:mt-0"
                    onClick={() => setFilters(initialFilters)}
                >
                    Clear filters
                </button>
            </header>

            {/* Filters */}
            <section className="rounded-xl border border-neutral-800/70 bg-neutral-950/70 p-4">
                <div className="grid gap-3 md:grid-cols-4 lg:grid-cols-6">
                    {/* Search */}
                    <div className="md:col-span-2 lg:col-span-2">
                        <label className="mb-1 block text-xs font-medium text-neutral-400">
                            Search
                        </label>
                        <input
                            type="text"
                            placeholder="Search summary, action, entity…"
                            value={filters.search}
                            onChange={(e) =>
                                setFilters((prev) => ({ ...prev, search: e.target.value }))
                            }
                            className="w-full rounded-lg border border-neutral-700/70 bg-neutral-900/80 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-violet-500/70"
                        />
                    </div>

                    {/* Company */}
                    {canShowCompanyFilter && (
                        <div>
                            <label className="mb-1 block text-xs font-medium text-neutral-400">
                                Company
                            </label>
                            <select
                                value={filters.companyId}
                                onChange={(e) =>
                                    setFilters((prev) => ({
                                        ...prev,
                                        companyId: e.target.value,
                                        homeId: '', // reset home when company changes
                                    }))
                                }
                                className="w-full rounded-lg border border-neutral-700/70 bg-neutral-900/80 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-2 focus:ring-violet-500/70"
                            >
                                <option value="">All</option>
                                {companies.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.name ?? 'Unnamed company'}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Home */}
                    {canShowHomeFilter && (
                        <div>
                            <label className="mb-1 block text-xs font-medium text-neutral-400">
                                Home
                            </label>
                            <select
                                value={filters.homeId}
                                onChange={(e) =>
                                    setFilters((prev) => ({
                                        ...prev,
                                        homeId: e.target.value,
                                    }))
                                }
                                className="w-full rounded-lg border border-neutral-700/70 bg-neutral-900/80 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-2 focus:ring-violet-500/70"
                            >
                                <option value="">All</option>
                                {homes
                                    .filter((h) =>
                                        filters.companyId
                                            ? h.company_id === filters.companyId
                                            : true,
                                    )
                                    .map((h) => (
                                        <option key={h.id} value={h.id}>
                                            {h.name ?? 'Unnamed home'}
                                        </option>
                                    ))}
                            </select>
                        </div>
                    )}

                    {/* Actor */}
                    <div>
                        <label className="mb-1 block text-xs font-medium text-neutral-400">
                            Actor name
                        </label>
                        <input
                            type="text"
                            value={filters.actorName}
                            onChange={(e) =>
                                setFilters((prev) => ({
                                    ...prev,
                                    actorName: e.target.value,
                                }))
                            }
                            placeholder="Who did it"
                            className="w-full rounded-lg border border-neutral-700/70 bg-neutral-900/80 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-violet-500/70"
                        />
                    </div>

                    {/* Subject */}
                    <div>
                        <label className="mb-1 block text-xs font-medium text-neutral-400">
                            Subject name
                        </label>
                        <input
                            type="text"
                            value={filters.subjectName}
                            onChange={(e) =>
                                setFilters((prev) => ({
                                    ...prev,
                                    subjectName: e.target.value,
                                }))
                            }
                            placeholder="Who it affected"
                            className="w-full rounded-lg border border-neutral-700/70 bg-neutral-900/80 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-violet-500/70"
                        />
                    </div>

                    {/* Date range */}
                    <div className="md:col-span-2 lg:col-span-2">
                        <label className="mb-1 block text-xs font-medium text-neutral-400">
                            Date range
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="date"
                                value={filters.fromDate}
                                onChange={(e) =>
                                    setFilters((prev) => ({
                                        ...prev,
                                        fromDate: e.target.value,
                                    }))
                                }
                                className="flex-1 rounded-lg border border-neutral-700/70 bg-neutral-900/80 px-3 py-2 text-xs text-neutral-100 focus:outline-none focus:ring-2 focus:ring-violet-500/70"
                            />
                            <input
                                type="date"
                                value={filters.toDate}
                                onChange={(e) =>
                                    setFilters((prev) => ({
                                        ...prev,
                                        toDate: e.target.value,
                                    }))
                                }
                                className="flex-1 rounded-lg border border-neutral-700/70 bg-neutral-900/80 px-3 py-2 text-xs text-neutral-100 focus:outline-none focus:ring-2 focus:ring-violet-500/70"
                            />
                        </div>
                    </div>
                </div>
            </section>

            {/* Table */}
            <section className="overflow-hidden rounded-xl border border-neutral-800/70 bg-neutral-950/80">
                <table className="min-w-full text-sm">
                    <thead className="bg-neutral-900/80 text-neutral-300">
                        <tr>
                            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                                When
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                                Actor
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                                Subject
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                                Scope
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                                Category / Action
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                                Summary
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-800/80">
                        {filteredEvents.map((e) => {
                            const companyName =
                                companies.find((c) => c.id === e.company_id)?.name ?? null;
                            const homeName =
                                homes.find((h) => h.id === e.home_id)?.name ?? null;

                            return (
                                <tr key={e.id} className="hover:bg-neutral-900/60">
                                    {/* When */}
                                    <td className="px-3 py-2 align-top text-xs text-neutral-400">
                                        <div>
                                            {new Date(e.created_at).toLocaleString(undefined, {
                                                dateStyle: 'short',
                                                timeStyle: 'short',
                                            })}
                                        </div>
                                    </td>

                                    {/* Actor */}
                                    <td className="px-3 py-2 align-top">
                                        <div className="text-sm font-medium text-neutral-100">
                                            {e.actor_name ?? 'Unknown'}
                                        </div>
                                        <div className="text-[11px] text-neutral-500">
                                            {e.actor_email ?? ''}
                                        </div>
                                        {e.actor_level && (
                                            <div className="mt-1 inline-flex rounded-full bg-neutral-800/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-300">
                                                {e.actor_level}
                                            </div>
                                        )}
                                    </td>

                                    {/* Subject */}
                                    <td className="px-3 py-2 align-top text-sm text-neutral-100">
                                        {e.subject_name ?? '—'}
                                    </td>

                                    {/* Scope (company / home) */}
                                    <td className="px-3 py-2 align-top text-xs text-neutral-300">
                                        {companyName && (
                                            <div className="truncate">{companyName}</div>
                                        )}
                                        {homeName && (
                                            <div className="truncate text-neutral-500">
                                                {homeName}
                                            </div>
                                        )}
                                        {!companyName && !homeName && (
                                            <span className="text-neutral-500">Global</span>
                                        )}
                                    </td>

                                    {/* Category / Action */}
                                    <td className="px-3 py-2 align-top text-xs">
                                        <div className="mb-1 inline-flex rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-200">
                                            {e.category}
                                        </div>
                                        <div className="text-sm text-neutral-100">{e.action}</div>
                                        <div className="text-[11px] text-neutral-500">
                                            {e.entity_type}
                                            {e.entity_id ? ` • ${e.entity_id}` : ''}
                                        </div>
                                    </td>

                                    {/* Summary */}
                                    <td className="px-3 py-2 align-top text-sm text-neutral-100">
                                        {e.summary ?? '—'}
                                    </td>
                                </tr>
                            );
                        })}

                        {filteredEvents.length === 0 && (
                            <tr>
                                <td className="px-3 py-6 text-center text-sm text-neutral-500" colSpan={6}>
                                    No audit events match your filters.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </section>
        </div>
    );
}

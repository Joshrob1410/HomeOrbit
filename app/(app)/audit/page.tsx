'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/supabase/client';
import { getEffectiveLevel, type AppLevel } from '@/supabase/roles';

// JSON helper type
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
    toDate: string; // yyyy-mm-dd
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

// Helpers for rendering "what changed"
type FieldChange = {
    label: string;
    oldValue: string;
    newValue: string;
};

type JsonObject = { [key: string]: Json };

function isJsonObject(value: Json | null): value is JsonObject {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

// Nice labels for known fields (courses etc. + rota bits)
const FIELD_LABELS: Record<string, string> = {
    name: 'Name',
    training_type: 'Type',
    mandatory: 'Mandatory',
    refresher_years: 'Refresher (years)',
    due_soon_days: 'Due soon (days)',
    link: 'Link',

    // Rota / people bits
    user_id: 'Person',
    subject_user_id: 'Person',
    shift_type_id: 'Shift type',
    hours: 'Hours',
    status: 'Status',
};

function formatAuditValue(
    value: Json | undefined,
    fieldKey: string,
    userLookup: Record<string, string>,
    shiftTypeLookup: Record<string, string>,
): string {
    if (value === null || value === undefined) return '—';

    // Foreign keys → nice labels
    if (fieldKey === 'user_id' || fieldKey === 'subject_user_id') {
        if (typeof value === 'string') {
            const name = userLookup[value];
            if (name) return name;
            // Fallback: abbreviated UUID so it’s less ugly
            return value.length > 8 ? `${value.slice(0, 8)}…` : value;
        }
    }

    if (fieldKey === 'shift_type_id') {
        if (typeof value === 'string') {
            const label = shiftTypeLookup[value];
            if (label) return label;
            return value.length > 8 ? `${value.slice(0, 8)}…` : value;
        }
    }

    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
}

// Look for meta keys like "name_old" / "name_new" and turn them into changes
function extractFieldChangesFromMeta(
    meta: Json | null,
    userLookup: Record<string, string>,
    shiftTypeLookup: Record<string, string>,
): FieldChange[] {
    if (!isJsonObject(meta)) return [];

    const changes: FieldChange[] = [];
    const obj = meta as JsonObject;

    for (const key of Object.keys(obj)) {
        if (!key.endsWith('_old')) continue;

        const base = key.slice(0, -4); // strip "_old"
        const newKey = `${base}_new`;
        if (!(newKey in obj)) continue;

        const oldVal = obj[key];
        const newVal = obj[newKey];

        // Skip if nothing actually changed
        if (JSON.stringify(oldVal) === JSON.stringify(newVal)) continue;

        const label =
            FIELD_LABELS[base] ??
            base
                .split('_')
                .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                .join(' ');

        changes.push({
            label,
            oldValue: formatAuditValue(oldVal, base, userLookup, shiftTypeLookup),
            newValue: formatAuditValue(newVal, base, userLookup, shiftTypeLookup),
        });
    }

    return changes;
}

// Full field-change extractor: try meta, then fall back to diff.old/new
function extractFieldChanges(
    event: AuditEvent,
    userLookup: Record<string, string>,
    shiftTypeLookup: Record<string, string>,
): FieldChange[] {
    // 1) Prefer explicit *_old / *_new in meta if present
    const fromMeta = extractFieldChangesFromMeta(event.meta, userLookup, shiftTypeLookup);
    if (fromMeta.length > 0) return fromMeta;

    // 2) Fallback: compare diff.old vs diff.new if diff has that shape
    if (!isJsonObject(event.diff)) return [];

    const diffObj = event.diff as JsonObject;
    const oldRaw = diffObj['old'];
    const newRaw = diffObj['new'];

    if (!isJsonObject(oldRaw) || !isJsonObject(newRaw)) return [];

    const oldObj = oldRaw as JsonObject;
    const newObj = newRaw as JsonObject;

    const keys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
    const changes: FieldChange[] = [];

    for (const key of keys) {
        // Skip boring / noisy fields
        if (['id', 'created_at', 'updated_at', 'company_id', 'home_id'].includes(key)) {
            continue;
        }

        const oldVal = oldObj[key];
        const newVal = newObj[key];

        // No real change
        if (JSON.stringify(oldVal) === JSON.stringify(newVal)) continue;

        const label =
            FIELD_LABELS[key] ??
            key
                .split('_')
                .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                .join(' ');

        changes.push({
            label,
            oldValue: formatAuditValue(oldVal, key, userLookup, shiftTypeLookup),
            newValue: formatAuditValue(newVal, key, userLookup, shiftTypeLookup),
        });
    }

    return changes;
}

function renderDetailsCell(
    event: AuditEvent,
    userLookup: Record<string, string>,
    shiftTypeLookup: Record<string, string>,
): React.ReactNode {
    const changes = extractFieldChanges(event, userLookup, shiftTypeLookup);

    if (changes.length === 0) {
        // No field-level diff captured for this event
        return <span className="text-xs text-neutral-500">—</span>;
    }

    if (changes.length === 1) {
        const c = changes[0];
        return (
            <div className="text-xs text-neutral-100">
                <span className="font-medium">{c.label}: </span>
                <span className="line-through text-neutral-500 mr-1">{c.oldValue}</span>
                <span>→ {c.newValue}</span>
            </div>
        );
    }

    return (
        <details className="group text-xs text-neutral-100">
            <summary className="cursor-pointer text-neutral-300">
                {changes.length} field{changes.length > 1 ? 's' : ''} changed
            </summary>
            <ul className="mt-1 list-disc pl-4 space-y-0.5 text-neutral-100">
                {changes.map((c) => (
                    <li key={c.label}>
                        <span className="font-medium">{c.label}: </span>
                        <span className="line-through text-neutral-500 mr-1">{c.oldValue}</span>
                        <span>→ {c.newValue}</span>
                    </li>
                ))}
            </ul>
        </details>
    );
}

export default function AuditPage() {
    const router = useRouter();

    const [level, setLevel] = useState<AppLevel | null>(null);
    const [events, setEvents] = useState<AuditEvent[]>([]);
    const [companies, setCompanies] = useState<CompanyRow[]>([]);
    const [homes, setHomes] = useState<HomeRow[]>([]);
    const [filters, setFilters] = useState<Filters>(initialFilters);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Lookups: user_id → name, shift_type_id → "CODE — Label"
    const [userLookup, setUserLookup] = useState<Record<string, string>>({});
    const [shiftTypeLookup, setShiftTypeLookup] = useState<Record<string, string>>({});

    useEffect(() => {
        let cancelled = false;

        async function load() {
            try {
                setLoading(true);
                setError(null);

                const lvl = await getEffectiveLevel();
                if (cancelled) return;

                setLevel(lvl);

                // Staff have no access at all
                if (lvl === '4_STAFF') {
                    router.replace('/dashboard');
                    return;
                }

                // 1) Load audit events (RLS should already scope by user)
                const { data: eventsData, error: eventsError } = await supabase
                    .from('audit_events')
                    .select('*')
                    .order('created_at', { ascending: false })
                    .limit(500);

                if (cancelled) return;

                if (eventsError) {
                    // eslint-disable-next-line no-console
                    console.error(eventsError);
                    setError('Failed to load audit events.');
                } else {
                    setEvents((eventsData ?? []) as AuditEvent[]);
                }

                // 2) Load companies / homes for filter dropdowns based on role
                await loadFilterScope(lvl, cancelled);
            } catch (err) {
                if (!cancelled) {
                    // eslint-disable-next-line no-console
                    console.error(err);
                    setError('Something went wrong while loading audit data.');
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        async function loadFilterScope(lvl: AppLevel, cancelledInner: boolean) {
            if (cancelledInner) return;

            // Admin: can see everything
            if (lvl === '1_ADMIN') {
                const [{ data: companiesData }, { data: homesData }] = await Promise.all([
                    supabase.from('companies').select('id, name').order('name'),
                    supabase.from('homes').select('id, name, company_id').order('name'),
                ]);

                if (cancelledInner) return;

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

                if (cancelledInner) return;

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

                if (cancelledInner) return;

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

                if (cancelledInner) return;

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

                if (cancelledInner) return;

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

                    if (cancelledInner) return;

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
            }
        }

        load();

        return () => {
            cancelled = true;
        };
    }, [router]);

    // Build lookups for user_id / shift_type_id from events
    useEffect(() => {
        let cancelled = false;

        async function hydrateLookups() {
            if (!events.length) {
                setUserLookup({});
                setShiftTypeLookup({});
                return;
            }

            const userIds = new Set<string>();
            const shiftTypeIds = new Set<string>();
            const uuidish =
                /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

            for (const e of events) {
                const metaObj = isJsonObject(e.meta) ? (e.meta as JsonObject) : null;
                const diffObj = isJsonObject(e.diff) ? (e.diff as JsonObject) : null;

                // From meta (e.g. user_id_old/user_id_new, shift_type_id_old/_new)
                if (metaObj) {
                    for (const [key, val] of Object.entries(metaObj)) {
                        if (typeof val !== 'string') continue;

                        if (key.includes('user_id') && uuidish.test(val)) {
                            userIds.add(val);
                        }
                        if (key.includes('shift_type_id') && uuidish.test(val)) {
                            shiftTypeIds.add(val);
                        }
                    }
                }

                // From diff.old / diff.new
                if (diffObj) {
                    const collect = (obj: Json | undefined) => {
                        if (!isJsonObject(obj ?? null)) return;
                        const jsonObj = obj as JsonObject;
                        for (const [key, val] of Object.entries(jsonObj)) {
                            if (typeof val !== 'string') continue;

                            if (key === 'user_id' && uuidish.test(val)) {
                                userIds.add(val);
                            }
                            if (key === 'shift_type_id' && uuidish.test(val)) {
                                shiftTypeIds.add(val);
                            }
                        }
                    };

                    collect(diffObj.old);
                    collect(diffObj.new);
                }

                // Also include subject_user_id at top level
                if (e.subject_user_id && uuidish.test(e.subject_user_id)) {
                    userIds.add(e.subject_user_id);
                }
            }

            const userIdList = Array.from(userIds);
            const shiftTypeIdList = Array.from(shiftTypeIds);

            const [profilesRes, shiftTypesRes] = await Promise.all([
                userIdList.length
                    ? supabase
                        .from('profiles')
                        .select('user_id, full_name')
                        .in('user_id', userIdList)
                    : Promise.resolve<{
                        data: { user_id: string; full_name: string | null }[];
                        error: null;
                    }>({
                        data: [],
                        error: null,
                    }),
                shiftTypeIdList.length
                    ? supabase
                        .from('shift_types')
                        .select('id, code, label')
                        .in('id', shiftTypeIdList)
                    : Promise.resolve<{
                        data: { id: string; code: string | null; label: string | null }[];
                        error: null;
                    }>({
                        data: [],
                        error: null,
                    }),
            ]);


            if (cancelled) return;

            if (profilesRes.error) {
                // eslint-disable-next-line no-console
                console.error(profilesRes.error);
            }
            if (shiftTypesRes.error) {
                // eslint-disable-next-line no-console
                console.error(shiftTypesRes.error);
            }

            const newUserLookup: Record<string, string> = {};
            for (const row of profilesRes.data ?? []) {
                const rowUserId = row.user_id as string | null;
                const rowName = (row.full_name as string | null) ?? '';
                if (rowUserId) {
                    newUserLookup[rowUserId] = rowName || rowUserId;
                }
            }

            const newShiftTypeLookup: Record<string, string> = {};
            for (const row of shiftTypesRes.data ?? []) {
                const id = row.id as string | null;
                const code = row.code as string | null;
                const label = row.label as string | null;
                if (!id) continue;

                if (code && label) {
                    newShiftTypeLookup[id] = `${code} — ${label}`;
                } else if (code || label) {
                    newShiftTypeLookup[id] = (code ?? label) as string;
                } else {
                    newShiftTypeLookup[id] = id;
                }
            }

            setUserLookup(newUserLookup);
            setShiftTypeLookup(newShiftTypeLookup);
        }

        void hydrateLookups();

        return () => {
            cancelled = true;
        };
    }, [events]);

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
        const toTime = toDate ? new Date(`${toDate}T23:59:59`).getTime() : null;

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
    const canShowHomeFilter =
        level === '1_ADMIN' || level === '2_COMPANY' || level === '3_MANAGER';

    const LEVEL_LABELS: Record<AppLevel, string> = {
        '1_ADMIN': 'Admin',
        '2_COMPANY': 'Company',
        '3_MANAGER': 'Manager',
        '4_STAFF': 'Staff',
    };

    function formatEntityTypeLabel(raw: string | null): string {
        if (!raw) return '—';

        const lower = raw.toLowerCase();

        // Optional explicit overrides
        if (lower === 'course') return 'Course';
        if (lower === 'training_record') return 'Training record';

        // Generic: snake/upper-case -> nice words
        return raw
            .toLowerCase()
            .split(/[_ ]+/)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ');
    }

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
                            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                                Details
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-800/80">
                        {filteredEvents.map((e) => {
                            const companyName =
                                companies.find((c) => c.id === e.company_id)?.name ?? null;
                            const homeName =
                                homes.find((h) => h.id === e.home_id)?.name ?? null;

                            // Subject: prefer stored subject_name, but we could later fall back
                            // to userLookup[e.subject_user_id] if you want.
                            const subjectDisplay = e.subject_name ?? '—';

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
                                                {LEVEL_LABELS[e.actor_level as AppLevel] ??
                                                    e.actor_level}
                                            </div>
                                        )}
                                    </td>

                                    {/* Subject */}
                                    <td className="px-3 py-2 align-top text-sm text-neutral-100">
                                        {subjectDisplay}
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
                                        <div className="text-sm text-neutral-100">
                                            {e.action}
                                        </div>
                                        <div className="text-[11px] text-neutral-500">
                                            {formatEntityTypeLabel(e.entity_type)}
                                            {/* entity_id deliberately hidden – internal ID, not user-friendly */}
                                        </div>
                                    </td>

                                    {/* Summary */}
                                    <td className="px-3 py-2 align-top text-sm text-neutral-100">
                                        {e.summary ?? '—'}
                                    </td>

                                    {/* Details (field-level changes from meta/diff) */}
                                    <td className="px-3 py-2 align-top text-xs text-neutral-100">
                                        {renderDetailsCell(e, userLookup, shiftTypeLookup)}
                                    </td>
                                </tr>
                            );
                        })}

                        {filteredEvents.length === 0 && (
                            <tr>
                                <td
                                    className="px-3 py-6 text-center text-sm text-neutral-500"
                                    colSpan={7}
                                >
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

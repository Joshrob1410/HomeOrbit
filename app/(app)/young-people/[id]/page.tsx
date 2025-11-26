// app/(app)/young-people/[id]/page.tsx
'use client';

import Link from 'next/link';
import { use, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/supabase/client';
import { getEffectiveLevel, type AppLevel } from '@/supabase/roles';
/** ========= Branding ========= */
const BRAND_GRADIENT =
    'linear-gradient(135deg, #7C3AED 0%, #6366F1 50%, #3B82F6 100%)';

type Level = AppLevel;

type YoungPerson = {
    id: string;
    company_id: string;
    home_id: string | null;
    full_name: string;
    date_of_birth: string | null;
    legal_status: string | null;
    created_at: string | null;
};

type HeadKey = 'YOUNG_PEOPLE' | 'CARS' | 'HOME';
type FormStatus = 'DRAFT' | 'PUBLISHED';
type FormType = 'FIXED' | 'ADJUSTABLE';

type YoungPersonFormBlueprint = {
    id: string;
    company_id: string;
    head: HeadKey;
    name: string;
    status: FormStatus;
    form_type: FormType;
    updated_at: string | null;
};

type ViewState =
    | { status: 'loading' }
    | { status: 'signed_out' }
    | { status: 'not_found' }
    | {
        status: 'ready';
        level: Level;
        youngPerson: YoungPerson;
        homeName: string | null;
        companyName: string | null;
    };

function formatDate(dateStr: string | null): string | null {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString();
}

function calculateAge(dateStr: string | null): string | null {
    if (!dateStr) return null;
    const dob = new Date(dateStr);
    if (Number.isNaN(dob.getTime())) return null;

    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const m = today.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
        age--;
    }
    if (age < 0 || age > 120) return null;
    return `${age} year${age === 1 ? '' : 's'}`;
}

export default function Page({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    // ✅ New Next.js 15 pattern
    const { id } = use(params);

    const [view, setView] = useState<ViewState>({ status: 'loading' });

    // Forms UI state
    const [availableForms, setAvailableForms] = useState<
        YoungPersonFormBlueprint[]
    >([]);
    const [loadingForms, setLoadingForms] = useState(false);
    const [formPickerOpen, setFormPickerOpen] = useState(false);
    const [startingFormId, setStartingFormId] = useState<string | null>(null);
    const [startFormError, setStartFormError] = useState<string | null>(null);
    const [formSearch, setFormSearch] = useState('');

    // Derived: filtered forms for the search box
    const visibleForms = useMemo(() => {
        const trimmed = formSearch.trim().toLowerCase();
        if (!trimmed) return availableForms;
        return availableForms.filter((form) =>
            form.name.toLowerCase().includes(trimmed)
        );
    }, [availableForms, formSearch]);

    /** ========= Load young person + basic info ========= */
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

            const { data: yp, error } = await supabase
                .from('young_people')
                .select(
                    'id, company_id, home_id, full_name, date_of_birth, legal_status, created_at'
                )
                .eq('id', id)
                .maybeSingle();

            if (cancelled) return;

            if (error || !yp) {
                console.error('❌ load young_person failed', error);
                setView({ status: 'not_found' });
                return;
            }

            // Fetch home + company names
            // Load home + company names (sequential; simple + no `any`)
            let homeName: string | null = null;
            if (yp.home_id) {
                const { data: homeRow, error: homeErr } = await supabase
                    .from('homes')
                    .select('id, name')
                    .eq('id', yp.home_id)
                    .maybeSingle();

                if (!homeErr && homeRow) {
                    homeName = homeRow.name;
                }
            }

            let companyName: string | null = null;
            {
                const { data: companyRow, error: companyErr } = await supabase
                    .from('companies')
                    .select('id, name')
                    .eq('id', yp.company_id)
                    .maybeSingle();

                if (!companyErr && companyRow) {
                    companyName = companyRow.name;
                }
            }

            if (cancelled) return;

            setView({
                status: 'ready',
                level: lvl,
                youngPerson: yp as YoungPerson,
                homeName,
                companyName,
            });
        })();

        return () => {
            cancelled = true;
        };
    }, [id]);

    /** ========= Load published young-people forms for this company ========= */
    useEffect(() => {
        if (view.status !== 'ready') return;

        let cancelled = false;
        setLoadingForms(true);
        setStartFormError(null);

        (async () => {
            const companyId = view.youngPerson.company_id;

            const { data, error } = await supabase
                .from('form_blueprints')
                .select(
                    'id, company_id, head, name, status, form_type, updated_at'
                )
                .eq('company_id', companyId)
                .eq('head', 'YOUNG_PEOPLE')
                .eq('status', 'PUBLISHED')
                .order('name', { ascending: true });

            if (cancelled) return;

            if (error) {
                console.error(
                    '❌ load young-people form_blueprints failed',
                    error
                );
                setAvailableForms([]);
                setStartFormError(
                    'Could not load forms for this young person.'
                );
            } else {
                setAvailableForms(
                    (data ?? []) as YoungPersonFormBlueprint[]
                );
            }

            setLoadingForms(false);
        })();

        return () => {
            cancelled = true;
        };
    }, [view]);

    /** ========= Start a form (call API + redirect) ========= */
    const handleStartForm = async (blueprintId: string) => {
        if (view.status !== 'ready') return;

        setStartFormError(null);
        setStartingFormId(blueprintId);

        try {
            const { data: s } = await supabase.auth.getSession();
            const accessToken = s?.session?.access_token;

            if (!accessToken) {
                setStartFormError('You are not signed in.');
                setStartingFormId(null);
                return;
            }

            const res = await fetch('/api/forms/start', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${accessToken}`,
                },
                body: JSON.stringify({
                    youngPersonId: view.youngPerson.id,
                    blueprintId,
                }),
            });

            let json: unknown = null;
            try {
                json = await res.json();
            } catch {
                json = null;
            }

            if (!res.ok) {
                let msg = 'Something went wrong while starting the form.';

                if (
                    json &&
                    typeof json === 'object' &&
                    'error' in json
                ) {
                    const errorVal = (json as Record<string, unknown>).error;
                    if (typeof errorVal === 'string') {
                        msg = errorVal;
                    }
                }

                setStartFormError(msg);
                setStartingFormId(null);
                return;
            }

            let entryId: string | null = null;
            if (
                json &&
                typeof json === 'object' &&
                'entryId' in json
            ) {
                const entryVal = (json as Record<string, unknown>).entryId;
                if (typeof entryVal === 'string') {
                    entryId = entryVal;
                }
            }

            if (!entryId) {
                setStartFormError(
                    'Form started but response was missing an entry ID.'
                );
                setStartingFormId(null);
                return;
            }


            setFormPickerOpen(false);
            setStartingFormId(null);

            // ✅ Go to the runtime page
            window.location.href = `/young-people/${view.youngPerson.id}/forms/${entryId}`;
        } catch (err) {
            console.error('❌ handleStartForm failed', err);
            setStartFormError(
                'Unexpected error while starting the form. Please try again.'
            );
            setStartingFormId(null);
        }
    };

    /** ========= Guards ========= */
    if (view.status === 'loading') {
        return (
            <div className="p-4 md:p-6" style={{ color: 'var(--sub)' }}>
                Loading young person…
            </div>
        );
    }

    if (view.status === 'signed_out') {
        return null;
    }

    if (view.status === 'not_found') {
        return (
            <div className="p-4 md:p-6 space-y-4">
                <div>
                    <Link
                        href="/young-people"
                        className="text-xs hover:underline"
                        style={{ color: 'var(--sub)' }}
                    >
                        ← Back to young people
                    </Link>
                </div>
                <div
                    className="rounded-xl p-4 md:p-5 ring-1"
                    style={{
                        background: 'var(--card-grad)',
                        borderColor: 'var(--ring)',
                        color: 'var(--ink)',
                    }}
                >
                    <h1 className="text-lg md:text-xl font-semibold mb-1">
                        Young person not found
                    </h1>
                    <p className="text-sm" style={{ color: 'var(--sub)' }}>
                        This young person either doesn&apos;t exist or you
                        don&apos;t have permission to view their file.
                    </p>
                </div>
            </div>
        );
    }

    const { youngPerson: yp, homeName, companyName } = view;
    const dobLabel = formatDate(yp.date_of_birth);
    const ageLabel = calculateAge(yp.date_of_birth);

    return (
        <div className="p-4 md:p-6 space-y-6">
            {/* Back link */}
            <div>
                <Link
                    href="/young-people"
                    className="text-xs hover:underline"
                    style={{ color: 'var(--sub)' }}
                >
                    ← Back to young people
                </Link>
            </div>

            {/* Header card */}
            <div
                className="rounded-xl ring-1 px-4 py-4 md:px-5 md:py-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4"
                style={{
                    background: 'var(--card-grad)',
                    borderColor: 'var(--ring)',
                }}
            >
                <div className="flex items-start gap-3 md:gap-4">
                    {/* Avatar */}
                    <div
                        className="flex h-12 w-12 md:h-14 md:w-14 items-center justify-center rounded-full text-2xl md:text-3xl"
                        style={{
                            background: 'rgba(124,58,237,0.18)',
                            color: 'var(--ink)',
                        }}
                    >
                        <span className="translate-y-[1px]">🧍</span>
                    </div>

                    {/* Name + tags */}
                    <div className="space-y-1">
                        <h1
                            className="text-lg md:text-2xl font-semibold tracking-tight"
                            style={{ color: 'var(--ink)' }}
                        >
                            {yp.full_name}
                        </h1>

                        <div className="flex flex-wrap gap-2 text-[11px] md:text-xs mt-1">
                            {homeName && (
                                <span
                                    className="inline-flex items-center rounded-full px-2 py-[2px]"
                                    style={{
                                        background: 'rgba(148,163,184,0.16)',
                                        color: 'var(--sub)',
                                    }}
                                >
                                    🏠 {homeName}
                                </span>
                            )}
                            {companyName && (
                                <span
                                    className="inline-flex items-center rounded-full px-2 py-[2px]"
                                    style={{
                                        background: 'rgba(148,163,184,0.16)',
                                        color: 'var(--sub)',
                                    }}
                                >
                                    🏢 {companyName}
                                </span>
                            )}
                            {yp.legal_status && (
                                <span
                                    className="inline-flex items-center rounded-full px-2 py-[2px]"
                                    style={{
                                        background: 'rgba(59,130,246,0.18)',
                                        color: 'var(--ink)',
                                    }}
                                >
                                    📄 {yp.legal_status}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Quick info */}
                <div className="flex flex-row md:flex-col gap-4 md:items-end text-sm">
                    <div className="space-y-1 text-right md:text-right">
                        <div
                            className="text-xs uppercase tracking-wide"
                            style={{ color: 'var(--sub)' }}
                        >
                            Date of birth
                        </div>
                        <div style={{ color: 'var(--ink)' }}>
                            {dobLabel || '—'}
                        </div>
                        {ageLabel && (
                            <div
                                className="text-xs"
                                style={{ color: 'var(--sub)' }}
                            >
                                {ageLabel}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Logs/forms area */}
            <div
                className="rounded-xl ring-1 p-4 md:p-5 space-y-3"
                style={{
                    background: 'var(--card-grad)',
                    borderColor: 'var(--ring)',
                }}
            >
                <div className="flex items-center justify-between gap-2">
                    <div
                        className="font-medium text-sm md:text-base"
                        style={{ color: 'var(--ink)' }}
                    >
                        Logs & forms
                    </div>

                    <button
                        type="button"
                        onClick={() => setFormPickerOpen(true)}
                        disabled={
                            loadingForms ||
                            (!loadingForms && availableForms.length === 0)
                        }
                        className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs md:text-sm font-medium ring-1 transition-transform hover:-translate-y-[0.5px]"
                        style={{
                            background:
                                availableForms.length > 0 && !loadingForms
                                    ? BRAND_GRADIENT
                                    : 'var(--panel-bg)',
                            borderColor: 'var(--ring)',
                            color:
                                availableForms.length > 0 && !loadingForms
                                    ? '#FFFFFF'
                                    : 'var(--sub)',
                            opacity: loadingForms ? 0.7 : 1,
                        }}
                    >
                        {loadingForms
                            ? 'Loading forms…'
                            : availableForms.length === 0
                                ? 'No forms available'
                                : 'New form'}
                    </button>
                </div>

                <p className="text-sm" style={{ color: 'var(--sub)' }}>
                    Start a new form for this young person using the templates
                    set up in your company&apos;s Form Builder. Existing
                    submissions and log history will appear here as the module
                    grows.
                </p>

                {startFormError && (
                    <p
                        className="text-xs mt-1"
                        style={{ color: '#F97373' }}
                    >
                        {startFormError}
                    </p>
                )}
            </div>

            {/* Form picker modal */}
            {formPickerOpen && (
                <div className="fixed inset-0 z-40 flex items-center justify-center px-4">
                    {/* Backdrop */}
                    <div
                        className="absolute inset-0"
                        style={{
                            background:
                                'radial-gradient(circle at top, rgba(15,23,42,0.85), rgba(2,6,23,0.95))',
                        }}
                        onClick={() => {
                            if (!startingFormId) {
                                setFormPickerOpen(false);
                                setStartFormError(null);
                                setFormSearch('');
                            }
                        }}
                    />

                    {/* Panel */}
                    <div
                        className="relative z-50 w-full max-w-2xl rounded-2xl ring-1 shadow-2xl p-4 md:p-6 space-y-4"
                        style={{
                            background: 'var(--panel-bg)',
                            borderColor: 'var(--ring-strong)',
                        }}
                    >
                        {/* Header */}
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h2
                                    className="text-sm md:text-base font-semibold"
                                    style={{ color: 'var(--ink)' }}
                                >
                                    Start a form for {yp.full_name}
                                </h2>
                                <p
                                    className="text-xs mt-1"
                                    style={{ color: 'var(--sub)' }}
                                >
                                    Choose a template and we&apos;ll create a new form
                                    entry linked to this young person.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    if (!startingFormId) {
                                        setFormPickerOpen(false);
                                        setStartFormError(null);
                                        setFormSearch('');
                                    }
                                }}
                                className="rounded-full px-2 py-1 text-xs hover:bg-slate-800/40"
                                style={{ color: 'var(--sub)' }}
                            >
                                ✕
                            </button>
                        </div>

                        {/* Search + meta row */}
                        <div className="grid gap-3 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.2fr)] items-end">
                            <div className="space-y-1">
                                <label
                                    className="block text-xs"
                                    style={{ color: 'var(--sub)' }}
                                >
                                    Search forms
                                </label>
                                <input
                                    type="text"
                                    className="w-full rounded-md px-2 py-2 text-sm ring-1"
                                    style={{
                                        background: 'var(--nav-item-bg)',
                                        color: 'var(--ink)',
                                        borderColor: 'var(--ring)',
                                    }}
                                    placeholder="Start typing to filter templates…"
                                    value={formSearch}
                                    onChange={(e) => setFormSearch(e.target.value)}
                                    disabled={loadingForms || availableForms.length === 0}
                                />
                            </div>
                            <div className="space-y-1 text-right">
                                <div
                                    className="text-[11px] uppercase tracking-wide"
                                    style={{ color: 'var(--sub)' }}
                                >
                                    Templates
                                </div>
                                <div className="text-xs" style={{ color: 'var(--sub)' }}>
                                    {loadingForms
                                        ? 'Loading…'
                                        : availableForms.length === 0
                                            ? 'No forms available yet'
                                            : `${visibleForms.length} of ${availableForms.length} template${availableForms.length === 1 ? '' : 's'
                                            }`}
                                </div>
                            </div>
                        </div>

                        {/* List area */}
                        <div className="max-h-[420px] overflow-y-auto mt-1">
                            {loadingForms ? (
                                <div
                                    className="py-8 text-sm text-center"
                                    style={{ color: 'var(--sub)' }}
                                >
                                    Loading forms…
                                </div>
                            ) : availableForms.length === 0 ? (
                                <div
                                    className="py-8 text-sm text-center"
                                    style={{ color: 'var(--sub)' }}
                                >
                                    There are no published young people forms set up for
                                    your company yet.
                                </div>
                            ) : visibleForms.length === 0 ? (
                                <div
                                    className="py-8 text-sm text-center"
                                    style={{ color: 'var(--sub)' }}
                                >
                                    No forms match your search.
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {visibleForms.map((form) => {
                                        const isBusy = startingFormId === form.id;
                                        const updatedLabel = form.updated_at
                                            ? new Date(
                                                form.updated_at
                                            ).toLocaleDateString()
                                            : null;

                                        return (
                                            <button
                                                key={form.id}
                                                type="button"
                                                onClick={() =>
                                                    isBusy
                                                        ? undefined
                                                        : handleStartForm(form.id)
                                                }
                                                className="text-left rounded-xl ring-1 px-3 py-3 md:px-4 md:py-3.5 transition-transform hover:-translate-y-[1px] hover:shadow-md"
                                                style={{
                                                    background: 'var(--nav-item-bg)',
                                                    borderColor: 'var(--ring)',
                                                    opacity: isBusy ? 0.7 : 1,
                                                }}
                                            >
                                                <div className="flex flex-col gap-2">
                                                    <div className="space-y-1">
                                                        <div
                                                            className="text-sm md:text-base font-semibold"
                                                            style={{
                                                                color: 'var(--ink)',
                                                            }}
                                                        >
                                                            {form.name}
                                                        </div>
                                                        <div className="flex flex-wrap gap-2 text-[11px]">
                                                            <span
                                                                className="inline-flex items-center rounded-full px-2 py-[2px]"
                                                                style={{
                                                                    background:
                                                                        'rgba(148,163,184,0.16)',
                                                                    color: 'var(--sub)',
                                                                }}
                                                            >
                                                                {form.form_type === 'FIXED'
                                                                    ? 'Same across company'
                                                                    : 'Adjustable per home'}
                                                            </span>
                                                            {updatedLabel && (
                                                                <span
                                                                    className="inline-flex items-center rounded-full px-2 py-[2px]"
                                                                    style={{
                                                                        background:
                                                                            'transparent',
                                                                        color: 'var(--sub)',
                                                                    }}
                                                                >
                                                                    Updated {updatedLabel}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div
                                                        className="text-xs md:text-[11px] font-medium self-end"
                                                        style={{
                                                            color: isBusy
                                                                ? 'var(--sub)'
                                                                : '#A855F7',
                                                        }}
                                                    >
                                                        {isBusy
                                                            ? 'Starting…'
                                                            : 'Start form →'}
                                                    </div>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {startFormError && (
                            <p className="text-xs" style={{ color: '#F97373' }}>
                                {startFormError}
                            </p>
                        )}
                    </div>
                </div>
            )}


            {/* Orbit-friendly tweaks */}
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

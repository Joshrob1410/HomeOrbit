// app/(app)/pending-approval/page.tsx
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { supabase } from '@/supabase/client';
import { getEffectiveLevel, type AppLevel } from '@/supabase/roles';

/** ========= Types ========= */

type Level = AppLevel;

type HeadKey = 'YOUNG_PEOPLE' | 'CARS' | 'HOME';
type FormEntryStatus = 'DRAFT' | 'SUBMITTED' | 'LOCKED' | 'CANCELLED';

type PendingRow = {
    id: string;
    head: HeadKey;
    status: FormEntryStatus;
    created_at: string;
    submitted_at: string | null;
    company_id: string;
    home_id: string | null;
    subject_young_person_id: string | null;
    young_people: {
        id: string;
        full_name: string;
    } | null;
    form_blueprints: {
        id: string;
        name: string;
    } | null;
    homes: {
        id: string;
        name: string;
    } | null;
};

type PendingItem = {
    entryId: string;
    head: HeadKey;
    createdAt: string;
    submittedAt: string | null;
    youngPersonId: string | null;
    youngPersonName: string | null;
    formName: string | null;
    homeName: string | null;
};

type ViewState =
    | { status: 'loading' }
    | { status: 'signed_out' }
    | { status: 'no_access'; level: Level }
    | {
        status: 'ready';
        level: Level;
        items: PendingItem[];
        error: string | null;
    };

/** ========= Utils ========= */

function formatDateTime(dateStr: string | null): string | null {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return null;

    return (
        d.toLocaleDateString() +
        ' ' +
        d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    );
}

/** ========= Page ========= */

export default function PendingApprovalPage() {
    const [view, setView] = useState<ViewState>({ status: 'loading' });

    useEffect(() => {
        let cancelled = false;

        (async () => {
            const { data: s } = await supabase.auth.getSession();
            const session = s?.session;

            if (!session) {
                if (!cancelled) setView({ status: 'signed_out' });
                return;
            }

            const level = await getEffectiveLevel();

            // Only manager+, company, admin should see this
            if (level === '4_STAFF') {
                if (!cancelled) {
                    setView({
                        status: 'no_access',
                        level,
                    });
                }
                return;
            }

            const { data, error } = await supabase
                .from('form_entries')
                .select(
                    `
                    id,
                    head,
                    status,
                    created_at,
                    submitted_at,
                    company_id,
                    home_id,
                    subject_young_person_id,
                    young_people:subject_young_person_id (
                        id,
                        full_name
                    ),
                    form_blueprints:blueprint_id (
                        id,
                        name
                    ),
                    homes:home_id (
                        id,
                        name
                    )
                `
                )
                .eq('status', 'SUBMITTED')
                .eq('head', 'YOUNG_PEOPLE')
                .order('submitted_at', {
                    ascending: false,
                    nullsFirst: false,
                })
                .returns<PendingRow[]>();

            if (cancelled) return;

            if (error) {
                console.error('❌ load pending approvals failed', error);
                setView({
                    status: 'ready',
                    level,
                    items: [],
                    error: 'Could not load forms pending approval.',
                });
                return;
            }

            const rows: PendingRow[] = data ?? [];

            const items: PendingItem[] = rows.map((row) => ({
                entryId: row.id,
                head: row.head,
                createdAt: row.created_at,
                submittedAt: row.submitted_at,
                youngPersonId: row.subject_young_person_id,
                youngPersonName: row.young_people?.full_name ?? null,
                formName: row.form_blueprints?.name ?? null,
                homeName: row.homes?.name ?? null,
            }));

            setView({
                status: 'ready',
                level,
                items,
                error: null,
            });
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    /** ========= Guards ========= */

    if (view.status === 'loading') {
        return (
            <div className="p-4 md:p-6" style={{ color: 'var(--sub)' }}>
                Loading pending approvals…
            </div>
        );
    }

    if (view.status === 'signed_out') {
        return null;
    }

    if (view.status === 'no_access') {
        return (
            <div className="p-4 md:p-6">
                <div
                    className="rounded-xl ring-1 p-4 md:p-5"
                    style={{
                        background: 'var(--card-grad)',
                        borderColor: 'var(--ring)',
                    }}
                >
                    <h1
                        className="text-lg md:text-xl font-semibold mb-1"
                        style={{ color: 'var(--ink)' }}
                    >
                        Pending approvals
                    </h1>
                    <p className="text-sm" style={{ color: 'var(--sub)' }}>
                        Only managers and company-level users can review and
                        approve submitted forms. If you think you should have
                        access, speak to your manager.
                    </p>
                </div>
            </div>
        );
    }

    const { items, error } = view;

    /** ========= UI ========= */

    return (
        <div className="p-4 md:p-6 space-y-6">
            {/* Header */}
            <div className="space-y-1">
                <h1
                    className="text-lg md:text-2xl font-semibold tracking-tight"
                    style={{ color: 'var(--ink)' }}
                >
                    Forms pending approval
                </h1>
                <p className="text-sm" style={{ color: 'var(--sub)' }}>
                    These forms have been submitted and are waiting for a
                    manager or company-level user to review them. Open a form to
                    check the details and complete approval actions.
                </p>
                {error && (
                    <p className="text-xs mt-1" style={{ color: '#F97373' }}>
                        {error}
                    </p>
                )}
            </div>

            {/* Empty state */}
            {items.length === 0 ? (
                <div
                    className="rounded-xl ring-1 p-4 md:p-5"
                    style={{
                        background: 'var(--card-grad)',
                        borderColor: 'var(--ring)',
                    }}
                >
                    <p className="text-sm" style={{ color: 'var(--sub)' }}>
                        There are no forms waiting for approval right now.
                        Newly submitted forms will appear here for review.
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {items.map((item) => {
                        const submittedLabel = formatDateTime(
                            item.submittedAt
                        );
                        const createdLabel = formatDateTime(item.createdAt);

                        const canOpen =
                            item.head === 'YOUNG_PEOPLE' &&
                            item.youngPersonId;

                        const href = canOpen
                            ? `/young-people/${item.youngPersonId}/forms/${item.entryId}?from=pending-approval`
                            : undefined;

                        return (
                            <div
                                key={item.entryId}
                                className="rounded-xl ring-1 p-4 md:p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4"
                                style={{
                                    background: 'var(--card-grad)',
                                    borderColor: 'var(--ring)',
                                }}
                            >
                                <div className="space-y-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h2
                                            className="text-sm md:text-base font-semibold"
                                            style={{ color: 'var(--ink)' }}
                                        >
                                            {item.formName || 'Untitled form'}
                                        </h2>
                                        <span
                                            className="inline-flex items-center rounded-full px-2 py-[2px] text-[11px]"
                                            style={{
                                                background:
                                                    'rgba(59,130,246,0.18)',
                                                color: 'var(--ink)',
                                            }}
                                        >
                                            Awaiting approval
                                        </span>
                                    </div>
                                    <p
                                        className="text-xs md:text-sm"
                                        style={{ color: 'var(--sub)' }}
                                    >
                                        For{' '}
                                        <span className="font-medium">
                                            {item.youngPersonName ||
                                                'Unknown young person'}
                                        </span>
                                        {item.homeName && (
                                            <>
                                                {' '}
                                                ·{' '}
                                                <span>{item.homeName}</span>
                                            </>
                                        )}
                                    </p>
                                    <div className="flex flex-wrap gap-2 text-[11px] mt-1">
                                        {submittedLabel && (
                                            <span
                                                className="inline-flex items-center rounded-full px-2 py-[2px]"
                                                style={{
                                                    background:
                                                        'rgba(15,23,42,0.5)',
                                                    color: 'var(--sub)',
                                                }}
                                            >
                                                Submitted {submittedLabel}
                                            </span>
                                        )}
                                        {createdLabel && (
                                            <span
                                                className="inline-flex items-center rounded-full px-2 py-[2px]"
                                                style={{
                                                    background: 'transparent',
                                                    color: 'var(--sub)',
                                                }}
                                            >
                                                Started {createdLabel}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-center justify-end gap-2">
                                    {href ? (
                                        <Link
                                            href={href}
                                            className="inline-flex items-center rounded-md px-3 py-1.5 text-xs md:text-sm font-medium ring-1 hover:-translate-y-[0.5px] transition-transform"
                                            style={{
                                                background:
                                                    'var(--nav-item-bg)',
                                                borderColor: 'var(--ring)',
                                                color: 'var(--ink)',
                                            }}
                                        >
                                            Open form →
                                        </Link>
                                    ) : (
                                        <span
                                            className="text-xs"
                                            style={{ color: 'var(--sub)' }}
                                        >
                                            This form can&apos;t be opened
                                            (missing subject).
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Orbit tweaks */}
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

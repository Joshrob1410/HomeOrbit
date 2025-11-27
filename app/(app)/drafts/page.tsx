// app/(app)/drafts/page.tsx
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { supabase } from '@/supabase/client';
import { getEffectiveLevel, type AppLevel } from '@/supabase/roles';

/** ========= Types ========= */

type Level = AppLevel;

type HeadKey = 'YOUNG_PEOPLE' | 'CARS' | 'HOME';
type FormEntryStatus = 'DRAFT' | 'SUBMITTED' | 'LOCKED' | 'CANCELLED';

type DraftRow = {
    id: string;
    head: HeadKey;
    status: FormEntryStatus;
    created_at: string;
    submitted_at: string | null;
    subject_young_person_id: string | null;
    young_people: {
        id: string;
        full_name: string;
    } | null;
    form_blueprints: {
        id: string;
        name: string;
    } | null;
};

type DraftItem = {
    entryId: string;
    head: HeadKey;
    createdAt: string;
    submittedAt: string | null;
    youngPersonId: string | null;
    youngPersonName: string | null;
    formName: string | null;
};

type ViewState =
    | { status: 'loading' }
    | { status: 'signed_out' }
    | {
        status: 'ready';
        level: Level;
        drafts: DraftItem[];
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

export default function DraftsPage() {
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
            const userId = session.user.id;

            const { data, error } = await supabase
                .from('form_entries')
                .select(
                    `
                    id,
                    head,
                    status,
                    created_at,
                    submitted_at,
                    subject_young_person_id,
                    young_people:subject_young_person_id (
                        id,
                        full_name
                    ),
                    form_blueprints:blueprint_id (
                        id,
                        name
                    )
                `
                )
                .eq('status', 'DRAFT')
                .eq('created_by', userId)
                .eq('head', 'YOUNG_PEOPLE')
                .order('created_at', { ascending: false })
                .returns<DraftRow[]>();

            if (cancelled) return;

            if (error) {
                console.error('❌ load draft forms failed', error);
                setView({
                    status: 'ready',
                    level,
                    drafts: [],
                    error: 'Could not load your drafts.',
                });
                return;
            }

            const rows: DraftRow[] = data ?? [];

            const drafts: DraftItem[] = rows.map((row) => ({
                entryId: row.id,
                head: row.head,
                createdAt: row.created_at,
                submittedAt: row.submitted_at,
                youngPersonId: row.subject_young_person_id,
                youngPersonName: row.young_people?.full_name ?? null,
                formName: row.form_blueprints?.name ?? null,
            }));

            setView({
                status: 'ready',
                level,
                drafts,
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
                Loading drafts…
            </div>
        );
    }

    if (view.status === 'signed_out') {
        return null;
    }

    const { drafts, error } = view;

    /** ========= UI ========= */

    return (
        <div className="p-4 md:p-6 space-y-6">
            {/* Header */}
            <div className="space-y-1">
                <h1
                    className="text-lg md:text-2xl font-semibold tracking-tight"
                    style={{ color: 'var(--ink)' }}
                >
                    Draft forms
                </h1>
                <p className="text-sm" style={{ color: 'var(--sub)' }}>
                    Forms you&apos;ve started but not yet submitted. Your
                    answers auto-save while you type, and exiting a form keeps
                    it here as a draft.
                </p>
                {error && (
                    <p className="text-xs mt-1" style={{ color: '#F97373' }}>
                        {error}
                    </p>
                )}
            </div>

            {/* Empty state */}
            {drafts.length === 0 ? (
                <div
                    className="rounded-xl ring-1 p-4 md:p-5"
                    style={{
                        background: 'var(--card-grad)',
                        borderColor: 'var(--ring)',
                    }}
                >
                    <p className="text-sm" style={{ color: 'var(--sub)' }}>
                        You don&apos;t have any draft forms right now. Start a
                        new form from a young person&apos;s profile and it will
                        appear here until you submit it.
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {drafts.map((draft) => {
                        const startedLabel = formatDateTime(draft.createdAt);
                        const submittedLabel = formatDateTime(
                            draft.submittedAt
                        );

                        const canOpen =
                            draft.head === 'YOUNG_PEOPLE' &&
                            draft.youngPersonId;

                        const href = canOpen
                            ? `/young-people/${draft.youngPersonId}/forms/${draft.entryId}?from=drafts`
                            : undefined;

                        return (
                            <div
                                key={draft.entryId}
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
                                            {draft.formName || 'Untitled form'}
                                        </h2>
                                        <span
                                            className="inline-flex items-center rounded-full px-2 py-[2px] text-[11px]"
                                            style={{
                                                background:
                                                    'rgba(148,163,184,0.16)',
                                                color: 'var(--sub)',
                                            }}
                                        >
                                            Draft
                                        </span>
                                    </div>
                                    <p
                                        className="text-xs md:text-sm"
                                        style={{ color: 'var(--sub)' }}
                                    >
                                        For{' '}
                                        <span className="font-medium">
                                            {draft.youngPersonName ||
                                                'Unknown young person'}
                                        </span>
                                    </p>
                                    <div className="flex flex-wrap gap-2 text-[11px] mt-1">
                                        <span
                                            className="inline-flex items-center rounded-full px-2 py-[2px]"
                                            style={{
                                                background:
                                                    'rgba(15,23,42,0.5)',
                                                color: 'var(--sub)',
                                            }}
                                        >
                                            Started {startedLabel || 'Unknown'}
                                        </span>
                                        {submittedLabel && (
                                            <span
                                                className="inline-flex items-center rounded-full px-2 py-[2px]"
                                                style={{
                                                    background: 'transparent',
                                                    color: 'var(--sub)',
                                                }}
                                            >
                                                Last touched {submittedLabel}
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
                                            Continue form →
                                        </Link>
                                    ) : (
                                        <span
                                            className="text-xs"
                                            style={{ color: 'var(--sub)' }}
                                        >
                                            This draft can&apos;t be opened
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

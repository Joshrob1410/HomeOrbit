// app/(app)/due/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/supabase/client';
import { getEffectiveLevel, type AppLevel } from '@/supabase/roles';

const BRAND_GRADIENT =
    'linear-gradient(135deg, #7C3AED 0%, #6366F1 50%, #3B82F6 100%)';

type Level = AppLevel;

type ViewState =
    | { status: 'loading' }
    | { status: 'signed_out' }
    | { status: 'ready'; level: Level };

export default function DuePage() {
    const [view, setView] = useState<ViewState>({ status: 'loading' });

    useEffect(() => {
        let mounted = true;

        (async () => {
            const { data: s } = await supabase.auth.getSession();
            const session = s?.session;

            if (!session) {
                if (mounted) setView({ status: 'signed_out' });
                return;
            }

            const level = await getEffectiveLevel();
            if (mounted) {
                setView({ status: 'ready', level });
            }
        })();

        return () => {
            mounted = false;
        };
    }, []);

    if (view.status === 'loading') {
        return (
            <div className="p-4 md:p-6" style={{ color: 'var(--sub)' }}>
                Loading tasks due today…
            </div>
        );
    }

    if (view.status === 'signed_out') {
        // Layout guard will usually redirect; we just render nothing.
        return null;
    }

    // Ready: placeholder UI until "due tasks" logic is wired up
    return (
        <div className="p-4 md:p-6 space-y-6">
            <div className="space-y-1">
                <h1
                    className="text-xl md:text-2xl font-semibold tracking-tight"
                    style={{ color: 'var(--ink)' }}
                >
                    Tasks due today
                </h1>
                <p className="text-sm" style={{ color: 'var(--sub)' }}>
                    This view will collect any forms, reviews or other work that
                    is due today, so you can see everything in one place.
                </p>
            </div>

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
                        Today&apos;s tasks
                    </div>
                    <span
                        className="inline-flex items-center rounded-full px-2 py-[2px] text-[11px]"
                        style={{
                            background: BRAND_GRADIENT,
                            color: '#FFFFFF',
                        }}
                    >
                        Placeholder
                    </span>
                </div>

                <div className="p-4 md:p-6 text-sm">
                    <div className="flex flex-col items-start gap-2 md:flex-row md:items-center md:gap-3">
                        <div
                            className="inline-flex h-9 w-9 items-center justify-center rounded-full"
                            style={{
                                background:
                                    'radial-gradient(circle at 30% 30%, rgba(96,165,250,0.9), rgba(37,99,235,0.3))',
                                color: '#FFFFFF',
                            }}
                        >
                            <svg
                                width="18"
                                height="18"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                fill="none"
                                strokeWidth={1.6}
                                aria-hidden
                            >
                                <rect
                                    x="4"
                                    y="5"
                                    width="16"
                                    height="15"
                                    rx="2"
                                />
                                <path d="M8 3v4M16 3v4M4 9h16" />
                                <path d="M11 13l2 2 3-3" />
                            </svg>
                        </div>
                        <div>
                            <div
                                className="font-medium"
                                style={{ color: 'var(--ink)' }}
                            >
                                You&apos;re all caught up
                            </div>
                            <p
                                className="text-xs mt-0.5"
                                style={{ color: 'var(--sub)' }}
                            >
                                Once due tasks are wired in, anything that needs
                                completing today will appear here automatically.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

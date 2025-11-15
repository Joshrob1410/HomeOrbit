// app/auth/reset/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/supabase/client';

type Phase = 'verifying' | 'ready' | 'error';

const SPACE = {
    bgDeep: '#060913',
    glowViolet: '#7C3AED',
    glowBlue: '#3B82F6',
} as const;

function hexToRgba(hex: string, alpha = 1): string {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const bigint = parseInt(full, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function strengthScore(pw: string): number {
    let s = 0;
    if (pw.length >= 8) s++;
    if (pw.length >= 12) s++;
    if (/[A-Z]/.test(pw)) s++;
    if (/[a-z]/.test(pw)) s++;
    if (/\d/.test(pw)) s++;
    if (/[^A-Za-z0-9]/.test(pw)) s++;
    return Math.min(4, Math.max(0, Math.floor(s / 1.5)));
}

function BigLogo() {
    return (
        <div
            className="relative mx-auto h-20 w-20 sm:h-24 sm:w-24 drop-shadow-[0_0_20px_rgba(124,58,237,0.5)]"
            aria-label="HomeOrbit"
        >
            {/* assumes /public/logo.png exists like your login page */}
            {/* If you don't have it, swap for simple text logo */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src="/logo.png"
                alt="HomeOrbit"
                className="h-full w-full object-contain"
            />
        </div>
    );
}

export default function ResetPasswordPage() {
    const router = useRouter();
    const search = useSearchParams();

    const [phase, setPhase] = useState<Phase>('verifying');
    const [errorMsg, setErrorMsg] = useState<string>('');
    const [email, setEmail] = useState<string>('');

    const [pw1, setPw1] = useState('');
    const [pw2, setPw2] = useState('');
    const [saving, setSaving] = useState(false);

    const strength = useMemo(() => strengthScore(pw1), [pw1]);
    const canSavePw = pw1.length >= 12 && pw1 === pw2 && strength >= 2;

    useEffect(() => {
        let cancelled = false;

        async function establishSessionFromUrl(): Promise<void> {
            setPhase('verifying');

            // 1) Handle implicit flow: #access_token & #refresh_token (magic link)
            if (typeof window !== 'undefined' && window.location.hash) {
                const hashParams = new URLSearchParams(window.location.hash.slice(1));
                const access_token = hashParams.get('access_token');
                const refresh_token = hashParams.get('refresh_token');

                if (access_token && refresh_token) {
                    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
                    if (error) {
                        if (!cancelled) {
                            setErrorMsg(error.message || 'Could not set session from reset link.');
                            setPhase('error');
                        }
                        return;
                    }
                    const clean = window.location.origin + window.location.pathname + window.location.search;
                    window.history.replaceState({}, '', clean);
                }
            }

            // 2) Handle PKCE-style ?code=... (just in case)
            const code = search?.get('code');
            if (code) {
                const { error } = await supabase.auth.exchangeCodeForSession(code);
                if (error) {
                    if (!cancelled) {
                        setErrorMsg(error.message || 'Code exchange failed.');
                        setPhase('error');
                    }
                    return;
                }
            }

            // 3) Handle OTP recovery links: token_hash / token + email
            const token_hash = search?.get('token_hash');
            const legacy_token = search?.get('token');
            const typeParam = (search?.get('type') || 'recovery').toLowerCase(); // recovery | email | signup | invite
            const emailParam = search?.get('email') || undefined;

            if (token_hash) {
                const { error } = await supabase.auth.verifyOtp({
                    token_hash,
                    type: typeParam as 'recovery' | 'invite' | 'signup' | 'email',
                });
                if (error) {
                    if (!cancelled) {
                        setErrorMsg(error.message || 'Unable to verify reset link.');
                        setPhase('error');
                    }
                    return;
                }
            } else if (legacy_token && emailParam) {
                const { error } = await supabase.auth.verifyOtp({
                    token: legacy_token,
                    email: emailParam,
                    type: typeParam as 'recovery' | 'invite' | 'signup' | 'email',
                });
                if (error) {
                    if (!cancelled) {
                        setErrorMsg(error.message || 'Unable to verify reset link.');
                        setPhase('error');
                    }
                    return;
                }
            }

            // 4) Ensure we have a session (wait briefly if needed)
            const haveImmediate = (await supabase.auth.getSession()).data.session;
            if (!haveImmediate) {
                const ok = await new Promise<boolean>((resolve) => {
                    const timeout = setTimeout(() => {
                        sub?.data.subscription.unsubscribe();
                        resolve(false);
                    }, 8000);
                    const sub = supabase.auth.onAuthStateChange((_event, sess) => {
                        if (sess) {
                            clearTimeout(timeout);
                            sub.data.subscription.unsubscribe();
                            resolve(true);
                        }
                    });
                });
                if (!ok) {
                    if (!cancelled) {
                        setErrorMsg('We could not create your session. Your reset link may have expired.');
                        setPhase('error');
                    }
                    return;
                }
            }

            // 5) Load user to show email
            const {
                data: { user },
                error: userErr,
            } = await supabase.auth.getUser();
            if (userErr || !user) {
                if (!cancelled) {
                    setErrorMsg(userErr?.message || 'No authenticated user.');
                    setPhase('error');
                }
                return;
            }

            if (!cancelled) {
                setEmail(user.email ?? '');
                setPhase('ready');
            }
        }

        establishSessionFromUrl();

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [search]);

    async function savePassword() {
        if (!canSavePw || saving) return;
        setSaving(true);
        try {
            const {
                data: { session },
            } = await supabase.auth.getSession();
            if (!session) {
                setErrorMsg('Your reset session has expired. Please click the reset link again.');
                setPhase('error');
                return;
            }

            const { error } = await supabase.auth.updateUser({ password: pw1 });
            if (error) throw error;

            router.replace('/dashboard');
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'Failed to update your password.';
            setErrorMsg(msg);
            setPhase('error');
        } finally {
            setSaving(false);
        }
    }

    const bgStyle = {
        backgroundImage: [
            `radial-gradient(90rem 60rem at -10% -20%, ${hexToRgba(SPACE.glowViolet, 0.5)} 0%, rgba(0,0,0,0) 55%)`,
            `radial-gradient(70rem 40rem at 120% -10%, ${hexToRgba(SPACE.glowBlue, 0.35)} 0%, rgba(0,0,0,0) 60%)`,
            `linear-gradient(180deg, ${SPACE.bgDeep} 0%, #020309 100%)`,
        ].join(', '),
    } as const;

    const strengthLabel = ['Very weak', 'Weak', 'Okay', 'Good', 'Strong'][strength];

    if (phase === 'verifying') {
        return (
            <div className="min-h-svh flex items-center justify-center px-4" style={bgStyle}>
                <div className="max-w-md w-full text-center text-white/80">
                    <BigLogo />
                    <p className="mt-6 text-sm">Checking your reset link…</p>
                </div>
            </div>
        );
    }

    if (phase === 'error') {
        return (
            <div className="min-h-svh flex items-center justify-center px-4" style={bgStyle}>
                <div className="w-full max-w-md rounded-2xl bg-white/5 backdrop-blur-xl p-6 text-white ring-1 ring-white/10">
                    <BigLogo />
                    <h1 className="mt-4 text-xl font-semibold tracking-tight">
                        We couldn’t finish resetting your password
                    </h1>
                    <p className="mt-3 text-sm text-white/75">
                        {errorMsg || 'Something went wrong. Your reset link may have expired or already been used.'}
                    </p>
                    <div className="mt-5 flex gap-3">
                        <a
                            href="/auth/login"
                            className="inline-flex items-center justify-center rounded-xl border border-white/20 bg-white/5 px-4 py-2.5 text-sm font-medium text-white hover:bg-white/10"
                        >
                            Go to login
                        </a>
                    </div>
                </div>
            </div>
        );
    }

    // phase === 'ready'
    return (
        <div className="min-h-svh flex items-center justify-center px-4" style={bgStyle}>
            <div className="w-full max-w-md">
                <div className="mb-6 text-center text-white">
                    <BigLogo />
                    <h1 className="mt-4 text-2xl font-semibold tracking-tight">Set a new password</h1>
                    <p className="mt-1 text-xs text-white/70">
                        For <span className="font-medium">{email || 'your HomeOrbit account'}</span>
                    </p>
                </div>

                <div className="relative rounded-2xl bg-white/5 backdrop-blur-md p-6 shadow-2xl ring-1 ring-white/10 text-white">
                    <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-white/10" />

                    <div className="space-y-3">
                        <div>
                            <label className="block text-sm mb-1">New password</label>
                            <input
                                type="password"
                                className="w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-sm text-white placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-[rgba(124,58,237,0.7)]"
                                value={pw1}
                                onChange={(e) => setPw1(e.target.value)}
                                placeholder="At least 12 characters"
                                autoComplete="new-password"
                            />
                        </div>

                        <div>
                            <label className="block text-sm mb-1">Repeat password</label>
                            <input
                                type="password"
                                className="w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-sm text-white placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-[rgba(124,58,237,0.7)]"
                                value={pw2}
                                onChange={(e) => setPw2(e.target.value)}
                                placeholder="Repeat your new password"
                                autoComplete="new-password"
                            />
                        </div>

                        <div className="mt-1 text-[11px] text-white/70">
                            Strength: <span className="font-medium">{strengthLabel}</span>
                        </div>

                        <button
                            type="button"
                            onClick={savePassword}
                            disabled={!canSavePw || saving}
                            className="mt-3 w-full rounded-xl bg-gradient-to-r from-[#7C3AED] via-[#6366F1] to-[#3B82F6] py-2.5 text-[15px] font-semibold text-white shadow-[0_10px_25px_rgba(79,70,229,0.35)] hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-[rgba(99,102,241,0.6)] disabled:opacity-60"
                        >
                            {saving ? 'Updating…' : 'Update password'}
                        </button>

                        <p className="mt-3 text-[11px] text-white/60">
                            For security, this reset link only works once. If it expires, ask your admin to send you a new one.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

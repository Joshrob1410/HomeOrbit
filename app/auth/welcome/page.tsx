'use client';

import { useEffect, useMemo, useState } from 'react';
import NextImage from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/supabase/client';

type Company = { id: string; name: string };
type HomeMembershipRow = {
    home_id: string;
    role: 'MANAGER' | 'STAFF' | null;
    manager_subrole: 'MANAGER' | 'DEPUTY_MANAGER' | null;
    staff_subrole: 'RESIDENTIAL' | 'TEAM_LEADER' | null;
};

// Re-use the same palette vibe as the login page
const SPACE = {
    bgDeep: '#060913',
    glowViolet: '#7C3AED',
    glowBlue: '#3B82F6',
} as const;

function strengthScore(pw: string): number {
    let s = 0;
    if (pw.length >= 8) s++;
    if (pw.length >= 12) s++;
    if (/[A-Z]/.test(pw)) s++;
    if (/[a-z]/.test(pw)) s++;
    if (/\d/.test(pw)) s++;
    if (/[^A-Za-z0-9]/.test(pw)) s++;
    // clamp to 0..4 for display
    return Math.min(4, Math.max(0, Math.floor(s / 1.5)));
}

function BigLogo() {
    return (
        <div
            className="relative h-20 w-20 sm:h-24 sm:w-24 mx-auto drop-shadow-[0_0_25px_rgba(124,58,237,0.55)]"
            aria-label="HomeOrbit"
        >
            <NextImage
                src="/logo.png"
                alt="HomeOrbit"
                fill
                sizes="96px"
                className="object-contain"
                priority
            />
        </div>
    );
}

export default function WelcomePage() {
    const router = useRouter();
    const search = useSearchParams();

    const [phase, setPhase] = useState<'verifying' | 'ready' | 'error'>('verifying');
    const [errorMsg, setErrorMsg] = useState<string>('');

    const [email, setEmail] = useState('');
    const [fullName, setFullName] = useState('');
    const [companyName, setCompanyName] = useState<string>('—');
    const [roleLabel, setRoleLabel] = useState<string>('—');

    const [pw1, setPw1] = useState('');
    const [pw2, setPw2] = useState('');
    const [savingPw, setSavingPw] = useState(false);

    const strength = useMemo(() => strengthScore(pw1), [pw1]);
    const canSavePw = pw1.length >= 12 && pw1 === pw2 && strength >= 2;

    useEffect(() => {
        let cancelled = false;

        async function establishSessionFromUrl(): Promise<void> {
            // Always start in verifying
            setPhase('verifying');

            // 1) Handle implicit flow: #access_token & #refresh_token
            if (typeof window !== 'undefined' && window.location.hash) {
                const hashParams = new URLSearchParams(window.location.hash.slice(1));
                const access_token = hashParams.get('access_token');
                const refresh_token = hashParams.get('refresh_token');

                if (access_token && refresh_token) {
                    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
                    if (error) {
                        if (!cancelled) {
                            setErrorMsg(error.message || 'Could not set session from callback.');
                            setPhase('error');
                        }
                        return;
                    }
                    // Clean the hash so refreshes don’t break
                    const clean = window.location.origin + window.location.pathname + window.location.search;
                    window.history.replaceState({}, '', clean);
                }
            }

            // 2) Handle PKCE: ?code=...
            const code = search?.get('code');
            if (code) {
                const { error } = await supabase.auth.exchangeCodeForSession(code); // safe no-op if not PKCE
                if (error) {
                    if (!cancelled) {
                        setErrorMsg(error.message || 'Code exchange failed.');
                        setPhase('error');
                    }
                    return;
                }
            }

            // 3) Handle OTP invite/confirm flows:
            //    Modern templates: ?token_hash=...&type=invite|signup|email
            //    Older templates:  ?token=...&email=...&type=invite|signup
            const token_hash = search?.get('token_hash');
            const legacy_token = search?.get('token');
            const typeParam = (search?.get('type') || 'invite').toLowerCase(); // invite|signup|email|recovery
            const emailParam = search?.get('email') || undefined;

            if (token_hash) {
                const { error } = await supabase.auth.verifyOtp({
                    token_hash,
                    type: (typeParam as 'invite' | 'signup' | 'email' | 'recovery'),
                });
                if (error) {
                    if (!cancelled) {
                        setErrorMsg(error.message || 'Unable to verify invitation.');
                        setPhase('error');
                    }
                    return;
                }
            } else if (legacy_token && emailParam) {
                const { error } = await supabase.auth.verifyOtp({
                    token: legacy_token,
                    email: emailParam,
                    type: (typeParam as 'invite' | 'signup' | 'email' | 'recovery'),
                });
                if (error) {
                    if (!cancelled) {
                        setErrorMsg(error.message || 'Unable to verify invitation.');
                        setPhase('error');
                    }
                    return;
                }
            }

            // 4) Ensure we actually *have* a session (wait up to ~8s)
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
                        setErrorMsg('We could not create your session. Please log in and try again.');
                        setPhase('error');
                    }
                    return;
                }
            }

            // 5) With a session established, load identity + what’s been set up
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

            const uid = user.id;
            if (!cancelled) {
                setEmail(user.email ?? '');
            }

            // profile
            const { data: prof } = await supabase
                .from('profiles')
                .select('full_name')
                .eq('user_id', uid)
                .maybeSingle();
            if (!cancelled) {
                setFullName(prof?.full_name ?? '');
            }

            // company
            const { data: cm } = await supabase
                .from('company_memberships')
                .select('company_id, has_company_access')
                .eq('user_id', uid)
                .maybeSingle();

            let compName = '—';
            if (cm?.company_id) {
                const { data: co } = await supabase
                    .from('companies')
                    .select('name')
                    .eq('id', cm.company_id as string)
                    .maybeSingle();
                if (co?.name) compName = co.name;
            }
            if (!cancelled) {
                setCompanyName(compName);
            }

            // role / position label
            let label = 'Member';

            // If they have company access, start from "Company"
            if (cm?.has_company_access) {
                label = 'Company';
            }

            // Are they bank staff?
            const { data: bankRows } = await supabase
                .from('bank_memberships')
                .select('company_id')
                .eq('user_id', uid)
                .limit(1);

            if (bankRows && bankRows.length > 0) {
                label = 'Staff — Bank';
            }

            // Any home memberships?
            const { data: hm } = await supabase
                .from('home_memberships')
                .select('home_id, role, manager_subrole, staff_subrole')
                .eq('user_id', uid);

            const rows: HomeMembershipRow[] = (hm ?? []) as HomeMembershipRow[];
            const deputy = rows.find((r) => r.role === 'MANAGER' && r.manager_subrole === 'DEPUTY_MANAGER');
            const headMgr = rows.find((r) => r.role === 'MANAGER' && r.manager_subrole === 'MANAGER');
            const teamLead = rows.find((r) => r.role === 'STAFF' && r.staff_subrole === 'TEAM_LEADER');
            const staffRes = rows.find((r) => r.role === 'STAFF');

            if (headMgr) label = 'Manager — Manager';
            else if (deputy) label = 'Manager — Deputy';
            else if (teamLead) label = 'Staff — Team Leader';
            else if (staffRes) label = 'Staff — Residential';

            if (!cancelled) {
                setRoleLabel(label);
                setPhase('ready');
            }
        }

        // NOTE: invite links don’t use PKCE; they come back with token_hash or access_token hash.
        // We still handle PKCE for completeness.
        establishSessionFromUrl();

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [search]);

    async function savePassword() {
        if (!canSavePw) return;
        setSavingPw(true);
        try {
            // Ensure we still have a live session before updating password
            const {
                data: { session },
            } = await supabase.auth.getSession();
            if (!session) {
                setErrorMsg('Your session expired. Please click the invite link again or log in.');
                setPhase('error');
                return;
            }
            const { error } = await supabase.auth.updateUser({ password: pw1 });
            if (error) throw error;

            // Done — go to dashboard
            router.replace('/dashboard');
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'Failed to set password.';
            setErrorMsg(msg);
            setPhase('error');
        } finally {
            setSavingPw(false);
        }
    }

    // === Shared background style ===
    const bgStyle = {
        backgroundImage: [
            `radial-gradient(90rem 60rem at -10% -20%, rgba(124,58,237,0.6) 0%, rgba(0,0,0,0) 55%)`,
            `radial-gradient(70rem 40rem at 120% -10%, rgba(59,130,246,0.45) 0%, rgba(0,0,0,0) 60%)`,
            `linear-gradient(180deg, ${SPACE.bgDeep} 0%, #020617 100%)`,
        ].join(', '),
    } as const;

    // === PHASE: verifying ===
    if (phase === 'verifying') {
        return (
            <div className="relative min-h-screen text-white">
                <div className="fixed inset-0 -z-10" style={bgStyle} aria-hidden />
                <div className="relative flex items-center justify-center min-h-screen px-4">
                    <div className="max-w-md w-full text-center space-y-6">
                        <BigLogo />
                        <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.2em]">
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            Setting up your access
                        </div>
                        <h1 className="text-xl font-semibold">Preparing your HomeOrbit account…</h1>
                        <p className="text-sm text-white/70">
                            We’re verifying your invite link and creating a secure session. This usually takes just a moment.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    // === PHASE: error ===
    if (phase === 'error') {
        return (
            <div className="relative min-h-screen text-white">
                <div className="fixed inset-0 -z-10" style={bgStyle} aria-hidden />
                <div className="relative flex items-center justify-center min-h-screen px-4">
                    <div className="max-w-md w-full rounded-2xl bg-white/5 backdrop-blur-md p-6 shadow-2xl ring-1 ring-white/10">
                        <div className="mb-4 flex items-center gap-2 text-red-300 text-sm font-medium">
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-500/20 border border-red-400/40">
                                !
                            </span>
                            We couldn’t finish signing you in
                        </div>
                        <p className="text-sm text-white/80 mb-4">
                            {errorMsg || 'Something went wrong while verifying your invite. Please try again from your email, or log in directly.'}
                        </p>
                        <div className="flex gap-3">
                            <a
                                href="/auth/login"
                                className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-[#7C3AED] via-[#6366F1] to-[#3B82F6] px-3 py-2 text-sm font-medium text-white shadow-lg shadow-indigo-500/30"
                            >
                                Go to login
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // === PHASE: ready ===
    return (
        <div className="relative min-h-screen text-white">
            {/* Background */}
            <div className="fixed inset-0 -z-10" style={bgStyle} aria-hidden />
            {/* subtle stars */}
            <div
                className="pointer-events-none fixed inset-0 -z-10 opacity-50"
                style={{
                    backgroundImage:
                        'radial-gradient(1px 1px at 10% 20%, rgba(255,255,255,0.35) 0, rgba(255,255,255,0) 60%), radial-gradient(1px 1px at 60% 80%, rgba(255,255,255,0.2) 0, rgba(255,255,255,0) 60%), radial-gradient(1px 1px at 80% 30%, rgba(255,255,255,0.25) 0, rgba(255,255,255,0) 60%)',
                }}
                aria-hidden
            />

            <div className="relative flex items-center justify-center min-h-screen px-4 py-10">
                <div className="w-full max-w-2xl">
                    {/* Header / logo */}
                    <div className="mb-6 text-center">
                        <BigLogo />
                        <h1 className="mt-4 text-2xl sm:text-3xl font-semibold tracking-tight">Welcome to HomeOrbit</h1>
                        <p className="mt-1 text-sm text-white/75">
                            Here’s what’s been set up for you. Create a secure password to finish.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-[1.1fr,1.1fr] gap-5">
                        {/* Access summary */}
                        <section className="relative rounded-2xl bg-white/5 backdrop-blur-md p-5 shadow-2xl ring-1 ring-white/10">
                            <div className="absolute inset-0 rounded-2xl ring-1 ring-white/10 pointer-events-none" />
                            <div className="flex items-center justify-between mb-3">
                                <div className="text-xs font-semibold tracking-[0.2em] uppercase text-white/60">
                                    Step 1 · Your access
                                </div>
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-300 border border-emerald-500/40">
                                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                    Verified
                                </span>
                            </div>

                            <dl className="mt-2 space-y-3 text-sm">
                                <div>
                                    <dt className="text-xs uppercase tracking-[0.18em] text-white/50 mb-1">Email</dt>
                                    <dd className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2">
                                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-white/10 text-[11px]">
                                            @
                                        </span>
                                        <span className="break-all">{email || '—'}</span>
                                    </dd>
                                </div>

                                <div>
                                    <dt className="text-xs uppercase tracking-[0.18em] text-white/50 mb-1">Name</dt>
                                    <dd className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2">
                                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-white/10 text-[11px]">
                                            👤
                                        </span>
                                        <span>{fullName || '—'}</span>
                                    </dd>
                                </div>

                                <div>
                                    <dt className="text-xs uppercase tracking-[0.18em] text-white/50 mb-1">Company</dt>
                                    <dd className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2">
                                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-white/10 text-[11px]">
                                            🏢
                                        </span>
                                        <span>{companyName}</span>
                                    </dd>
                                </div>

                                <div>
                                    <dt className="text-xs uppercase tracking-[0.18em] text-white/50 mb-1">
                                        Role / Position
                                    </dt>
                                    <dd className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2">
                                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-white/10 text-[11px]">
                                            ⭐
                                        </span>
                                        <span>{roleLabel}</span>
                                    </dd>
                                </div>
                            </dl>
                        </section>

                        {/* Password setup */}
                        <section className="relative rounded-2xl bg-white/5 backdrop-blur-md p-5 shadow-2xl ring-1 ring-white/10">
                            <div className="absolute inset-0 rounded-2xl ring-1 ring-white/10 pointer-events-none" />

                            <div className="text-xs font-semibold tracking-[0.2em] uppercase text-white/60 mb-3">
                                Step 2 · Create password
                            </div>

                            <div className="space-y-3 text-sm">
                                <div>
                                    <label className="block text-xs font-medium text-white/80 mb-1.5">
                                        New password
                                    </label>
                                    <input
                                        type="password"
                                        className="w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-sm text-white placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-[rgba(124,58,237,0.8)]"
                                        value={pw1}
                                        onChange={(e) => setPw1(e.target.value)}
                                        placeholder="At least 12 characters"
                                        autoComplete="new-password"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-medium text-white/80 mb-1.5">
                                        Repeat password
                                    </label>
                                    <input
                                        type="password"
                                        className="w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-sm text-white placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-[rgba(124,58,237,0.8)]"
                                        value={pw2}
                                        onChange={(e) => setPw2(e.target.value)}
                                        placeholder="Repeat password"
                                        autoComplete="new-password"
                                    />
                                </div>

                                <div className="flex items-center justify-between text-[11px] text-white/70">
                                    <span>
                                        Strength:{' '}
                                        <span className="font-medium">
                                            {['Very weak', 'Weak', 'Okay', 'Good', 'Strong'][strength]}
                                        </span>
                                    </span>
                                    <span className="inline-flex gap-1">
                                        {[0, 1, 2, 3].map((i) => (
                                            <span
                                                key={i}
                                                className={`h-1.5 w-6 rounded-full transition ${i <= strength - 1
                                                        ? 'bg-gradient-to-r from-[#7C3AED] to-[#3B82F6]'
                                                        : 'bg-white/15'
                                                    }`}
                                            />
                                        ))}
                                    </span>
                                </div>

                                <button
                                    onClick={savePassword}
                                    disabled={!canSavePw || savingPw}
                                    className="mt-2 inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-[#7C3AED] via-[#6366F1] to-[#3B82F6] px-3 py-2.5 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(79,70,229,0.5)] transition hover:brightness-110 disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                    {savingPw ? 'Saving…' : 'Save password & continue'}
                                </button>

                                <p className="text-[11px] text-white/60 mt-1.5">
                                    You’ll be taken straight to your dashboard once your password is set.
                                </p>
                            </div>
                        </section>
                    </div>

                    <p className="mt-8 text-center text-[11px] text-white/55">
                        © {new Date().getFullYear()} HomeOrbit • Secure access for your workforce
                    </p>
                </div>
            </div>
        </div>
    );
}

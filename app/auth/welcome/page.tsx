'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/supabase/client';

type CompanyRow = { id: string; name: string };
type HomeMembership = {
    home_id: string;
    role: 'MANAGER' | 'STAFF' | null;
    manager_subrole: 'MANAGER' | 'DEPUTY_MANAGER' | null;
    staff_subrole: 'RESIDENTIAL' | 'TEAM_LEADER' | null;
};

function strengthScore(pw: string): number {
    let score = 0;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    return score; // 0..4
}

export default function Welcome() {
    const router = useRouter();
    const search = useSearchParams();

    const [busy, setBusy] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [email, setEmail] = useState('');
    const [fullName, setFullName] = useState('');
    const [company, setCompany] = useState<CompanyRow | null>(null);
    const [roleLabel, setRoleLabel] = useState<string>('—');

    const [pw, setPw] = useState('');
    const [pw2, setPw2] = useState('');
    const [saving, setSaving] = useState(false);

    const score = useMemo(() => strengthScore(pw), [pw]);
    const strongEnough = score >= 3 && pw === pw2;

    useEffect(() => {
        let unsub: { unsubscribe: () => void } | null = null;

        const hasHashTokens = () => {
            if (typeof window === 'undefined') return false;
            const hash = window.location.hash || '';
            return (
                hash.includes('access_token') ||
                hash.includes('refresh_token') ||
                hash.includes('type=')
            );
        };

        (async () => {
            setBusy(true);
            setError(null);

            // If invite/callback provided a PKCE code, exchange it for a session
            const code = search.get('code');
            if (code) {
                const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
                if (exErr) {
                    setError(exErr.message || 'Unable to complete sign-in.');
                    router.replace('/auth/login');
                    return;
                }
            }

            // Read current session
            const { data: { session } } = await supabase.auth.getSession();

            if (!session?.user) {
                // If the URL carries hash tokens, wait for Supabase to hydrate the session
                if (hasHashTokens()) {
                    const { data: { subscription } } = supabase.auth.onAuthStateChange((_evt, sess) => {
                        if (sess?.user) {
                            subscription.unsubscribe();
                            void loadUser(sess.user.id, sess.user.email ?? '');
                        }
                    });
                    unsub = { unsubscribe: subscription.unsubscribe };
                    return;
                }
                // Otherwise, redirect to login
                router.replace('/auth/login');
                return;
            }

            await loadUser(session.user.id, session.user.email ?? '');
        })().finally(() => setBusy(false));

        async function loadUser(uid: string, userEmail: string) {
            try {
                setEmail(userEmail);

                // Profile
                const { data: prof } = await supabase
                    .from('profiles')
                    .select('full_name')
                    .eq('user_id', uid)
                    .maybeSingle();
                setFullName((prof?.full_name ?? '').trim());

                // Determine company id
                let companyId: string | null = null;

                const cm = await supabase
                    .from('company_memberships')
                    .select('company_id')
                    .eq('user_id', uid)
                    .maybeSingle();

                if (cm?.data?.company_id) {
                    companyId = cm.data.company_id;
                } else {
                    const hm = await supabase
                        .from('home_memberships')
                        .select('home_id')
                        .eq('user_id', uid)
                        .limit(1)
                        .maybeSingle();

                    if (hm?.data?.home_id) {
                        const h = await supabase
                            .from('homes')
                            .select('company_id')
                            .eq('id', hm.data.home_id)
                            .single();
                        if (h?.data?.company_id) companyId = h.data.company_id;
                    } else {
                        const bm = await supabase
                            .from('bank_memberships')
                            .select('company_id')
                            .eq('user_id', uid)
                            .limit(1)
                            .maybeSingle();
                        if (bm?.data?.company_id) companyId = bm.data.company_id;
                    }
                }

                if (companyId) {
                    const co = await supabase
                        .from('companies')
                        .select('id,name')
                        .eq('id', companyId)
                        .maybeSingle();
                    if (co?.data) setCompany(co.data as CompanyRow);
                } else {
                    setCompany(null);
                }

                // Role / position label
                const mgrIds = await supabase.rpc('home_ids_managed_by', { p_user: uid });
                const managerHomes: string[] = Array.isArray(mgrIds?.data) ? (mgrIds!.data as string[]) : [];

                if (managerHomes.length) {
                    setRoleLabel(`Manager${managerHomes.length > 1 ? ' (multi-home)' : ''}`);
                } else {
                    const hms = await supabase
                        .from('home_memberships')
                        .select('home_id, role, manager_subrole, staff_subrole')
                        .eq('user_id', uid);

                    const rows = (hms?.data ?? []) as HomeMembership[];
                    const deputy = rows.find(
                        (r) => r.role === 'MANAGER' && r.manager_subrole === 'DEPUTY_MANAGER'
                    );
                    const teamLead = rows.find(
                        (r) => r.role === 'STAFF' && r.staff_subrole === 'TEAM_LEADER'
                    );
                    const staff = rows.find((r) => r.role === 'STAFF');

                    if (deputy) setRoleLabel('Manager — Deputy');
                    else if (teamLead) setRoleLabel('Staff — Team Leader');
                    else if (staff) setRoleLabel('Staff — Residential');
                    else {
                        const bank = await supabase
                            .from('bank_memberships')
                            .select('company_id')
                            .eq('user_id', uid)
                            .limit(1)
                            .maybeSingle();
                        if (bank?.data?.company_id) setRoleLabel('Staff — Bank');
                        else setRoleLabel(companyId ? 'Company' : 'Member');
                    }
                }
            } catch (e) {
                const msg = e instanceof Error ? e.message : 'Failed to load your details.';
                setError(msg);
            } finally {
                setBusy(false);
            }
        }

        return () => {
            unsub?.unsubscribe?.();
        };
    }, [router, search]);

    async function savePassword() {
        if (!strongEnough || saving) return;
        setSaving(true);
        setError(null);
        try {
            const { error: upErr } = await supabase.auth.updateUser({ password: pw });
            if (upErr) throw upErr;
            router.replace('/dashboard');
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'Failed to set password.';
            setError(msg);
        } finally {
            setSaving(false);
        }
    }

    if (busy) {
        return (
            <div className="p-6 min-h-screen" style={{ background: 'var(--page-bg)', color: 'var(--ink)' }}>
                <div className="animate-pulse">Loading…</div>
            </div>
        );
    }

    return (
        <div className="p-6 min-h-screen" style={{ background: 'var(--page-bg)', color: 'var(--ink)' }}>
            <div className="max-w-xl mx-auto space-y-4">
                <h1 className="text-xl font-semibold">Welcome to HomeOrbit</h1>
                <p className="text-sm" style={{ color: 'var(--sub)' }}>
                    Review what’s been set up for you, then create your password to finish.
                </p>

                {error && (
                    <div
                        className="rounded-lg ring-1 p-3 text-sm"
                        style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                    >
                        {error}
                    </div>
                )}

                <div className="rounded-lg ring-1 p-4" style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}>
                    <div className="grid grid-cols-1 gap-2 text-sm">
                        <div><span className="opacity-75">Email:</span> {email || '—'}</div>
                        <div><span className="opacity-75">Name:</span> {fullName || '—'}</div>
                        <div><span className="opacity-75">Company:</span> {company?.name ?? '—'}</div>
                        <div><span className="opacity-75">Role / Position:</span> {roleLabel}</div>
                    </div>
                </div>

                <div className="rounded-lg ring-1 p-4 space-y-3" style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}>
                    <label className="block text-sm">Create password</label>
                    <input
                        type="password"
                        className="w-full rounded-md px-2 py-2 ring-1 text-sm"
                        style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                        value={pw}
                        onChange={(e) => setPw(e.target.value)}
                        placeholder="At least 12 characters"
                        autoComplete="new-password"
                    />
                    <input
                        type="password"
                        className="w-full rounded-md px-2 py-2 ring-1 text-sm"
                        style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                        value={pw2}
                        onChange={(e) => setPw2(e.target.value)}
                        placeholder="Repeat password"
                        autoComplete="new-password"
                    />

                    <div className="text-xs" style={{ color: 'var(--sub)' }}>
                        Strength: {['Very weak', 'Weak', 'Okay', 'Good', 'Strong'][Math.max(0, Math.min(4, score))]}
                    </div>

                    <button
                        onClick={savePassword}
                        disabled={!strongEnough || saving}
                        className="rounded-md px-3 py-2 text-sm ring-1 transition disabled:opacity-60"
                        style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                    >
                        {saving ? 'Saving…' : 'Save password & continue'}
                    </button>
                </div>
            </div>
        </div>
    );
}

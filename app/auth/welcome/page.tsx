'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/supabase/client';

type Company = { id: string; name: string };
type HomeMembershipRow = {
  home_id: string;
  role: 'MANAGER' | 'STAFF' | null;
  manager_subrole: 'MANAGER' | 'DEPUTY_MANAGER' | null;
  staff_subrole: 'RESIDENTIAL' | 'TEAM_LEADER' | null;
};

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
        }); // uses token_hash variant, no email required. :contentReference[oaicite:6]{index=6}
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
        }); // legacy token+email path. :contentReference[oaicite:7]{index=7}
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
    // We still handle PKCE for completeness. :contentReference[oaicite:8]{index=8}
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

  if (phase === 'verifying') {
    return (
      <div className="p-6 min-h-screen" style={{ background: 'var(--page-bg)', color: 'var(--ink)' }}>
        <div className="max-w-xl mx-auto">
          <p className="text-sm opacity-80">Setting up your account…</p>
        </div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="p-6 min-h-screen" style={{ background: 'var(--page-bg)', color: 'var(--ink)' }}>
        <div className="max-w-xl mx-auto space-y-4">
          <h1 className="text-xl font-semibold">We couldn’t finish signing you in</h1>
          <p className="text-sm" style={{ color: 'var(--sub)' }}>
            {errorMsg || 'Something went wrong. Please log in and try again.'}
          </p>
          <div className="flex gap-2">
            <a
              href="/auth/login"
              className="rounded-md px-3 py-2 text-sm ring-1"
              style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
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
    <div className="p-6 min-h-screen" style={{ background: 'var(--page-bg)', color: 'var(--ink)' }}>
      <div className="max-w-xl mx-auto space-y-5">
        <header>
          <h1 className="text-xl font-semibold">Welcome to HomeOrbit</h1>
          <p className="text-sm" style={{ color: 'var(--sub)' }}>
            Here’s what’s been set up for you. Create your password to finish.
          </p>
        </header>

        <section className="rounded-lg ring-1 p-4" style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}>
          <div className="grid grid-cols-1 gap-2 text-sm">
            <div>
              <span className="opacity-75">Email:</span> {email || '—'}
            </div>
            <div>
              <span className="opacity-75">Name:</span> {fullName || '—'}
            </div>
            <div>
              <span className="opacity-75">Company:</span> {companyName}
            </div>
            <div>
              <span className="opacity-75">Role / Position:</span> {roleLabel}
            </div>
          </div>
        </section>

        <section className="rounded-lg ring-1 p-4 space-y-3" style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}>
          <label className="block text-sm">Create password</label>
          <input
            type="password"
            className="w-full rounded-md px-2 py-2 ring-1 text-sm"
            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
            value={pw1}
            onChange={(e) => setPw1(e.target.value)}
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
            Strength: {['Very weak', 'Weak', 'Okay', 'Good', 'Strong'][strength]}
          </div>
          <button
            onClick={savePassword}
            disabled={!canSavePw || savingPw}
            className="rounded-md px-3 py-2 text-sm ring-1 transition disabled:opacity-60"
            style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
          >
            {savingPw ? 'Saving…' : 'Save password & continue'}
          </button>
        </section>
      </div>
    </div>
  );
}

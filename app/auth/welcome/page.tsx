// app/auth/welcome/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/supabase/client';

type CompanyRow = { id: string; name: string };
type CPPVRow = {
  company_id: string;
  user_id: string;
  full_name: string | null;
  has_company_access: boolean;
  is_bank: boolean;
  home_ids: string[] | null;
  roles: (string | null)[] | null;             // text[]
  staff_subroles: (('RESIDENTIAL' | 'TEAM_LEADER' | null))[] | null;
  manager_subroles: (('MANAGER' | 'DEPUTY_MANAGER' | null))[] | null;
  company_positions: string[] | null;          // enum text[]
};

function strengthScore(pw: string): number {
  let score = 0;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return score; // 0..4
}

export default function WelcomePage() {
  const router = useRouter();
  const params = useSearchParams();

  const [phase, setPhase] = useState<'verifying' | 'loading' | 'ready' | 'error'>('verifying');
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [company, setCompany] = useState<CompanyRow | null>(null);
  const [roleLabel, setRoleLabel] = useState('—');

  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [saving, setSaving] = useState(false);

  const score = useMemo(() => strengthScore(pw), [pw]);
  const strongEnough = score >= 3 && pw === pw2;

  // Guard against double-runs on fast refresh/navigation
  const didVerify = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        // 1) If we arrived from an invite email, Supabase gives us ?token_hash=&type=invite
        const tokenHash = params.get('token_hash');
        const t = params.get('type'); // usually 'invite', sometimes 'recovery'/'email_change'

        // If the URL is the #access_token style (hash), supabase-js auto-extracts it on load.
        // We still attempt verifyOtp ONLY if token_hash is present and we haven't tried yet.
        if (tokenHash && !didVerify.current) {
          didVerify.current = true;
          const type = (t || 'invite') as
            | 'invite'
            | 'signup'
            | 'magiclink'
            | 'recovery'
            | 'email_change';

          const { error: verifyErr } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type,
          });
          if (verifyErr) {
            // Common cause: already used/expired link
            setErrMsg(verifyErr.message || 'This link is invalid or has already been used.');
            setPhase('error');
            return;
          }

          // Clean the URL (drop query params)
          window.history.replaceState({}, '', '/auth/welcome');
        }

        setPhase('loading');

        // 2) Wait for a session (either from hash auto-extract or from verifyOtp)
        const { data: sessRes } = await supabase.auth.getSession();
        let sess = sessRes?.session ?? null;

        if (!sess) {
          // Give auth state a brief moment to propagate (covers hash-style)
          const wait = await new Promise<boolean>((resolve) => {
            const timeout = setTimeout(() => resolve(false), 1500);
            const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
              if (s) {
                clearTimeout(timeout);
                sub.subscription.unsubscribe();
                resolve(true);
              }
            });
          });
          if (wait) {
            const { data: again } = await supabase.auth.getSession();
            sess = again?.session ?? null;
          }
        }

        if (!sess) {
          setErrMsg('We could not create your session. Please log in and try again.');
          setPhase('error');
          return;
        }

        // 3) Show email + basic name from profile
        setEmail(sess.user.email ?? '');

        // profiles.full_name is keyed by user_id (your schema) 
        const prof = await supabase
          .from('profiles')
          .select('full_name')
          .eq('user_id', sess.user.id)
          .maybeSingle();

        if (!prof.error && prof.data) {
          setFullName((prof.data.full_name ?? '').trim());
        }

        // 4) Resolve company + position from your roster view
        //    company_people_positions_v contains all role flags and positions per company for the user. 
        const cpp = await supabase
          .from('company_people_positions_v')
          .select('company_id, user_id, full_name, has_company_access, is_bank, home_ids, roles, staff_subroles, manager_subroles, company_positions')
          .eq('user_id', sess.user.id);

        if (!cpp.error) {
          const rows = (Array.isArray(cpp.data) ? cpp.data : []) as CPPVRow[];

          // Prefer a row where user has company access or any membership;
          // fall back to the first row if multiple.
          const pick =
            rows.find((r) => r.has_company_access) ??
            rows.find((r) => (r.roles?.length ?? 0) > 0 || r.is_bank) ??
            rows[0];

          if (pick?.company_id) {
            const co = await supabase
              .from('companies')
              .select('id,name')
              .eq('id', pick.company_id)
              .maybeSingle();
            if (!co.error && co.data) {
              setCompany({ id: co.data.id as string, name: co.data.name as string });
            }

            // Friendly label
            const roles = (pick.roles ?? []).map((r) => (r ?? '').toUpperCase());
            const mgrSub = (pick.manager_subroles ?? []).map((r) => (r ?? '').toUpperCase());
            const staffSub = (pick.staff_subroles ?? []).map((r) => (r ?? '').toUpperCase());
            const positions = pick.company_positions ?? [];

            let label = 'Member';
            if (roles.includes('MANAGER')) {
              // Deputy manager if any home has that subrole
              label = mgrSub.includes('DEPUTY_MANAGER') ? 'Manager — Deputy' : 'Manager';
              if ((pick.home_ids?.length ?? 0) > 1) label += ' (multi-home)';
            } else if (roles.includes('STAFF')) {
              if (staffSub.includes('TEAM_LEADER')) label = 'Staff — Team Leader';
              else label = 'Staff — Residential';
            } else if (pick.is_bank) {
              label = 'Staff — Bank';
            } else if (pick.has_company_access) {
              label = 'Company';
            }

            // If they also have company positions, append for clarity
            if (positions.length) {
              label += ` — ${positions.join(', ')}`;
            }

            setRoleLabel(label);
          }
        }

        setPhase('ready');
      } catch (e) {
        setErrMsg(e instanceof Error ? e.message : 'Something went wrong.');
        setPhase('error');
      }
    })();
  }, [params]);

  async function savePassword() {
    if (!strongEnough || saving) return;
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;
      router.replace('/dashboard');
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to set password');
    } finally {
      setSaving(false);
    }
  }

  if (phase === 'verifying' || phase === 'loading') {
    return (
      <div className="p-6 min-h-screen" style={{ background: 'var(--page-bg)', color: 'var(--ink)' }}>
        <div className="animate-pulse">Loading…</div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="p-6 min-h-screen" style={{ background: 'var(--page-bg)', color: 'var(--ink)' }}>
        <div className="max-w-xl mx-auto space-y-4">
          <h1 className="text-lg font-semibold">We couldn’t finish signing you in</h1>
          <p className="text-sm" style={{ color: 'var(--sub)' }}>
            {errMsg || 'Your invite link may have expired. Try logging in, or ask your admin to resend the invite.'}
          </p>
          <button
            onClick={() => router.replace('/auth/login')}
            className="rounded-md px-3 py-2 text-sm ring-1 transition"
            style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
          >
            Go to login
          </button>
        </div>
      </div>
    );
  }

  // phase === 'ready'
  return (
    <div className="p-6 min-h-screen" style={{ background: 'var(--page-bg)', color: 'var(--ink)' }}>
      <div className="max-w-xl mx-auto space-y-4">
        <h1 className="text-xl font-semibold">Welcome to HomeOrbit</h1>
        <p className="text-sm" style={{ color: 'var(--sub)' }}>
          Review what’s been set up for you, then create your password to finish.
        </p>

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
            Strength: {['Very weak','Weak','Okay','Good','Strong'][strengthScore(pw)]}
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

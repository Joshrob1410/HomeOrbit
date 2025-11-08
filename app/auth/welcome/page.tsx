'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
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
  const [loading, setLoading] = useState(true);
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
    (async () => {
      const { data: session } = await supabase.auth.getSession();
      const uid = session.session?.user?.id;
      if (!uid) {
        router.replace('/auth/login');
        return;
      }

      // profile basics
      setEmail(session.session.user.email ?? '');
      const { data: prof } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('user_id', uid)
        .maybeSingle();
      setFullName(prof?.full_name ?? '');

      // company (if any)
      const { data: cm } = await supabase
        .from('company_memberships')
        .select('company_id')
        .eq('user_id', uid)
        .maybeSingle();

      if (cm?.company_id) {
        const { data: co } = await supabase
          .from('companies')
          .select('id,name')
          .eq('id', cm.company_id)
          .maybeSingle();
        if (co) setCompany(co as CompanyRow);
      }

      // resolve “role / position” label from memberships
      // manager homes?
      const { data: mgrIds } = await supabase.rpc('home_ids_managed_by', { p_user: uid });
      const managerHomes: string[] = (mgrIds ?? []) as string[];

      if (managerHomes.length) {
        setRoleLabel('Manager' + (managerHomes.length > 1 ? ' (multi-home)' : ''));
      } else {
        // check any home membership (staff or deputy)
        const { data: hms } = await supabase
          .from('home_memberships')
          .select('home_id, role, manager_subrole, staff_subrole')
          .eq('user_id', uid);

        const rows = (hms ?? []) as HomeMembership[];
        const deputy = rows.find(r => r.role === 'MANAGER' && r.manager_subrole === 'DEPUTY_MANAGER');
        const teamLead = rows.find(r => r.role === 'STAFF' && r.staff_subrole === 'TEAM_LEADER');
        const staff = rows.find(r => r.role === 'STAFF');

        if (deputy) setRoleLabel('Manager — Deputy');
        else if (teamLead) setRoleLabel('Staff — Team Leader');
        else if (staff) setRoleLabel('Staff — Residential');
        else {
          // maybe bank?
          const { data: bank } = await supabase
            .from('bank_memberships')
            .select('company_id')
            .eq('user_id', uid)
            .limit(1);
          if (bank && bank.length) setRoleLabel('Staff — Bank');
          else setRoleLabel(company ? 'Company' : 'Member');
        }
      }

      setLoading(false);
    })();
  }, [router, company?.id]);

  async function savePassword() {
    if (!strongEnough) return;
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;
      // Optional: show a nice message then continue to dashboard
      router.replace('/dashboard');
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to set password');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
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
          />
          <input
            type="password"
            className="w-full rounded-md px-2 py-2 ring-1 text-sm"
            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            placeholder="Repeat password"
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

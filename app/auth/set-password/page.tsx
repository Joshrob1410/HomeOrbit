'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/supabase/client';

export default function SetPassword() {
  const router = useRouter();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.replace('/auth/login?error=session_required');
        return;
      }
      setLoading(false);
    })();
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    if (!pw || pw.length < 8) {
      setErr('Password must be at least 8 characters.');
      return;
    }
    if (pw !== pw2) {
      setErr('Passwords do not match.');
      return;
    }

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setSaving(false);

    if (error) {
      setErr(error.message);
      return;
    }

    router.replace('/dashboard');
  }

  if (loading) {
    return <div className="p-5 text-sm" style={{ color: 'var(--ink)' }}>Checking session…</div>;
  }

  return (
    <div className="p-6 max-w-md mx-auto">
      <h1 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>Create your password</h1>
      <p className="text-sm mt-1" style={{ color: 'var(--sub)' }}>
        You’re almost done — set a password for your account.
      </p>

      <form onSubmit={submit} className="mt-4 space-y-3">
        <div>
          <label className="block text-sm" style={{ color: 'var(--ink)' }}>New password</label>
          <input
            type="password"
            className="mt-1 w-full rounded-md px-2 py-2 ring-1 text-sm"
            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="••••••••"
          />
        </div>
        <div>
          <label className="block text-sm" style={{ color: 'var(--ink)' }}>Confirm password</label>
          <input
            type="password"
            className="mt-1 w-full rounded-md px-2 py-2 ring-1 text-sm"
            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            placeholder="••••••••"
          />
        </div>

        {err && <div className="text-sm text-rose-500">{err}</div>}

        <button
          className="rounded-md px-3 py-2 text-sm ring-1 transition"
          style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </div>
  );
}

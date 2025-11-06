'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/supabase/client';

export default function SetPassword() {
  const [pw, setPw] = useState('');
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);
  const router = useRouter();
  const qp = useSearchParams();

  useEffect(() => {
    // If the invite link successfully authenticated them, we have a session.
    // If we don't, send them to login to avoid a confusing dead end.
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace('/auth/login?reason=invite');
      else setReady(true);
    });
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 8) return;
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setSaving(false);
    if (error) return alert(error.message);

    // Optionally clear ?from=invite and go to dashboard
    router.replace('/dashboard');
  }

  if (!ready) return null;

  return (
    <form onSubmit={onSubmit} className="max-w-sm space-y-3">
      <h1 className="text-lg font-semibold">Set your password</h1>
      <input
        type="password"
        className="w-full rounded-md px-3 py-2 ring-1"
        placeholder="New password (min 8)"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
      />
      <button
        className="rounded-md px-3 py-2 text-sm ring-1"
        disabled={saving || pw.length < 8}
      >
        {saving ? 'Saving…' : 'Save password'}
      </button>
    </form>
  );
}

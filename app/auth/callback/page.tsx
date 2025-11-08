'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/supabase/client';

export default function AuthCallback() {
  const router = useRouter();
  const sp = useSearchParams();

  useEffect(() => {
    const code = sp.get('code');
    const type = sp.get('type'); // 'invite' | 'magiclink' | 'recovery' | 'email_change' | etc.
    const next = sp.get('next') || '/dashboard';

    if (!code) {
      router.replace('/auth/login?error=missing_code');
      return;
    }

    (async () => {
      // Supabase JS v2
      const { error } = await supabase.auth.exchangeCodeForSession({ code });
      if (error) {
        router.replace(`/auth/login?error=${encodeURIComponent(error.message)}`);
        return;
      }

      if (type === 'invite' || type === 'recovery') {
        router.replace('/auth/set-password');
      } else {
        router.replace(next);
      }
    })();
  }, [router, sp]);

  return (
    <div className="p-5 text-sm" style={{ color: 'var(--ink)' }}>
      Signing you in…
    </div>
  );
}

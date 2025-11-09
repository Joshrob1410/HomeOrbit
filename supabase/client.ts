import { createBrowserClient } from '@supabase/ssr';

export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true, // needed to handle #access_token or ?token_hash flows
      // flowType: 'pkce', // fine to leave as default; invites don’t use PKCE anyway. :contentReference[oaicite:9]{index=9}
    },
  }
);

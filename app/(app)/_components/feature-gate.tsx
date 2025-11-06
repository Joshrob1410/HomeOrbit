// app/(app)/_components/feature-gate.tsx
import { redirect } from 'next/navigation';
import { getServerSupabase } from '@/supabase/server';

export type AppFeature =
  | 'TRAINING' | 'BOOKINGS' | 'ROTAS' | 'TIMESHEETS' | 'ANNUAL_LEAVE'
  | 'BUDGETS' | 'SUPERVISIONS' | 'PAYSLIPS' | 'APPOINTMENTS'
  | 'POLICIES' | 'MANAGEMENT' | 'LICENSES';

/**
 * Server-side guard.
 * Rules:
 * - If no session → redirect to /auth/login (adjust if you gate elsewhere).
 * - If the user has NO company memberships → allow (covers global/admin-style users).
 * - Else check company_features_effective_v for the first company. If disabled → redirect /dashboard.
 *
 * This mirrors the Sidebar behavior (first company wins; defaults ON).
 */
export async function requireFeature(feature: AppFeature) {
    const supabase = await getServerSupabase();

  const { data: session } = await supabase.auth.getUser();
  if (!session?.user) {
    redirect('/auth/login');
  }

  // Get the user's company ids (first one is used across your app)
  const { data: companyIds, error: idErr } = await supabase.rpc('user_company_ids');
  if (idErr) {
    redirect('/dashboard'); // conservative: deny on error
  }

  const list: string[] = Array.isArray(companyIds) ? companyIds : [];
  if (list.length === 0) {
    // Likely an Admin/global account with no company tie — allow.
    return;
  }

  const companyId = list[0];

  // Check the effective flag (defaults true if no row)
  const { data: row, error: flagErr } = await supabase
    .from('company_features_effective_v')
    .select('is_enabled')
    .eq('company_id', companyId)
    .eq('feature', feature)
    .maybeSingle();

  if (flagErr) {
    redirect('/dashboard');
  }

  const enabled = row?.is_enabled ?? true;
  if (!enabled) {
    redirect('/dashboard');
  }
}

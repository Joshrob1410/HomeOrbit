// app/api/admin/create-user/route.ts (Node runtime)
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // server-only
  { auth: { autoRefreshToken: false, persistSession: false } }
);

type Level = '1_ADMIN' | '2_COMPANY' | '3_MANAGER' | '4_STAFF';
type StaffSubrole = 'RESIDENTIAL' | 'TEAM_LEADER';
type ManagerSubrole = 'MANAGER' | 'DEPUTY_MANAGER';
type CompanyPosition = 'OWNER' | 'FINANCE_OFFICER' | 'SITE_MANAGER';

type Body = {
  email: string;
  full_name: string;
  role: Level;
  company_id: string | null;
  home_id: string | null;                 // for staff/deputy manager
  manager_home_ids?: string[];            // for managers across many homes
  position: '' | 'BANK' | StaffSubrole | ManagerSubrole;
  company_positions: CompanyPosition[];
};

export async function POST(req: NextRequest) {
  try {
    const {
      email, full_name,
      role, company_id, home_id,
      manager_home_ids = [],
      position, company_positions,
    } = (await req.json()) as Body;

    // Compute redirect origin
    const forwardedProto = req.headers.get('x-forwarded-proto') ?? 'https';
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? `${forwardedProto}://${host}`;

    // 1) Send the invite — land on welcome page to review + set password
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name },
      redirectTo: `${origin}/auth/welcome?from=invite`,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const userId = data.user.id;

    // 2) Seed your app rows
    // profiles table uses user_id as PK (NOT id) per schema.
    await admin.from('profiles').upsert({ user_id: userId, full_name });

    // Attach company membership for any non-admin role if a company is provided.
    if (role !== '1_ADMIN' && company_id) {
      await admin.from('company_memberships').upsert({
        user_id: userId,
        company_id,
        positions: role === '2_COMPANY' ? company_positions ?? [] : [],
      });
    }

    // Home/bank memberships based on role/position
    if (role === '4_STAFF') {
      if (position === 'BANK' && company_id) {
        await admin.from('bank_memberships').upsert({
          user_id: userId,
          company_id,
        });
      } else if (home_id) {
        await admin.from('home_memberships').upsert({
          user_id: userId,
          home_id,
          role: 'STAFF',
          staff_subrole: position === 'TEAM_LEADER' ? 'TEAM_LEADER' : 'RESIDENTIAL',
          manager_subrole: null,
        });
      }
    }

    if (role === '3_MANAGER') {
      if (position === 'MANAGER' && manager_home_ids.length) {
        // Multi-home manager
        const rows = manager_home_ids.map((hid) => ({
          user_id: userId,
          home_id: hid,
          role: 'MANAGER',
          manager_subrole: 'MANAGER' as const,
          staff_subrole: null,
        }));
        await admin.from('home_memberships').upsert(rows);
      } else if (position === 'DEPUTY_MANAGER' && home_id) {
        await admin.from('home_memberships').upsert({
          user_id: userId,
          home_id,
          role: 'MANAGER',
          manager_subrole: 'DEPUTY_MANAGER',
          staff_subrole: null,
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e ?? 'Failed');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

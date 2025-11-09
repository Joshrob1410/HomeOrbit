// app/api/admin/create-user/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

type CompanyPosition =
  | 'OWNER'
  | 'FINANCE_OFFICER'
  | 'SITE_MANAGER'
  | string;

type Body = {
  email: string;
  full_name?: string | null;

  company_id?: string | null;
  has_company_access?: boolean;

  company_positions?: CompanyPosition[];   // positions at company level

  // Home-level memberships (optional)
  manager_home_ids?: string[];            // make them MANAGER in these homes
  manager_subrole?: 'MANAGER' | 'DEPUTY_MANAGER' | null;

  staff_home_id?: string | null;          // make them STAFF in this home (optional)
  staff_subrole?: 'RESIDENTIAL' | 'TEAM_LEADER' | null;

  is_bank?: boolean;                      // add to bank_memberships (optional)
};

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // server-only
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;

    const {
      email,
      full_name = null,

      company_id,
      has_company_access = false,

      company_positions = [],

      manager_home_ids = [],
      manager_subrole = 'MANAGER',

      staff_home_id = null,
      staff_subrole = 'RESIDENTIAL',

      is_bank = false,
    } = body;

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    // Compute absolute origin for redirect
    const forwardedProto = req.headers.get('x-forwarded-proto') ?? 'https';
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
    const origin =
      process.env.NEXT_PUBLIC_SITE_URL ?? `${forwardedProto}://${host}`;

    // 1) Send the invite (Supabase will include this redirect in the email link)
    //    /auth/welcome must call exchangeCodeForSession({ token_hash, type })
    const { data: invite, error: inviteErr } =
      await admin.auth.admin.inviteUserByEmail(email, {
        data: { full_name: full_name ?? undefined },
        redirectTo: `${origin}/auth/welcome`,
      });

    if (inviteErr) {
      return NextResponse.json({ error: inviteErr.message }, { status: 400 });
    }

    const userId = invite.user.id;

    // 2) Create/Update profile (PK is user_id)
    {
      const { error } = await admin.from('profiles').upsert(
        { user_id: userId, full_name, is_admin: false },
        { onConflict: 'user_id' }
      );
      if (error) throw error;
    }

    // Nothing else to do if no company_id provided
    if (!company_id) {
      return NextResponse.json({ ok: true, userId });
    }

    // 3) Company membership row (controls company-level access)
    {
      const { error } = await admin.from('company_memberships').upsert(
        {
          user_id: userId,
          company_id,
          has_company_access: !!has_company_access,
        },
        { onConflict: 'company_id,user_id' }
      );
      if (error) throw error;
    }

    // 4) Company positions → rows in company_membership_positions
    if (company_positions.length) {
      // Upsert each selected position
      const rows = company_positions.map((position) => ({
        user_id: userId,
        company_id,
        position,
      }));

      const { error } = await admin
        .from('company_membership_positions')
        .upsert(rows, { onConflict: 'user_id,company_id,position' });
      if (error) throw error;

      // Optional: if you want to "replace" positions exactly, delete extras:
      // await admin
      //   .from('company_membership_positions')
      //   .delete()
      //   .eq('user_id', userId)
      //   .eq('company_id', company_id)
      //   .not('position', 'in', `(${company_positions.map((p) => `'${p}'`).join(',')})`);
    }

    // 5) Bank membership (optional)
    if (is_bank) {
      const { error } = await admin
        .from('bank_memberships')
        .upsert({ user_id: userId, company_id }, { onConflict: 'user_id,company_id' });
      if (error) throw error;
    }

    // 6) Manager across multiple homes (optional)
    if (Array.isArray(manager_home_ids) && manager_home_ids.length) {
      const rows = manager_home_ids.map((home_id) => ({
        user_id: userId,
        home_id,
        role: 'MANAGER' as const,
        manager_subrole: manager_subrole ?? 'MANAGER',
      }));
      const { error } = await admin
        .from('home_memberships')
        .upsert(rows, { onConflict: 'user_id,home_id' });
      if (error) throw error;
    }

    // 7) Single staff home (optional)
    if (staff_home_id) {
      const { error } = await admin.from('home_memberships').upsert(
        {
          user_id: userId,
          home_id: staff_home_id,
          role: 'STAFF',
          staff_subrole: staff_subrole ?? 'RESIDENTIAL',
        },
        { onConflict: 'user_id,home_id' }
      );
      if (error) throw error;
    }

    return NextResponse.json({ ok: true, userId });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e ?? 'Failed');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

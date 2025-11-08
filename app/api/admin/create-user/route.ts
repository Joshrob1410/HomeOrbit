// app/api/admin/create-user/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

type AppLevel = '1_ADMIN' | '2_COMPANY' | '3_MANAGER' | '4_STAFF';
type CompanyPosition = 'OWNER' | 'FINANCE_OFFICER' | 'SITE_MANAGER';
type StaffPosition = '' | 'BANK' | 'RESIDENTIAL' | 'TEAM_LEADER';
type ManagerPosition = '' | 'MANAGER' | 'DEPUTY_MANAGER';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      email,
      full_name,
      role,                 // AppLevel
      company_id,           // string | null
      home_id,              // string | null  (single-home for Staff/Deputy)
      manager_home_ids,     // string[]       (multi-home for Manager)
      position,             // STAFF: BANK|RESIDENTIAL|TEAM_LEADER; MANAGER: MANAGER|DEPUTY_MANAGER; COMPANY: ''
      company_positions = [], // CompanyPosition[]
    } = body as {
      email: string;
      full_name?: string;
      role: AppLevel;
      company_id?: string | null;
      home_id?: string | null;
      manager_home_ids?: string[];
      position?: StaffPosition | ManagerPosition | '';
      company_positions?: CompanyPosition[];
    };

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }
    if (!role) {
      return NextResponse.json({ error: 'Role is required' }, { status: 400 });
    }

    // Compute absolute origin for the invite redirect
    const forwardedProto = req.headers.get('x-forwarded-proto') ?? 'https';
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? `${forwardedProto}://${host}`;

    // 1) Supabase invite with redirect to onboarding page
    const { data: invite, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      data: full_name ? { full_name } : undefined,
      redirectTo: `${origin}/auth/welcome`,
    });
    if (inviteErr) {
      return NextResponse.json({ error: inviteErr.message }, { status: 400 });
    }

    const userId = invite!.user.id;

    // 2) Seed app-side data (profiles + memberships)
    // profiles.user_id, not "id"
    {
      const { error: profErr } = await admin
        .from('profiles')
        .upsert({ user_id: userId, full_name: full_name ?? null, is_admin: role === '1_ADMIN' });
      if (profErr) throw profErr;
    }

    // ADMIN: nothing else required (is_admin=true is enough in your app)
    if (role === '1_ADMIN') {
      return NextResponse.json({ ok: true });
    }

    // Helper to run RPCs safely
    const callRpc = async (fn: string, args: Record<string, unknown>) => {
      const { error } = await admin.rpc(fn, args as any);
      if (error) throw new Error(`${fn} failed: ${error.message}`);
    };

    // COMPANY: ensure has_company_access + positions
    if (role === '2_COMPANY') {
      if (!company_id) {
        return NextResponse.json({ error: 'company_id is required for Company role' }, { status: 400 });
      }
      // Ensure membership with company access (positions RPC also ensures but do it explicitly if none provided)
      if (!company_positions?.length) {
        const { error } = await admin
          .from('company_memberships')
          .upsert({ user_id: userId, company_id, has_company_access: true });
        if (error) throw error;
      }
      // Add positions via RPC (ensures membership and validates)
      for (const pos of company_positions) {
        await callRpc('admin_set_company_position', {
          p_user_id: userId,
          p_company_id: company_id,
          p_position: pos,
          p_enable: true,
        });
      }
      return NextResponse.json({ ok: true });
    }

    // MANAGER: MANAGER (multi-home) or DEPUTY_MANAGER (single home)
    if (role === '3_MANAGER') {
      const managerPos = (position as ManagerPosition) || '';
      if (managerPos === 'MANAGER') {
        const ids = Array.isArray(manager_home_ids) ? manager_home_ids : [];
        if (!ids.length) {
          return NextResponse.json({ error: 'manager_home_ids is required for Manager position' }, { status: 400 });
        }
        for (const hid of ids) {
          await callRpc('admin_set_manager_subrole', {
            p_user_id: userId,
            p_home_id: hid,
            p_manager_subrole: 'MANAGER',
          });
        }
      } else if (managerPos === 'DEPUTY_MANAGER') {
        if (!home_id) {
          return NextResponse.json({ error: 'home_id is required for Deputy Manager' }, { status: 400 });
        }
        await callRpc('admin_set_manager_subrole', {
          p_user_id: userId,
          p_home_id: home_id,
          p_manager_subrole: 'DEPUTY_MANAGER',
        });
      } else {
        return NextResponse.json({ error: 'Manager position must be MANAGER or DEPUTY_MANAGER' }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }

    // STAFF: BANK or home STAFF (RESIDENTIAL/TEAM_LEADER)
    if (role === '4_STAFF') {
      const staffPos = (position as StaffPosition) || '';
      if (staffPos === 'BANK') {
        if (!company_id) {
          return NextResponse.json({ error: 'company_id is required for Bank staff' }, { status: 400 });
        }
        const { error } = await admin
          .from('bank_memberships')
          .insert({ user_id: userId, company_id });
        if (error && error.code !== '23505') throw error; // ignore unique conflict
      } else {
        if (!home_id) {
          return NextResponse.json({ error: 'home_id is required for Staff roles' }, { status: 400 });
        }
        const subrole: 'RESIDENTIAL' | 'TEAM_LEADER' =
          staffPos === 'TEAM_LEADER' ? 'TEAM_LEADER' : 'RESIDENTIAL';
        await callRpc('admin_set_staff_subrole', {
          p_user_id: userId,
          p_home_id: home_id,
          p_staff_subrole: subrole,
        });
      }
      return NextResponse.json({ ok: true });
    }

    // Fallback (shouldn’t hit)
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e ?? 'Failed');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

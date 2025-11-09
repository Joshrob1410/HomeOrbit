// app/api/admin/create-user/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // server-only
  { auth: { autoRefreshToken: false, persistSession: false } }
);

type Level = '1_ADMIN' | '2_COMPANY' | '3_MANAGER' | '4_STAFF';
type StaffPosition = 'BANK' | 'RESIDENTIAL' | 'TEAM_LEADER';
type ManagerPosition = 'MANAGER' | 'DEPUTY_MANAGER';
type CompanyPosition = 'OWNER' | 'FINANCE_OFFICER' | 'SITE_MANAGER';

type Body = {
  email: string;
  full_name: string;
  role: Level;
  company_id: string | null;        // required for non-admin roles
  home_id: string | null;           // used for STAFF & DEPUTY_MANAGER
  manager_home_ids?: string[];      // used for MANAGER (multi-home allowed)
  position: '' | StaffPosition | ManagerPosition;
  company_positions?: CompanyPosition[]; // used for 2_COMPANY
};

function isLevel(v: unknown): v is Level {
  return v === '1_ADMIN' || v === '2_COMPANY' || v === '3_MANAGER' || v === '4_STAFF';
}
function isStaffPosition(v: unknown): v is StaffPosition {
  return v === 'BANK' || v === 'RESIDENTIAL' || v === 'TEAM_LEADER';
}
function isManagerPosition(v: unknown): v is ManagerPosition {
  return v === 'MANAGER' || v === 'DEPUTY_MANAGER';
}
function asStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return typeof v === 'string' ? v : null;
}

export async function POST(req: NextRequest) {
  try {
    const raw = (await req.json()) as Partial<Body>;

    // ---- minimal validation (no external deps) ----
    const email = typeof raw.email === 'string' ? raw.email.trim() : '';
    const full_name = typeof raw.full_name === 'string' ? raw.full_name.trim() : '';
    const role = raw.role;
    const company_id = asStringOrNull(raw.company_id);
    const home_id = asStringOrNull(raw.home_id);
    const manager_home_ids = Array.isArray(raw.manager_home_ids)
      ? raw.manager_home_ids.filter((x): x is string => typeof x === 'string' && x.length > 0)
      : [];
    const position = (typeof raw.position === 'string' ? (raw.position as Body['position']) : '') || '';
    const company_positions = Array.isArray(raw.company_positions)
      ? (raw.company_positions.filter((x): x is CompanyPosition =>
          x === 'OWNER' || x === 'FINANCE_OFFICER' || x === 'SITE_MANAGER'
        ))
      : [];

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }
    if (!full_name) {
      return NextResponse.json({ error: 'Full name is required' }, { status: 400 });
    }
    if (!isLevel(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }
    if (role !== '1_ADMIN' && !company_id) {
      return NextResponse.json({ error: 'company_id is required for non-admin roles' }, { status: 400 });
    }
    if (role === '4_STAFF' && position && !isStaffPosition(position)) {
      return NextResponse.json({ error: 'Invalid staff position' }, { status: 400 });
    }
    if (role === '3_MANAGER' && position && !isManagerPosition(position)) {
      return NextResponse.json({ error: 'Invalid manager position' }, { status: 400 });
    }

    // ---- compute redirect origin (works on Vercel preview/custom domains) ----
    const forwardedProto = req.headers.get('x-forwarded-proto') ?? 'https';
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? `${forwardedProto}://${host}`;

    // ---- 1) Send invite (user receives link, accepts -> /auth/welcome) ----
    const invite = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name },
      redirectTo: `${origin}/auth/welcome?from=invite`,
    });
    if (invite.error || !invite.data?.user?.id) {
      const msg = invite.error?.message ?? 'Failed to send invite';
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    const userId = invite.data.user.id;

    // ---- 2) Seed core app data (service role bypasses RLS) ----
    // profiles uses user_id as PK (per schema)
    {
      const { error: profErr } = await admin
        .from('profiles')
        .upsert({ user_id: userId, full_name }, { onConflict: 'user_id' });
      if (profErr) {
        return NextResponse.json({ error: `profiles upsert failed: ${profErr.message}` }, { status: 500 });
      }
    }

    // Company membership for all non-admin roles
    if (role !== '1_ADMIN' && company_id) {
      const { error: cmErr } = await admin
        .from('company_memberships')
        .upsert(
          {
            user_id: userId,
            company_id,
            positions: role === '2_COMPANY' ? company_positions : [],
          },
          { onConflict: 'user_id,company_id' }
        );
      if (cmErr) {
        return NextResponse.json({ error: `company_memberships upsert failed: ${cmErr.message}` }, { status: 500 });
      }
    }

    // Staff memberships/positions
    if (role === '4_STAFF') {
      if (position === 'BANK') {
        if (!company_id) {
          return NextResponse.json({ error: 'company_id is required for BANK staff' }, { status: 400 });
        }
        const { error: bankErr } = await admin
          .from('bank_memberships')
          .upsert({ user_id: userId, company_id }, { onConflict: 'user_id,company_id' });
        if (bankErr) {
          return NextResponse.json({ error: `bank_memberships upsert failed: ${bankErr.message}` }, { status: 500 });
        }
      } else if (home_id) {
        const staff_subrole: 'RESIDENTIAL' | 'TEAM_LEADER' =
          position === 'TEAM_LEADER' ? 'TEAM_LEADER' : 'RESIDENTIAL';
        const { error: hmErr } = await admin
          .from('home_memberships')
          .upsert(
            {
              user_id: userId,
              home_id,
              role: 'STAFF',
              staff_subrole,
              manager_subrole: null,
            },
            { onConflict: 'user_id,home_id' }
          );
        if (hmErr) {
          return NextResponse.json({ error: `home_memberships upsert failed: ${hmErr.message}` }, { status: 500 });
        }
      }
    }

    // Manager memberships/positions
    if (role === '3_MANAGER') {
      if (position === 'MANAGER') {
        if (!manager_home_ids.length) {
          return NextResponse.json({ error: 'manager_home_ids is required for MANAGER position' }, { status: 400 });
        }
        const rows = manager_home_ids.map((hid) => ({
          user_id: userId,
          home_id: hid,
          role: 'MANAGER' as const,
          manager_subrole: 'MANAGER' as const,
          staff_subrole: null as null,
        }));
        const { error: hmErr } = await admin.from('home_memberships').upsert(rows, {
          onConflict: 'user_id,home_id',
        });
        if (hmErr) {
          return NextResponse.json({ error: `home_memberships upsert failed: ${hmErr.message}` }, { status: 500 });
        }
      } else if (position === 'DEPUTY_MANAGER') {
        if (!home_id) {
          return NextResponse.json({ error: 'home_id is required for DEPUTY_MANAGER position' }, { status: 400 });
        }
        const { error: hmErr } = await admin
          .from('home_memberships')
          .upsert(
            {
              user_id: userId,
              home_id,
              role: 'MANAGER',
              manager_subrole: 'DEPUTY_MANAGER',
              staff_subrole: null,
            },
            { onConflict: 'user_id,home_id' }
          );
        if (hmErr) {
          return NextResponse.json({ error: `home_memberships upsert failed: ${hmErr.message}` }, { status: 500 });
        }
      }
    }

    return NextResponse.json({ ok: true, user_id: userId });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e ?? 'Failed');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

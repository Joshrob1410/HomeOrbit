// app/api/admin/create-user/route.ts (Node runtime)
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // server-only
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      email, full_name,
      role, company_id, home_id,
      manager_home_ids, position, company_positions,
    } = body;

    // Build an absolute origin for redirects:
    // 1) Prefer explicit env on Vercel
    // 2) Fallback to request headers (works on previews/custom domains)
    const forwardedProto = req.headers.get('x-forwarded-proto') ?? 'https';
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? `${forwardedProto}://${host}`;

    // 1) Send the invite (Supabase will include this redirect in the email link)
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name },
      // Land them on your page that lets them set their password:
      redirectTo: `${origin}/auth/set-password?from=invite`,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const userId = data.user.id;

    // 2) Seed your app data now (they become active after verifying the link)
    await admin.from('profiles').upsert({ id: userId, full_name });
    // TODO: add your company/home/role inserts using role, company_id, etc.

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 });
  }
}

// /app/api/admin/create-user/route.ts (Node runtime)
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!, // node-only
    { auth: { autoRefreshToken: false, persistSession: false } }
)

export async function POST(req: NextRequest) {
    const body = await req.json()
    const {
        email, full_name,
        role, company_id, home_id,
        manager_home_ids, position, company_positions
    } = body

    // 1) Invite = sends email + creates user (status: invited)
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { full_name },
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    const userId = data.user.id

    // 2) Seed your app data now (they're not active until they verify)
    await admin.from('profiles').upsert({ id: userId, full_name })
    // …insert company_memberships / home_memberships / roles, etc.

    return NextResponse.json({ ok: true })
}

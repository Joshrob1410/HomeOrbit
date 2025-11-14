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

    company_positions?: CompanyPosition[];

    manager_home_ids?: string[];
    manager_subrole?: 'MANAGER' | 'DEPUTY_MANAGER' | null;

    staff_home_id?: string | null;
    staff_subrole?: 'RESIDENTIAL' | 'TEAM_LEADER' | null;

    is_bank?: boolean;
};

const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
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
            return NextResponse.json(
                { ok: false, error: 'Email is required' },
                { status: 400 }
            );
        }

        // Compute origin (prefer NEXT_PUBLIC_SITE_URL in production)
        const envUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ?? null;
        const forwardedProto = req.headers.get('x-forwarded-proto') ?? 'https';
        const host =
            req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '';
        const origin = envUrl || `${forwardedProto}://${host}`;
        const welcomeUrl = `${origin}/auth/welcome`;

        // 1) Send invite – Supabase + SES handle the actual email
        const { data: invite, error: inviteErr } =
            await admin.auth.admin.inviteUserByEmail(email, {
                data: { full_name: full_name ?? undefined },
                redirectTo: welcomeUrl,
            });

        if (inviteErr) {
            return NextResponse.json(
                { ok: false, error: inviteErr.message },
                { status: 400 }
            );
        }

        const userId = invite.user.id;

        // 2) Profile
        {
            const { error } = await admin
                .from('profiles')
                .upsert(
                    { user_id: userId, full_name, is_admin: false },
                    { onConflict: 'user_id' }
                );
            if (error) throw error;
        }

        // 3) If no company specified, return early
        if (!company_id) {
            return NextResponse.json({
                ok: true,
                userId,
                message: 'Invite sent and profile created (no company linked).',
            });
        }

        // 4) Company membership
        {
            const { error } = await admin
                .from('company_memberships')
                .upsert(
                    {
                        user_id: userId,
                        company_id,
                        has_company_access: !!has_company_access,
                    },
                    { onConflict: 'company_id,user_id' }
                );
            if (error) throw error;
        }

        // 5) Company positions
        if (company_positions.length) {
            const rows = company_positions.map((position) => ({
                user_id: userId,
                company_id,
                position,
            }));

            const { error } = await admin
                .from('company_membership_positions')
                .upsert(rows, { onConflict: 'user_id,company_id,position' });

            if (error) throw error;
        }

        // 6) Bank membership
        if (is_bank) {
            const { error } = await admin
                .from('bank_memberships')
                .upsert(
                    { user_id: userId, company_id },
                    { onConflict: 'user_id,company_id' }
                );
            if (error) throw error;
        }

        // 7) Manager in multiple homes
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

        // 8) Staff in a single home
        if (staff_home_id) {
            const { error } = await admin
                .from('home_memberships')
                .upsert(
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

        return NextResponse.json({
            ok: true,
            userId,
            message: 'Invite sent and access configured.',
        });
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e ?? 'Failed');
        return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
}

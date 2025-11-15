// app/api/admin/people/reset-password/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    }
);

export async function POST(req: NextRequest) {
    try {
        const { email } = (await req.json()) as { email?: string | null };

        if (!email || !email.trim()) {
            return NextResponse.json(
                { ok: false, error: 'Email is required' },
                { status: 400 }
            );
        }

        const origin =
            process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ?? 'https://homeorbit.co.uk';
        const redirectTo = `${origin}/auth/reset`;

        const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email.trim(), {
            redirectTo,
        });

        if (error) {
            return NextResponse.json(
                { ok: false, error: error.message },
                { status: 400 }
            );
        }

        return NextResponse.json({
            ok: true,
            message: 'Password reset email sent.',
        });
    } catch (e) {
        const message = e instanceof Error ? e.message : 'Failed to send password reset email';
        return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
}

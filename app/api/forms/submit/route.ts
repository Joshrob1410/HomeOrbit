// app/api/forms/submit/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json }
    | Json[];

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const runtime = 'nodejs';

function getClient(accessToken: string) {
    return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        global: {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        },
    });
}

export async function POST(req: NextRequest) {
    const authHeader = req.headers.get('authorization') ?? '';
    const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    const accessToken = tokenMatch ? tokenMatch[1] : null;

    if (!accessToken) {
        return NextResponse.json(
            { error: 'Missing access token' },
            { status: 401 },
        );
    }

    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json(
            { error: 'Invalid JSON body' },
            { status: 400 },
        );
    }

    if (!body || typeof body !== 'object') {
        return NextResponse.json(
            { error: 'entryId is required' },
            { status: 400 },
        );
    }

    const parsed = body as Record<string, unknown>;

    if (typeof parsed.entryId !== 'string') {
        return NextResponse.json(
            { error: 'entryId is required' },
            { status: 400 },
        );
    }

    const entryId = parsed.entryId;
    const answersUnknown = parsed.answers;

    if (
        !answersUnknown ||
        typeof answersUnknown !== 'object' ||
        Array.isArray(answersUnknown)
    ) {
        return NextResponse.json(
            { error: 'answers must be an object' },
            { status: 400 },
        );
    }

    const answers = answersUnknown as Json;

    const supabase = getClient(accessToken);

    // Work out whether this user counts as "manager level" or not
    const { data: membershipRows, error: membershipErr } =
        await supabase
            .from('roster_memberships_v')
            .select('role');

    if (membershipErr) {
        console.error(
            '❌ /api/forms/submit membership error',
            membershipErr,
        );
    }

    const roles = membershipRows?.map((r) => r.role) ?? [];
    const isManagerLevel = roles.some((r) =>
        ['ADMIN', 'COMPANY', 'MANAGER'].includes(r),
    );

    const nextStatus = isManagerLevel ? 'LOCKED' : 'SUBMITTED';
    const submittedAt = new Date().toISOString();

    const { data, error } = await supabase
        .from('form_entries')
        .update({
            answers,
            status: nextStatus,
            submitted_at: submittedAt,
            updated_at: submittedAt,
        })
        .eq('id', entryId)
        .eq('status', 'DRAFT') // only allow submit from DRAFT
        .select('id, status, submitted_at')
        .maybeSingle();

    if (error) {
        console.error('❌ /api/forms/submit error', error);
        return NextResponse.json(
            { error: 'Could not submit form entry' },
            { status: 400 },
        );
    }

    if (!data) {
        return NextResponse.json(
            {
                error:
                    'Form not found, not editable, or already submitted.',
            },
            { status: 404 },
        );
    }

    return NextResponse.json({
        id: data.id,
        status: data.status,
        submittedAt: data.submitted_at,
    });
}

// app/api/forms/delete/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

type FormEntryStatus = 'DRAFT' | 'SUBMITTED' | 'LOCKED' | 'CANCELLED';

type DeleteBody = {
    entryId: string;
};

function parseDeleteBody(body: unknown): DeleteBody | null {
    if (
        typeof body === 'object' &&
        body !== null &&
        'entryId' in body &&
        typeof (body as { entryId: unknown }).entryId === 'string'
    ) {
        return { entryId: (body as { entryId: string }).entryId };
    }
    return null;
}

function createRouteClient(accessToken: string) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !anonKey) {
        throw new Error('Missing Supabase environment variables');
    }

    return createClient(url, anonKey, {
        global: {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        },
    });
}

export async function POST(req: NextRequest) {
    try {
        const authHeader = req.headers.get('authorization') ?? '';
        const token = authHeader.startsWith('Bearer ')
            ? authHeader.slice('Bearer '.length)
            : null;

        if (!token) {
            return NextResponse.json(
                { error: 'Missing access token' },
                { status: 401 },
            );
        }

        const rawBody = (await req.json().catch(() => null)) as unknown;
        const body = parseDeleteBody(rawBody);

        if (!body) {
            return NextResponse.json(
                { error: 'entryId is required' },
                { status: 400 },
            );
        }

        const client = createRouteClient(token);

        // Load entry (RLS on, so only allowed users can see/update it)
        const { data: entry, error: entryError } = await client
            .from('form_entries')
            .select('id, status')
            .eq('id', body.entryId)
            .maybeSingle<{ id: string; status: FormEntryStatus }>();

        if (entryError) {
            console.error('❌ delete form_entry load failed', entryError);
            return NextResponse.json(
                { error: 'Could not load form entry' },
                { status: 500 },
            );
        }

        if (!entry) {
            return NextResponse.json(
                { error: 'Form entry not found' },
                { status: 404 },
            );
        }

        if (entry.status !== 'DRAFT') {
            return NextResponse.json(
                { error: 'Only draft forms can be deleted' },
                { status: 400 },
            );
        }

        // Soft-delete: mark as CANCELLED so it disappears from drafts lists
        const { error: updateError } = await client
            .from('form_entries')
            .update({
                status: 'CANCELLED',
            })
            .eq('id', body.entryId);

        if (updateError) {
            console.error('❌ delete form_entry update failed', updateError);
            return NextResponse.json(
                { error: 'Could not delete draft form' },
                { status: 500 },
            );
        }

        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error('❌ delete form_entry unexpected error', err);
        return NextResponse.json(
            { error: 'Unexpected error while deleting form' },
            { status: 500 },
        );
    }
}

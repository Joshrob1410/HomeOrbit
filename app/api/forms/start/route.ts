// app/api/forms/start/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

// We use the anon key + bearer token so RLS still applies
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
        'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY'
    );
}

function createRouteClient(accessToken: string) {
    return createClient(supabaseUrl!, supabaseAnonKey!, {
        global: {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        },
    });
}

export async function POST(req: NextRequest) {
    try {
        const authHeader =
            req.headers.get('authorization') ??
            req.headers.get('Authorization');
        const accessToken = authHeader?.startsWith('Bearer ')
            ? authHeader.slice('Bearer '.length)
            : null;

        if (!accessToken) {
            return NextResponse.json(
                { error: 'Missing access token' },
                { status: 401 }
            );
        }

        const supabase = createRouteClient(accessToken);

        const { data: userRes, error: userError } =
            await supabase.auth.getUser();
        if (userError || !userRes?.user) {
            return NextResponse.json(
                { error: 'Not authenticated' },
                { status: 401 }
            );
        }
        const user = userRes.user;

        const body = await req.json().catch(() => null);
        const youngPersonId = body?.youngPersonId as string | undefined;
        const blueprintId = body?.blueprintId as string | undefined;

        if (!youngPersonId || !blueprintId) {
            return NextResponse.json(
                { error: 'youngPersonId and blueprintId are required' },
                { status: 400 }
            );
        }

        // Load young person and blueprint with RLS in place
        const [
            { data: yp, error: ypError },
            { data: blueprint, error: bpError },
        ] = await Promise.all([
            supabase
                .from('young_people')
                .select('id, company_id, home_id')
                .eq('id', youngPersonId)
                .maybeSingle(),
            supabase
                .from('form_blueprints')
                .select('id, company_id, head, status')
                .eq('id', blueprintId)
                .maybeSingle(),
        ]);

        if (ypError || !yp) {
            return NextResponse.json(
                {
                    error:
                        'Young person not found or you do not have access to their file.',
                },
                { status: 404 }
            );
        }

        if (bpError || !blueprint) {
            return NextResponse.json(
                { error: 'Form blueprint not found' },
                { status: 404 }
            );
        }

        if (blueprint.company_id !== yp.company_id) {
            return NextResponse.json(
                { error: 'Form blueprint does not belong to this company' },
                { status: 400 }
            );
        }

        if (blueprint.head !== 'YOUNG_PEOPLE') {
            return NextResponse.json(
                { error: 'This blueprint is not a young people form' },
                { status: 400 }
            );
        }

        if (blueprint.status !== 'PUBLISHED') {
            return NextResponse.json(
                { error: 'You can only start published forms' },
                { status: 400 }
            );
        }

        // ✅ Insert into form_entries with the correct columns
        const { data: inserted, error: insertError } = await supabase
            .from('form_entries')
            .insert({
                blueprint_id: blueprint.id,
                company_id: yp.company_id,
                home_id: yp.home_id,
                head: blueprint.head, // 'YOUNG_PEOPLE'
                subject_young_person_id: yp.id,
                // answers uses default {},
                // status uses default 'DRAFT',
                created_by: user.id,
            })
            .select('id')
            .maybeSingle();

        if (insertError || !inserted) {
            console.error('❌ insert form_entries failed', insertError);
            return NextResponse.json(
                { error: 'Failed to start form' },
                { status: 500 }
            );
        }

        return NextResponse.json(
            {
                entryId: inserted.id,
            },
            { status: 201 }
        );
    } catch (err) {
        console.error('❌ /api/forms/start error', err);
        return NextResponse.json(
            { error: 'Unexpected error' },
            { status: 500 }
        );
    }
}

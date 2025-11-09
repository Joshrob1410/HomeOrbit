// app/api/admin/people/update/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });

type AppLevel = '1_ADMIN' | '2_COMPANY' | '3_MANAGER' | '4_STAFF';

type UpdateBody = {
    user_id: string;
    full_name?: string;
    email?: string;
    password?: string;

    set_company?: { company_id: string }; // ADMIN only

    // Phase 1 compat (bank via bank_memberships)
    set_bank?: { company_id: string; home_id?: string };
    clear_home?: { home_id: string };
    set_home?: { home_id: string; clear_bank_for_company?: string };

    // Position assignment
    set_home_role?: { home_id: string; role: 'STAFF' | 'TEAM_LEADER' | 'MANAGER' | 'DEPUTY_MANAGER' };
    set_manager_homes?: { home_ids: string[] }; // replace set

    // Level assignment (Admin/Company/Manager/Staff)
    set_level?: { level: AppLevel; company_id: string | null };

    // Company positions (Owner, Finance Officer, Site Manager)
    company_positions?: string[];
};

type ProfileRow = { user_id: string; is_admin: boolean | null };
type Home = { id: string; company_id: string };

function json(status: number, body: unknown) {
    return NextResponse.json(body, { status });
}

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

async function getViewer(req: NextRequest) {
    const authz = req.headers.get('authorization');
    const jwt = authz?.startsWith('Bearer ') ? authz.slice(7) : null;

    const { data: auth } = await admin.auth.getUser(jwt ?? '');
    const viewer = auth.user;
    if (!viewer) {
        return {
            viewerId: null as string | null,
            isAdmin: false,
            companyIds: [] as string[],
            managerCompanyIds: [] as string[],
        };
    }

    // Profile (is_admin)
    const profRes = await admin
        .from('profiles')
        .select('user_id,is_admin')
        .eq('user_id', viewer.id)
        .maybeSingle();

    const isAdmin = Boolean((profRes.data as ProfileRow | null)?.is_admin);

    // Company memberships (for company-level perms)
    const cmRes = await admin
        .from('company_memberships')
        .select('company_id,has_company_access')
        .eq('user_id', viewer.id);

    const companyIds = (cmRes.data ?? [])
        .filter((r) => r.has_company_access)
        .map((r) => r.company_id);

    // Manager homes → companies
    const hmRes = await admin
        .from('home_memberships')
        .select('home_id,role')
        .eq('user_id', viewer.id)
        .eq('role', 'MANAGER');

    const homeIds = (hmRes.data ?? []).map((h) => h.home_id);
    let managerCompanyIds: string[] = [];
    if (homeIds.length) {
        const homesRes = await admin.from('homes').select('id,company_id').in('id', homeIds);
        managerCompanyIds = (homesRes.data ?? []).map((h) => h.company_id);
    }

    return { viewerId: viewer.id, isAdmin, companyIds, managerCompanyIds };
}

function canManageCompany(
    isAdmin: boolean,
    companyId: string | null,
    viewerCompanyIds: string[],
    viewerManagerCompanyIds: string[],
): boolean {
    if (!companyId) return isAdmin; // unknown context → only admin
    if (isAdmin) return true;
    if (viewerCompanyIds.includes(companyId)) return true; // company access
    if (viewerManagerCompanyIds.includes(companyId)) return true; // manager in this company
    return false;
}

function capLevelByViewer(viewer: AppLevel): (target: AppLevel) => boolean {
    const rank: Record<AppLevel, number> = { '1_ADMIN': 1, '2_COMPANY': 2, '3_MANAGER': 3, '4_STAFF': 4 };
    return (target) => rank[target] >= rank[viewer];
}

async function getTargetCompanyId(userId: string): Promise<string | null> {
    const row = await admin.from('company_memberships').select('company_id').eq('user_id', userId).maybeSingle();
    return row.data?.company_id ?? null;
}

async function homesByCompany(companyId: string): Promise<Home[]> {
    const res = await admin.from('homes').select('id,company_id').eq('company_id', companyId);
    return res.data ?? [];
}

async function setCompanyForUser(userId: string, newCompanyId: string) {
    // Remove everything tied to the old company, then move company_membership
    const oldCompanyId = await getTargetCompanyId(userId);

    // If already same company, ensure row exists and return
    if (oldCompanyId === newCompanyId) {
        const ensure = await admin
            .from('company_memberships')
            .select('user_id,company_id')
            .eq('user_id', userId)
            .eq('company_id', newCompanyId)
            .maybeSingle();
        if (!ensure.data) {
            await admin.from('company_memberships').insert({ user_id: userId, company_id: newCompanyId });
        }
        return;
    }

    if (oldCompanyId) {
        // Delete positions (old)
        await admin.from('company_membership_positions').delete().eq('user_id', userId).eq('company_id', oldCompanyId);

        // Delete BANK memberships (old)
        await admin.from('bank_memberships').delete().eq('user_id', userId).eq('company_id', oldCompanyId);

        // Delete home memberships under old company
        const oldHomes = await homesByCompany(oldCompanyId);
        const oldHomeIds = oldHomes.map((h) => h.id);
        if (oldHomeIds.length) {
            await admin.from('home_memberships').delete().eq('user_id', userId).in('home_id', oldHomeIds);
        }

        // Remove old company membership
        await admin.from('company_memberships').delete().eq('user_id', userId).eq('company_id', oldCompanyId);
    }

    // Insert new company membership (has_company_access = false by default)
    await admin.from('company_memberships').insert({ user_id: userId, company_id: newCompanyId, has_company_access: false });
}

type HomeRole = NonNullable<UpdateBody['set_home_role']>['role'];

function splitRole(role: HomeRole): {
    role: 'STAFF' | 'MANAGER';
    staff_subrole: 'RESIDENTIAL' | 'TEAM_LEADER' | 'BANK' | null;
    manager_subrole: 'MANAGER' | 'DEPUTY_MANAGER' | null;
} {
    switch (role) {
        case 'STAFF':
            return { role: 'STAFF', staff_subrole: 'RESIDENTIAL', manager_subrole: null };
        case 'TEAM_LEADER':
            return { role: 'STAFF', staff_subrole: 'TEAM_LEADER', manager_subrole: null };
        case 'MANAGER':
            return { role: 'MANAGER', staff_subrole: null, manager_subrole: 'MANAGER' };
        case 'DEPUTY_MANAGER':
            return { role: 'MANAGER', staff_subrole: null, manager_subrole: 'DEPUTY_MANAGER' };
        default:
            // Exhaustive safety (should never hit because HomeRole is a closed union)
            return { role: 'STAFF', staff_subrole: 'RESIDENTIAL', manager_subrole: null };
    }
}

export async function PATCH(req: NextRequest) {
    try {
        const body = (await req.json()) as UpdateBody;
        assert(body && typeof body.user_id === 'string', 'Missing user_id');

        const { viewerId, isAdmin, companyIds, managerCompanyIds } = await getViewer(req);
        if (!viewerId) return json(401, { error: 'Not authenticated' });

        // Determine the company context we’re editing in
        const currentCompanyId = await getTargetCompanyId(body.user_id);
        const requestedCompanyId = body.set_company?.company_id ?? body.set_level?.company_id ?? currentCompanyId;

        // Permission gate: who can edit this target?
        const canManage = canManageCompany(isAdmin, requestedCompanyId, companyIds, managerCompanyIds);
        if (!canManage) return json(403, { error: 'You do not have permission to manage this user in that company.' });

        // Additional rank caps: Company can’t change someone’s company; Manager can’t assign above Manager, etc.
        const viewerLevel: AppLevel = isAdmin
            ? '1_ADMIN'
            : companyIds.includes(requestedCompanyId ?? '')
                ? '2_COMPANY'
                : '3_MANAGER';
        const withinCap = capLevelByViewer(viewerLevel);

        // 1) Identity edits
        if (typeof body.full_name === 'string') {
            await admin.from('profiles').update({ full_name: body.full_name }).eq('user_id', body.user_id);
        }
        if (typeof body.email === 'string' && body.email.trim()) {
            // Allow Admin & Company; Managers cannot change email
            if (viewerLevel === '3_MANAGER') return json(403, { error: 'Managers cannot change email addresses.' });
            await admin.auth.admin.updateUserById(body.user_id, { email: body.email.trim() });
        }
        if (typeof body.password === 'string' && body.password.length >= 8) {
            if (viewerLevel === '3_MANAGER') return json(403, { error: 'Managers cannot set passwords.' });
            await admin.auth.admin.updateUserById(body.user_id, { password: body.password });
        }

        // 2) Company transfer (ADMIN only)
        if (body.set_company?.company_id) {
            if (viewerLevel !== '1_ADMIN') return json(403, { error: 'Only admins can change a user’s company.' });
            await setCompanyForUser(body.user_id, body.set_company.company_id);
        }

        // 3) Bank / Home placement
        if (body.set_bank) {
            // Ensure this is within the same (requested) company
            const targetCompany = await getTargetCompanyId(body.user_id);
            if (targetCompany !== body.set_bank.company_id) {
                return json(400, { error: 'Bank membership must match the user’s company.' });
            }
            await admin
                .from('bank_memberships')
                .upsert(
                    { user_id: body.user_id, company_id: body.set_bank.company_id },
                    { onConflict: 'user_id,company_id', ignoreDuplicates: false },
                );
            // No need to clear any home here; UI will clear home when BANK is chosen.
        }

        if (body.clear_home?.home_id) {
            await admin.from('home_memberships').delete().eq('user_id', body.user_id).eq('home_id', body.clear_home.home_id);
        }

        if (body.set_home) {
            // Optional: clear bank flag for this company when setting a fixed home
            const clearFor = body.set_home.clear_bank_for_company;
            if (clearFor) {
                await admin.from('bank_memberships').delete().eq('user_id', body.user_id).eq('company_id', clearFor);
            }
            await admin
                .from('home_memberships')
                .upsert(
                    { user_id: body.user_id, home_id: body.set_home.home_id, role: 'STAFF', staff_subrole: 'RESIDENTIAL', manager_subrole: null },
                    { onConflict: 'home_id,user_id', ignoreDuplicates: false },
                );
        }

        if (body.set_home_role) {
            const { role, staff_subrole, manager_subrole } = splitRole(body.set_home_role.role);
            await admin
                .from('home_memberships')
                .upsert(
                    { user_id: body.user_id, home_id: body.set_home_role.home_id, role, staff_subrole, manager_subrole },
                    { onConflict: 'home_id,user_id', ignoreDuplicates: false },
                );
        }

        if (body.set_manager_homes) {
            // Replace set for all homes in the user’s company
            const companyId = requestedCompanyId ?? (await getTargetCompanyId(body.user_id));
            assert(companyId, 'Company context missing for manager homes update');

            const allHomes = await homesByCompany(companyId);
            const allowedHomeIds = new Set(allHomes.map((h) => h.id));
            const desired = (body.set_manager_homes.home_ids ?? []).filter((h) => allowedHomeIds.has(h));

            // Existing manager homes
            const current = await admin
                .from('home_memberships')
                .select('home_id')
                .eq('user_id', body.user_id)
                .eq('role', 'MANAGER');

            const currentIds = new Set((current.data ?? []).map((r) => r.home_id as string));

            // Inserts for new ones
            const toInsert = desired
                .filter((id) => !currentIds.has(id))
                .map((id) => ({
                    user_id: body.user_id,
                    home_id: id,
                    role: 'MANAGER' as const,
                    staff_subrole: null,
                    manager_subrole: 'MANAGER' as const,
                }));
            if (toInsert.length) await admin.from('home_memberships').insert(toInsert);

            // Deletes for removed ones
            const toDelete = [...currentIds].filter((id) => !desired.includes(id));
            if (toDelete.length) {
                await admin.from('home_memberships').delete().eq('user_id', body.user_id).in('home_id', toDelete);
            }
        }

        // 4) Level assignment
        if (body.set_level) {
            const { level, company_id } = body.set_level;

            // Managers cannot assign above Manager; Companies cannot assign Admin
            if (!withinCap(level)) {
                return json(403, { error: 'You are not allowed to assign that role.' });
            }

            if (level === '1_ADMIN') {
                if (viewerLevel !== '1_ADMIN') return json(403, { error: 'Only admins can set admin level.' });
                await admin.from('profiles').update({ is_admin: true }).eq('user_id', body.user_id);
            } else {
                // Ensure admin flag is off if demoting
                await admin.from('profiles').update({ is_admin: false }).eq('user_id', body.user_id);
            }

            if (level === '2_COMPANY') {
                assert(company_id, 'company_id required when setting company level');
                await admin
                    .from('company_memberships')
                    .upsert(
                        { user_id: body.user_id, company_id, has_company_access: true },
                        { onConflict: 'user_id,company_id', ignoreDuplicates: false },
                    );
            } else {
                // Remove company access flag if present (stay member of the company)
                const companyId = requestedCompanyId ?? (await getTargetCompanyId(body.user_id));
                if (companyId) {
                    await admin
                        .from('company_memberships')
                        .update({ has_company_access: false })
                        .eq('user_id', body.user_id)
                        .eq('company_id', companyId);
                }
            }
        }

        // 5) Company positions (replace-set)
        if (Array.isArray(body.company_positions)) {
            const companyId = requestedCompanyId ?? (await getTargetCompanyId(body.user_id));
            assert(companyId, 'company_id context required to set company positions');

            await admin.from('company_membership_positions').delete().eq('user_id', body.user_id).eq('company_id', companyId);

            if (body.company_positions.length) {
                const rows = body.company_positions.map((pos) => ({
                    user_id: body.user_id,
                    company_id: companyId,
                    position: pos,
                }));
                await admin.from('company_membership_positions').insert(rows);
            }
        }

        return json(200, { ok: true });
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed';
        return json(400, { error: msg });
    }
}

// app/(app)/form-builder/page.tsx
'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/supabase/client';
import { getEffectiveLevel, type AppLevel } from '@/supabase/roles';

/** ========= Branding ========= */
const BRAND_GRADIENT =
    'linear-gradient(135deg, #7C3AED 0%, #6366F1 50%, #3B82F6 100%)';

type Level = AppLevel;

type ViewState =
    | { status: 'loading' }
    | { status: 'signed_out' }
    | {
        status: 'ready';
        level: Level;
        companies: { id: string; name: string }[];
        selectedCompanyId: string | null;
    };

type HeadKey = 'YOUNG_PEOPLE' | 'CARS' | 'HOME';

type FormStatus = 'DRAFT' | 'PUBLISHED';

type FormSummary = {
    id: string;
    company_id: string;
    head: HeadKey;
    name: string;
    status: FormStatus;
    form_type: 'FIXED' | 'ADJUSTABLE';
    updated_at: string | null;
};

const HEADS: {
    key: HeadKey;
    label: string;
    icon: string;
    description: string;
}[] = [
        {
            key: 'YOUNG_PEOPLE',
            label: 'Young People',
            icon: '🧍',
            description: 'Per-young person logs like daily summaries or incidents.',
        },
        {
            key: 'CARS',
            label: 'Cars',
            icon: '🚗',
            description: 'Vehicle checks, mileage logs and maintenance forms.',
        },
        {
            key: 'HOME',
            label: 'Home',
            icon: '🏠',
            description: 'House-level checks, audits and night routines.',
        },
    ];

type Category = {
    id: string;
    company_id: string;
    name: string;
    description: string | null;
    head: HeadKey;
    is_active: boolean;
    order_index: number | null;
};

export default function Page() {
    const [view, setView] = useState<ViewState>({ status: 'loading' });

    // Category UI state
    const [activeHead, setActiveHead] = useState<HeadKey>('YOUNG_PEOPLE');
    const [categories, setCategories] = useState<Category[]>([]);
    const [loadingCats, setLoadingCats] = useState(false);

    // Edit category state
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [editDescription, setEditDescription] = useState('');
    const [editHead, setEditHead] = useState<HeadKey>('YOUNG_PEOPLE');
    const [savingEdit, setSavingEdit] = useState(false);

    // Delete confirmation state
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    // Forms under current head
    const [forms, setForms] = useState<FormSummary[]>([]);
    const [loadingForms, setLoadingForms] = useState(false);

    /** ========= Load session + level + companies (admin only) ========= */
    useEffect(() => {
        let mounted = true;

        (async () => {
            const { data: s } = await supabase.auth.getSession();
            const session = s?.session;
            if (!session) {
                if (mounted) setView({ status: 'signed_out' });
                return;
            }

            const lvl = await getEffectiveLevel();

            if (lvl !== '1_ADMIN') {
                if (mounted) {
                    setView({
                        status: 'ready',
                        level: lvl,
                        companies: [],
                        selectedCompanyId: null,
                    });
                }
                return;
            }

            const { data: companies, error } = await supabase
                .from('companies')
                .select('id,name')
                .order('name');

            if (error) {
                console.error('❌ load companies failed', error);
            }

            if (mounted) {
                const list = companies ?? [];
                setView({
                    status: 'ready',
                    level: lvl,
                    companies: list,
                    selectedCompanyId: list[0]?.id ?? null,
                });
            }
        })();

        return () => {
            mounted = false;
        };
    }, []);

    const isAdmin = view.status === 'ready' && view.level === '1_ADMIN';
    const selectedCompanyId =
        view.status === 'ready' ? view.selectedCompanyId : null;

    /** ========= Load categories for selected company ========= */
    useEffect(() => {
        if (!isAdmin || !selectedCompanyId) {
            setCategories([]);
            return;
        }

        let cancelled = false;
        setLoadingCats(true);

        (async () => {
            const { data, error } = await supabase
                .from('form_categories')
                .select(
                    'id, company_id, name, description, head, is_active, order_index'
                )
                .eq('company_id', selectedCompanyId)
                .order('head', { ascending: true })
                .order('order_index', { ascending: true })
                .order('name', { ascending: true });

            if (cancelled) return;

            if (error) {
                console.error('❌ load form_categories failed', error);
                setCategories([]);
            } else {
                setCategories((data ?? []) as Category[]);
            }
            setLoadingCats(false);
        })();

        return () => {
            cancelled = true;
        };
    }, [isAdmin, selectedCompanyId]);

    /** ========= Load forms for selected company + head ========= */
    useEffect(() => {
        if (!isAdmin || !selectedCompanyId) {
            setForms([]);
            return;
        }

        let cancelled = false;
        setLoadingForms(true);

        (async () => {
            const { data, error } = await supabase
                .from('form_blueprints')
                .select(
                    'id, company_id, head, name, status, form_type, updated_at'
                )
                .eq('company_id', selectedCompanyId)
                .eq('head', activeHead)
                .order('status', { ascending: true }) // drafts first
                .order('name', { ascending: true });

            if (cancelled) return;

            if (error) {
                console.error('❌ load form_blueprints failed', error);
                setForms([]);
            } else {
                setForms((data ?? []) as FormSummary[]);
            }
            setLoadingForms(false);
        })();

        return () => {
            cancelled = true;
        };
    }, [isAdmin, selectedCompanyId, activeHead]);

    const categoriesForHead = useMemo(
        () =>
            categories.filter(
                (c) => c.head === activeHead && c.is_active !== false
            ),
        [categories, activeHead]
    );

    /** ========= Start editing ========= */
    const startEdit = (cat: Category) => {
        setPendingDeleteId(null);
        setEditingId(cat.id);
        setEditName(cat.name);
        setEditDescription(cat.description ?? '');
        setEditHead(cat.head);
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditName('');
        setEditDescription('');
        setEditHead(activeHead);
    };

    const handleSaveEdit = async () => {
        if (!isAdmin || !selectedCompanyId || !editingId) return;

        const name = editName.trim();
        const description = editDescription.trim();

        if (!name) return;

        setSavingEdit(true);

        const { error } = await supabase
            .from('form_categories')
            .update({
                name,
                description: description || null,
                head: editHead,
            })
            .eq('id', editingId)
            .eq('company_id', selectedCompanyId);

        setSavingEdit(false);

        if (error) {
            console.error('❌ update form_categories failed', error);
            return;
        }

        setCategories((prev) =>
            prev.map((c) =>
                c.id === editingId
                    ? {
                        ...c,
                        name,
                        description: description || null,
                        head: editHead,
                    }
                    : c
            )
        );
        setEditingId(null);
        setEditDescription('');
    };

    /** ========= Delete category (inline confirmation) ========= */
    const handleDeleteClick = (cat: Category) => {
        if (pendingDeleteId === cat.id) return;
        setEditingId(null);
        setPendingDeleteId(cat.id);
    };

    const handleCancelDelete = () => {
        setPendingDeleteId(null);
        setDeletingId(null);
    };

    const handleConfirmDelete = async (cat: Category) => {
        if (!isAdmin || !selectedCompanyId) return;
        setDeletingId(cat.id);

        const { error } = await supabase
            .from('form_categories')
            .delete()
            .eq('id', cat.id)
            .eq('company_id', selectedCompanyId);

        if (error) {
            console.error('❌ delete form_categories failed', error);
            setDeletingId(null);
            return;
        }

        setCategories((prev) => prev.filter((c) => c.id !== cat.id));
        setPendingDeleteId(null);
        setDeletingId(null);
    };

    /** ========= Guards ========= */
    if (view.status === 'loading') {
        return (
            <div className="p-4 md:p-6" style={{ color: 'var(--sub)' }}>
                Loading form builder…
            </div>
        );
    }

    if (view.status === 'signed_out') {
        return null;
    }

    if (!isAdmin) {
        return (
            <div className="p-4 md:p-6">
                <h1
                    className="text-xl md:text-2xl font-semibold mb-2"
                    style={{ color: 'var(--ink)' }}
                >
                    Form Builder
                </h1>
                <p className="text-sm" style={{ color: 'var(--sub)' }}>
                    Only admins can access the Form Builder while it is in
                    development.
                </p>
            </div>
        );
    }

    /** ========= Admin UI ========= */
    return (
        <div className="p-4 md:p-6 space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
                <div className="space-y-1">
                    <h1
                        className="text-xl md:text-2xl font-semibold tracking-tight"
                        style={{ color: 'var(--ink)' }}
                    >
                        Forms & Categories
                    </h1>
                    <p className="text-sm" style={{ color: 'var(--sub)' }}>
                        Use categories to organise the forms you’ll design in the
                        full-screen Form Builder.
                    </p>
                </div>

                {/* Fancy "Enter Form Builder" CTA */}
                <Link
                    href={
                        selectedCompanyId
                            ? `/form-builder/workspace?companyId=${selectedCompanyId}`
                            : '/form-builder/workspace'
                    }
                    className="group rounded-xl p-[1px] shadow-sm hover:shadow-md transition-transform hover:-translate-y-[1px]"
                    style={{ background: BRAND_GRADIENT }}
                >
                    <div
                        className="flex items-center gap-3 rounded-[0.70rem] px-3 py-2"
                        style={{ background: 'var(--panel-bg)' }}
                    >
                        <div className="flex items-center gap-2">
                            <span className="text-lg">✨</span>
                            <span
                                className="text-sm font-semibold"
                                style={{ color: 'var(--ink)' }}
                            >
                                Enter Form Builder
                            </span>
                        </div>
                        <span
                            className="text-xs group-hover:translate-x-[2px] transition-transform"
                            style={{ color: 'var(--sub)' }}
                        >
                            Full-screen form designer →
                        </span>
                    </div>
                </Link>
            </div>

            {/* Company selector */}
            <div className="max-w-xs">
                <label
                    className="block text-xs mb-1"
                    style={{ color: 'var(--sub)' }}
                >
                    Company
                </label>
                <select
                    className="w-full rounded-md px-2 py-2 text-sm ring-1"
                    style={{
                        background: 'var(--nav-item-bg)',
                        color: 'var(--ink)',
                        borderColor: 'var(--ring)',
                    }}
                    value={view.selectedCompanyId ?? ''}
                    onChange={(e) => {
                        const id = e.target.value || null;
                        setView((v) =>
                            v.status !== 'ready'
                                ? v
                                : { ...v, selectedCompanyId: id }
                        );
                        setEditingId(null);
                        setPendingDeleteId(null);
                    }}
                >
                    {view.companies.map((c) => (
                        <option key={c.id} value={c.id}>
                            {c.name}
                        </option>
                    ))}
                </select>
            </div>

            {/* Heads as cards */}
            <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {HEADS.map((h) => {
                        const isActive = activeHead === h.key;
                        return (
                            <HeadCard
                                key={h.key}
                                head={h}
                                active={isActive}
                                onClick={() => {
                                    setActiveHead(h.key);
                                    cancelEdit();
                                    setPendingDeleteId(null);
                                }}
                            />
                        );
                    })}
                </div>
                <p className="text-xs" style={{ color: 'var(--sub)' }}>
                    Click a head to see its categories and forms. Categories are used
                    to group forms inside the Form Builder.
                </p>
            </div>

            {/* Categories list */}
            <div
                className="rounded-xl ring-1 overflow-hidden"
                style={{
                    background: 'var(--card-grad)',
                    borderColor: 'var(--ring)',
                }}
            >
                <div
                    className="px-3 py-2 flex items-center justify-between"
                    style={{
                        borderBottom: '1px solid var(--ring)',
                        background: 'var(--nav-item-bg)',
                    }}
                >
                    <div
                        className="font-medium text-sm"
                        style={{ color: 'var(--ink)' }}
                    >
                        {HEADS.find((h) => h.key === activeHead)?.label ||
                            'Categories'}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--sub)' }}>
                        {loadingCats
                            ? 'Loading…'
                            : `${categoriesForHead.length} categor${categoriesForHead.length === 1 ? 'y' : 'ies'
                            }`}
                    </div>
                </div>

                {loadingCats ? (
                    <div className="p-4 text-sm" style={{ color: 'var(--sub)' }}>
                        Loading categories…
                    </div>
                ) : categoriesForHead.length === 0 ? (
                    <div className="p-4 text-sm" style={{ color: 'var(--sub)' }}>
                        No categories yet under this head.
                    </div>
                ) : (
                    <ul
                        className="divide-y"
                        style={{ borderColor: 'var(--ring)' }}
                    >
                        {categoriesForHead.map((cat) => {
                            const isEditing = editingId === cat.id;
                            const isPendingDelete = pendingDeleteId === cat.id;
                            const isDeleting = deletingId === cat.id;

                            return (
                                <li
                                    key={cat.id}
                                    className="px-3 py-3"
                                    style={{ background: 'var(--nav-item-bg)' }}
                                >
                                    {isEditing ? (
                                        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4">
                                            <div className="flex-1 space-y-2">
                                                <input
                                                    type="text"
                                                    className="w-full rounded-md px-2 py-2 text-sm ring-1"
                                                    style={{
                                                        background:
                                                            'var(--panel-bg)',
                                                        color: 'var(--ink)',
                                                        borderColor:
                                                            'var(--ring)',
                                                    }}
                                                    value={editName}
                                                    onChange={(e) =>
                                                        setEditName(
                                                            e.target.value
                                                        )
                                                    }
                                                />
                                                <textarea
                                                    rows={2}
                                                    className="w-full rounded-md px-2 py-2 text-xs ring-1 resize-none"
                                                    style={{
                                                        background:
                                                            'var(--panel-bg)',
                                                        color: 'var(--ink)',
                                                        borderColor:
                                                            'var(--ring)',
                                                    }}
                                                    value={editDescription}
                                                    onChange={(e) =>
                                                        setEditDescription(
                                                            e.target.value
                                                        )
                                                    }
                                                    placeholder="Short description (optional)"
                                                />
                                                <div>
                                                    <HeadSelector
                                                        value={editHead}
                                                        onChange={setEditHead}
                                                        size="sm"
                                                    />
                                                </div>
                                            </div>
                                            <div className="flex gap-2 mt-2 md:mt-0">
                                                <button
                                                    type="button"
                                                    onClick={
                                                        savingEdit
                                                            ? undefined
                                                            : handleSaveEdit
                                                    }
                                                    disabled={savingEdit}
                                                    className="px-3 py-1.5 text-sm rounded-md"
                                                    style={{
                                                        background:
                                                            BRAND_GRADIENT,
                                                        color: '#FFFFFF',
                                                        opacity: savingEdit
                                                            ? 0.7
                                                            : 1,
                                                    }}
                                                >
                                                    {savingEdit
                                                        ? 'Saving…'
                                                        : 'Save'}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={
                                                        savingEdit
                                                            ? undefined
                                                            : cancelEdit
                                                    }
                                                    className="px-3 py-1.5 text-sm rounded-md ring-1"
                                                    style={{
                                                        background:
                                                            'var(--panel-bg)',
                                                        color: 'var(--ink)',
                                                        borderColor:
                                                            'var(--ring)',
                                                    }}
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4">
                                            <div>
                                                <div
                                                    className="text-sm font-medium"
                                                    style={{
                                                        color: 'var(--ink)',
                                                    }}
                                                >
                                                    {cat.name}
                                                </div>
                                                {cat.description && (
                                                    <p
                                                        className="text-xs mt-0.5"
                                                        style={{
                                                            color: 'var(--sub)',
                                                        }}
                                                    >
                                                        {cat.description}
                                                    </p>
                                                )}
                                            </div>
                                            <div className="flex gap-2 mt-1 md:mt-0">
                                                {!isPendingDelete ? (
                                                    <>
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                startEdit(cat)
                                                            }
                                                            className="px-3 py-1.5 text-sm rounded-md ring-1"
                                                            style={{
                                                                background:
                                                                    'var(--panel-bg)',
                                                                color: 'var(--ink)',
                                                                borderColor:
                                                                    'var(--ring)',
                                                            }}
                                                        >
                                                            Edit
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                handleDeleteClick(
                                                                    cat
                                                                )
                                                            }
                                                            className="px-3 py-1.5 text-sm rounded-md ring-1"
                                                            style={{
                                                                background:
                                                                    'var(--panel-bg)',
                                                                color: '#DC2626',
                                                                borderColor:
                                                                    'var(--ring)',
                                                            }}
                                                        >
                                                            Delete
                                                        </button>
                                                    </>
                                                ) : (
                                                    <>
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                handleConfirmDelete(
                                                                    cat
                                                                )
                                                            }
                                                            disabled={isDeleting}
                                                            className="px-3 py-1.5 text-sm rounded-md"
                                                            style={{
                                                                background:
                                                                    '#DC2626',
                                                                color: '#FFFFFF',
                                                                opacity:
                                                                    isDeleting
                                                                        ? 0.7
                                                                        : 1,
                                                            }}
                                                        >
                                                            {isDeleting
                                                                ? 'Deleting…'
                                                                : 'Confirm delete'}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={
                                                                handleCancelDelete
                                                            }
                                                            disabled={isDeleting}
                                                            className="px-3 py-1.5 text-sm rounded-md ring-1"
                                                            style={{
                                                                background:
                                                                    'var(--panel-bg)',
                                                                color: 'var(--ink)',
                                                                borderColor:
                                                                    'var(--ring)',
                                                            }}
                                                        >
                                                            Cancel
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            {/* Forms list for this head */}
            <div
                className="rounded-xl ring-1 overflow-hidden"
                style={{
                    background: 'var(--card-grad)',
                    borderColor: 'var(--ring)',
                }}
            >
                <div
                    className="px-3 py-2 flex items-center justify-between"
                    style={{
                        borderBottom: '1px solid var(--ring)',
                        background: 'var(--nav-item-bg)',
                    }}
                >
                    <div
                        className="font-medium text-sm"
                        style={{ color: 'var(--ink)' }}
                    >
                        Forms under{' '}
                        {HEADS.find((h) => h.key === activeHead)?.label ??
                            'this head'}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--sub)' }}>
                        {loadingForms
                            ? 'Loading…'
                            : `${forms.length} form${forms.length === 1 ? '' : 's'
                            }`}
                    </div>
                </div>

                {loadingForms ? (
                    <div className="p-4 text-sm" style={{ color: 'var(--sub)' }}>
                        Loading forms…
                    </div>
                ) : forms.length === 0 ? (
                    <div className="p-4 text-sm" style={{ color: 'var(--sub)' }}>
                        No forms yet under this head. Use the Form Builder to
                        create one.
                    </div>
                ) : (
                    <ul
                        className="divide-y"
                        style={{ borderColor: 'var(--ring)' }}
                    >
                        {forms.map((form) => (
                            <li
                                key={form.id}
                                className="px-3 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2"
                                style={{ background: 'var(--nav-item-bg)' }}
                            >
                                <div className="space-y-1">
                                    <div
                                        className="text-sm font-medium"
                                        style={{ color: 'var(--ink)' }}
                                    >
                                        {form.name}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                        <span
                                            className="inline-flex items-center rounded-full px-2 py-[2px] uppercase tracking-wide"
                                            style={{
                                                background:
                                                    form.status === 'PUBLISHED'
                                                        ? 'rgba(34,197,94,0.16)'
                                                        : 'rgba(251,191,36,0.16)',
                                                color:
                                                    form.status === 'PUBLISHED'
                                                        ? '#4ADE80'
                                                        : '#FBBF24',
                                            }}
                                        >
                                            {form.status === 'PUBLISHED'
                                                ? 'Published'
                                                : 'Draft'}
                                        </span>
                                        <span
                                            className="inline-flex items-center rounded-full px-2 py-[2px]"
                                            style={{
                                                background:
                                                    'rgba(148,163,184,0.16)',
                                                color: 'var(--sub)',
                                            }}
                                        >
                                            {form.form_type === 'FIXED'
                                                ? 'Fixed across company'
                                                : 'Adjustable per home'}
                                        </span>
                                        {form.updated_at && (
                                            <span
                                                className="inline-flex items-center rounded-full px-2 py-[2px]"
                                                style={{
                                                    background: 'transparent',
                                                    color: 'var(--sub)',
                                                }}
                                            >
                                                Updated{' '}
                                                {new Date(
                                                    form.updated_at
                                                ).toLocaleDateString()}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <Link
                                        href={`/form-builder/workspace?formId=${form.id}`}
                                        className="px-3 py-1.5 text-sm rounded-md ring-1"
                                        style={{
                                            background: 'var(--panel-bg)',
                                            color: 'var(--ink)',
                                            borderColor: 'var(--ring)',
                                        }}
                                    >
                                        Open in builder
                                    </Link>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {/* Orbit-friendly select tweaks (like other pages) */}
            <style jsx global>{`
                [data-orbit='1'] select,
                [data-orbit='1'] input[type='text'],
                [data-orbit='1'] textarea {
                    color-scheme: dark;
                    background: var(--nav-item-bg);
                    color: var(--ink);
                    border-color: var(--ring);
                }
                [data-orbit='1'] select option {
                    color: var(--ink);
                    background-color: #0b1221;
                }
                @-moz-document url-prefix() {
                    [data-orbit='1'] select option {
                        background-color: #0b1221;
                    }
                }
                [data-orbit='1'] select:where(:not(:disabled)) {
                    opacity: 1;
                }
            `}</style>
        </div>
    );
}

/** ========= Head selector (shared between edit UIs) ========= */
function HeadSelector({
    value,
    onChange,
    size = 'md',
}: {
    value: HeadKey;
    onChange: (h: HeadKey) => void;
    size?: 'sm' | 'md';
}) {
    const base =
        size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm';

    return (
        <div className="inline-flex rounded-lg overflow-hidden ring-1">
            {HEADS.map((h) => {
                const isActive = value === h.key;
                return (
                    <button
                        key={h.key}
                        type="button"
                        onClick={() => onChange(h.key)}
                        className={`${base} transition-transform hover:-translate-y-[0.5px]`}
                        style={
                            isActive
                                ? {
                                    background: BRAND_GRADIENT,
                                    color: '#FFFFFF',
                                }
                                : {
                                    background: 'var(--nav-item-bg)',
                                    color: 'var(--ink)',
                                }
                        }
                    >
                        {h.label}
                    </button>
                );
            })}
        </div>
    );
}

/** ========= Head card for top-level selector ========= */
function HeadCard({
    head,
    active,
    onClick,
}: {
    head: {
        key: HeadKey;
        label: string;
        icon: string;
        description: string;
    };
    active: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="group relative flex flex-col items-start gap-2 rounded-xl p-3 md:p-4 text-left ring-1 transition-transform hover:-translate-y-[2px] hover:shadow-md"
            style={{
                background: active ? 'var(--card-grad)' : 'var(--nav-item-bg)',
                borderColor: active ? 'var(--ring-strong)' : 'var(--ring)',
            }}
        >
            <div className="flex items-center gap-3">
                <div
                    className="flex h-10 w-10 items-center justify-center rounded-full text-lg md:text-xl"
                    style={{
                        background: 'rgba(124, 58, 237, 0.12)',
                        color: 'var(--ink)',
                    }}
                >
                    <span className="translate-y-[1px]">{head.icon}</span>
                </div>
                <div>
                    <div
                        className="text-sm md:text-base font-semibold"
                        style={{ color: 'var(--ink)' }}
                    >
                        {head.label}
                    </div>
                    <p
                        className="text-[11px] md:text-xs"
                        style={{ color: 'var(--sub)' }}
                    >
                        {head.description}
                    </p>
                </div>
            </div>
            {active && (
                <div
                    className="absolute inset-x-2 bottom-1 h-0.5 rounded-full"
                    style={{ background: BRAND_GRADIENT }}
                />
            )}
        </button>
    );
}

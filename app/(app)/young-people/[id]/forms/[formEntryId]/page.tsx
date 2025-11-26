// app/(app)/young-people/[id]/forms/[formEntryId]/page.tsx
'use client';

import Link from 'next/link';
import { use, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/supabase/client';
import { getEffectiveLevel, type AppLevel } from '@/supabase/roles';

type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json }
    | Json[];

/** ========= Branding ========= */
const BRAND_GRADIENT =
    'linear-gradient(135deg, #7C3AED 0%, #6366F1 50%, #3B82F6 100%)';

type Level = AppLevel;

type HeadKey = 'YOUNG_PEOPLE' | 'CARS' | 'HOME';
type FormStatus = 'DRAFT' | 'PUBLISHED';
type FormType = 'FIXED' | 'ADJUSTABLE';

type YoungPerson = {
    id: string;
    full_name: string;
    company_id: string;
    home_id: string | null;
    date_of_birth: string | null;
};

type FormEntryStatus = 'DRAFT' | 'SUBMITTED' | 'LOCKED' | 'CANCELLED';

type FormEntry = {
    id: string;
    company_id: string;
    home_id: string | null;
    head: HeadKey;
    subject_young_person_id: string | null;
    blueprint_id: string;
    status: FormEntryStatus;
    answers: Json;
    created_at: string;
    updated_at: string;
    submitted_at: string | null;
};

type FieldType =
    | 'HEADER'
    | 'PARAGRAPH'
    | 'TEXT'
    | 'TEXTAREA'
    | 'NUMBER'
    | 'DATE'
    | 'TIME'
    | 'SINGLE_SELECT'
    | 'MULTI_SELECT';

type FormBlueprint = {
    id: string;
    company_id: string;
    head: HeadKey;
    name: string;
    status: FormStatus;
    form_type: FormType;
    definition: Json; // <- definition JSON from DB
    updated_at: string | null;
};

type ViewState =
    | { status: 'loading' }
    | { status: 'signed_out' }
    | { status: 'not_found' }
    | {
        status: 'ready';
        level: Level;
        youngPerson: YoungPerson;
        entry: FormEntry;
        blueprint: FormBlueprint;
    };

/** ========= Runtime helpers ========= */

type AnswersObject = { [key: string]: Json };

type RuntimeField = {
    key: string; // key/id used for answers
    type: FieldType;
    label?: string;
    helpText?: string;
    required: boolean;
    options?: { value: string; label: string }[];
    raw: Record<string, unknown>; // full raw JSON for future use
};

const ALLOWED_TYPES: FieldType[] = [
    'HEADER',
    'PARAGRAPH',
    'TEXT',
    'TEXTAREA',
    'NUMBER',
    'DATE',
    'TIME',
    'SINGLE_SELECT',
    'MULTI_SELECT',
];

function toFieldType(value: unknown): FieldType {
    if (typeof value !== 'string') return 'TEXT';
    const upper = value.toUpperCase();
    if (ALLOWED_TYPES.includes(upper as FieldType)) {
        return upper as FieldType;
    }
    return 'TEXT';
}

function normaliseDefinition(definition: Json): RuntimeField[] {
    if (
        !definition ||
        typeof definition !== 'object' ||
        Array.isArray(definition)
    ) {
        return [];
    }

    const root = definition as { [key: string]: unknown };
    const fieldsRaw = root.fields;

    if (!Array.isArray(fieldsRaw)) return [];

    const result: RuntimeField[] = [];

    for (const raw of fieldsRaw) {
        if (!raw || typeof raw !== 'object') continue;
        const f = raw as Record<string, unknown>;

        const type = toFieldType(f.type);
        // Try to find a stable key: prefer "key", then "id", then "name"
        const keyCandidate =
            typeof f.key === 'string'
                ? f.key
                : typeof f.id === 'string'
                    ? f.id
                    : typeof f.name === 'string'
                        ? f.name
                        : null;

        // For static blocks (header/paragraph) we can still invent a key
        const isStatic = type === 'HEADER' || type === 'PARAGRAPH';

        const finalKey =
            keyCandidate ??
            (isStatic
                ? `static-${type.toLowerCase()}-${Math.random()
                    .toString(36)
                    .slice(2)}`
                : null);

        if (!finalKey) continue;

        const label =
            typeof f.label === 'string'
                ? f.label
                : typeof f.text === 'string'
                    ? f.text
                    : undefined;
        const helpText =
            typeof f.helpText === 'string' ? f.helpText : undefined;
        const required = Boolean(f.required);

        let options: { value: string; label: string }[] | undefined;
        if (
            type === 'SINGLE_SELECT' ||
            type === 'MULTI_SELECT'
        ) {
            const rawOpts = f.options;
            if (Array.isArray(rawOpts)) {
                options = rawOpts
                    .map((o) => {
                        if (!o || typeof o !== 'object') return null;
                        const ro = o as Record<string, unknown>;
                        const labelOpt =
                            typeof ro.label === 'string'
                                ? ro.label
                                : undefined;
                        const valueOpt =
                            typeof ro.value === 'string'
                                ? ro.value
                                : typeof ro.id === 'string'
                                    ? ro.id
                                    : labelOpt;
                        if (!valueOpt || !labelOpt) return null;
                        return { value: valueOpt, label: labelOpt };
                    })
                    .filter(
                        (
                            x,
                        ): x is { value: string; label: string } =>
                            x !== null,
                    );
            }
        }

        result.push({
            key: finalKey,
            type,
            label,
            helpText,
            required,
            options,
            raw: f,
        });
    }

    return result;
}

/** ========= Utility ========= */

function formatDateTime(dateStr: string | null): string | null {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return null;

    return (
        d.toLocaleDateString() +
        ' ' +
        d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    );
}

function calculateAge(dateStr: string | null): string | null {
    if (!dateStr) return null;
    const dob = new Date(dateStr);
    if (Number.isNaN(dob.getTime())) return null;

    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const m = today.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
        age--;
    }
    if (age < 0 || age > 120) return null;
    return `${age} year${age === 1 ? '' : 's'}`;
}

function prettyEntryStatus(status: FormEntryStatus): string {
    switch (status) {
        case 'DRAFT':
            return 'Draft (in progress)';
        case 'SUBMITTED':
            return 'Submitted';
        case 'LOCKED':
            return 'Locked';
        case 'CANCELLED':
            return 'Cancelled';
        default:
            return status;
    }
}

/** ========= Page ========= */

export default function Page({
    params,
}: {
    params: Promise<{ id: string; formEntryId: string }>;
}) {
    // ✅ New Next.js 15-style params: unwrap the Promise
    const { id, formEntryId } = use(params);

    const [view, setView] = useState<ViewState>({ status: 'loading' });
    const [answers, setAnswers] = useState<AnswersObject>({});

    useEffect(() => {
        let cancelled = false;

        (async () => {
            const { data: s } = await supabase.auth.getSession();
            const session = s?.session;

            if (!session) {
                if (!cancelled) setView({ status: 'signed_out' });
                return;
            }

            const lvl = await getEffectiveLevel();

            // 1) Load the form entry (RLS enforced)
            const { data: entry, error: entryError } = await supabase
                .from('form_entries')
                .select(
                    'id, company_id, home_id, head, subject_young_person_id, blueprint_id, status, answers, created_at, updated_at, submitted_at',
                )
                .eq('id', formEntryId)
                .maybeSingle();

            if (cancelled) return;

            if (
                entryError ||
                !entry ||
                entry.head !== 'YOUNG_PEOPLE' ||
                entry.subject_young_person_id !== id
            ) {
                console.error('❌ load form_entry failed', entryError);
                setView({ status: 'not_found' });
                return;
            }

            const subjectId = entry.subject_young_person_id;

            // 2) Load the young person + blueprint (including definition)
            const [ypRes, blueprintRes] = await Promise.all([
                supabase
                    .from('young_people')
                    .select(
                        'id, full_name, company_id, home_id, date_of_birth',
                    )
                    .eq('id', subjectId)
                    .maybeSingle(),
                supabase
                    .from('form_blueprints')
                    .select(
                        'id, company_id, head, name, status, form_type, definition, updated_at',
                    )
                    .eq('id', entry.blueprint_id)
                    .maybeSingle(),
            ]);

            if (cancelled) return;

            if (ypRes.error || !ypRes.data) {
                console.error('❌ load young_person failed', ypRes.error);
                setView({ status: 'not_found' });
                return;
            }

            if (blueprintRes.error || !blueprintRes.data) {
                console.error(
                    '❌ load form_blueprint failed',
                    blueprintRes.error,
                );
                setView({ status: 'not_found' });
                return;
            }

            const yp = ypRes.data as YoungPerson;
            const bp = blueprintRes.data as FormBlueprint;

            // Basic safety checks
            if (
                bp.head !== 'YOUNG_PEOPLE' ||
                bp.company_id !== entry.company_id ||
                yp.company_id !== entry.company_id
            ) {
                setView({ status: 'not_found' });
                return;
            }

            setView({
                status: 'ready',
                level: lvl,
                youngPerson: yp,
                entry: entry as FormEntry,
                blueprint: bp,
            });

            // Initialise answers state (blank {} by default)
            const rawAnswers = entry.answers;
            if (
                rawAnswers &&
                typeof rawAnswers === 'object' &&
                !Array.isArray(rawAnswers)
            ) {
                setAnswers(rawAnswers as AnswersObject);
            } else {
                setAnswers({});
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [id, formEntryId]);

    const runtimeFields: RuntimeField[] = useMemo(() => {
        if (view.status !== 'ready') return [];
        return normaliseDefinition(view.blueprint.definition);
    }, [view]);

    /** ========= Guards ========= */
    if (view.status === 'loading') {
        return (
            <div className="p-4 md:p-6" style={{ color: 'var(--sub)' }}>
                Loading form…
            </div>
        );
    }

    if (view.status === 'signed_out') {
        return null;
    }

    if (view.status === 'not_found') {
        return (
            <div className="p-4 md:p-6 space-y-4">
                <div>
                    <Link
                        href={`/young-people/${id}`}
                        className="text-xs hover:underline"
                        style={{ color: 'var(--sub)' }}
                    >
                        ← Back to young person
                    </Link>
                </div>
                <div
                    className="rounded-xl p-4 md:p-5 ring-1"
                    style={{
                        background: 'var(--card-grad)',
                        borderColor: 'var(--ring)',
                        color: 'var(--ink)',
                    }}
                >
                    <h1 className="text-lg md:text-xl font-semibold mb-1">
                        Form not found
                    </h1>
                    <p className="text-sm" style={{ color: 'var(--sub)' }}>
                        This form either doesn&apos;t exist anymore or you
                        don&apos;t have permission to view it.
                    </p>
                </div>
            </div>
        );
    }

    const { youngPerson, entry, blueprint } = view;

    const startedLabel = formatDateTime(entry.created_at);
    const submittedLabel = formatDateTime(entry.submitted_at);
    const dobLabel = youngPerson.date_of_birth
        ? new Date(youngPerson.date_of_birth).toLocaleDateString()
        : null;
    const ageLabel = calculateAge(youngPerson.date_of_birth);
    const statusLabel = prettyEntryStatus(entry.status);
    const templateUpdatedLabel = blueprint.updated_at
        ? new Date(blueprint.updated_at).toLocaleDateString()
        : null;

    const isReadOnly =
        entry.status === 'SUBMITTED' ||
        entry.status === 'LOCKED' ||
        entry.status === 'CANCELLED';

    /** ========= Render helpers ========= */

    const handleFieldChange = (
        field: RuntimeField,
        value: string | string[],
    ) => {
        if (isReadOnly) return;
        setAnswers((prev) => ({
            ...prev,
            [field.key]: Array.isArray(value) ? value : value ?? '',
        }));
    };

    const renderField = (field: RuntimeField) => {
        const baseClasses =
            'w-full rounded-lg border px-3 py-2 text-sm bg-transparent';
        const labelColor = 'var(--ink)';
        const helpColor = 'var(--sub)';
        const borderColor = 'var(--ring)';
        const disabledStyles = isReadOnly
            ? { opacity: 0.6, cursor: 'not-allowed' as const }
            : {};

        const currentValue = answers[field.key];

        // Static blocks
        if (field.type === 'HEADER') {
            const text =
                typeof field.raw.text === 'string'
                    ? field.raw.text
                    : field.label ?? '';
            if (!text) return null;
            return (
                <div key={field.key} className="space-y-1">
                    <h3
                        className="text-base md:text-lg font-semibold"
                        style={{ color: labelColor }}
                    >
                        {text}
                    </h3>
                    {field.helpText && (
                        <p
                            className="text-xs md:text-sm"
                            style={{ color: helpColor }}
                        >
                            {field.helpText}
                        </p>
                    )}
                </div>
            );
        }

        if (field.type === 'PARAGRAPH') {
            const text =
                typeof field.raw.text === 'string'
                    ? field.raw.text
                    : field.label ?? '';
            if (!text) return null;
            return (
                <p
                    key={field.key}
                    className="text-sm md:text-[13px] leading-relaxed"
                    style={{ color: helpColor }}
                >
                    {text}
                </p>
            );
        }

        // Input label
        const label = field.label ?? field.key;
        const requiredMark = field.required ? ' *' : '';

        // Text / textarea / number / date / time
        if (
            field.type === 'TEXT' ||
            field.type === 'NUMBER' ||
            field.type === 'DATE' ||
            field.type === 'TIME' ||
            field.type === 'TEXTAREA'
        ) {
            const stringValue =
                typeof currentValue === 'string'
                    ? currentValue
                    : currentValue == null
                        ? ''
                        : String(currentValue);

            if (field.type === 'TEXTAREA') {
                return (
                    <div key={field.key} className="space-y-1.5">
                        <label className="block text-xs font-medium">
                            <span style={{ color: labelColor }}>
                                {label}
                                {requiredMark}
                            </span>
                        </label>
                        <textarea
                            value={stringValue}
                            disabled={isReadOnly}
                            rows={4}
                            className={baseClasses}
                            style={{ borderColor, ...disabledStyles }}
                            onChange={(e) =>
                                handleFieldChange(field, e.target.value)
                            }
                        />
                        {field.helpText && (
                            <p
                                className="text-[11px]"
                                style={{ color: helpColor }}
                            >
                                {field.helpText}
                            </p>
                        )}
                    </div>
                );
            }

            // TEXT / NUMBER / DATE / TIME
            const inputType =
                field.type === 'NUMBER'
                    ? 'number'
                    : field.type === 'DATE'
                        ? 'date'
                        : field.type === 'TIME'
                            ? 'time'
                            : 'text';

            return (
                <div key={field.key} className="space-y-1.5">
                    <label className="block text-xs font-medium">
                        <span style={{ color: labelColor }}>
                            {label}
                            {requiredMark}
                        </span>
                    </label>
                    <input
                        type={inputType}
                        value={stringValue}
                        disabled={isReadOnly}
                        className={baseClasses}
                        style={{ borderColor, ...disabledStyles }}
                        onChange={(e) =>
                            handleFieldChange(field, e.target.value)
                        }
                    />
                    {field.helpText && (
                        <p
                            className="text-[11px]"
                            style={{ color: helpColor }}
                        >
                            {field.helpText}
                        </p>
                    )}
                </div>
            );
        }

        // Selects
        if (
            field.type === 'SINGLE_SELECT' ||
            field.type === 'MULTI_SELECT'
        ) {
            const opts = field.options ?? [];
            const stringValue =
                typeof currentValue === 'string' ? currentValue : '';
            const arrayValue = Array.isArray(currentValue)
                ? currentValue.map((v) => String(v))
                : [];

            return (
                <div key={field.key} className="space-y-1.5">
                    <label className="block text-xs font-medium">
                        <span style={{ color: labelColor }}>
                            {label}
                            {requiredMark}
                        </span>
                    </label>

                    {field.type === 'SINGLE_SELECT' ? (
                        <select
                            disabled={isReadOnly}
                            className={baseClasses}
                            style={{ borderColor, ...disabledStyles }}
                            value={stringValue}
                            onChange={(e) =>
                                handleFieldChange(field, e.target.value)
                            }
                        >
                            <option value="">Select…</option>
                            {opts.map((opt) => (
                                <option
                                    key={opt.value}
                                    value={opt.value}
                                >
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                    ) : (
                        <select
                            multiple
                            disabled={isReadOnly}
                            className={`${baseClasses} min-h-[3.5rem]`}
                            style={{ borderColor, ...disabledStyles }}
                            value={arrayValue}
                            onChange={(e) => {
                                const selected = Array.from(
                                    e.target.selectedOptions,
                                ).map((o) => o.value);
                                handleFieldChange(field, selected);
                            }}
                        >
                            {opts.map((opt) => (
                                <option
                                    key={opt.value}
                                    value={opt.value}
                                >
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                    )}

                    {field.helpText && (
                        <p
                            className="text-[11px]"
                            style={{ color: helpColor }}
                        >
                            {field.helpText}
                        </p>
                    )}
                </div>
            );
        }

        // Fallback
        return null;
    };

    return (
        <div className="p-4 md:p-6 space-y-6">
            {/* Back link */}
            <div>
                <Link
                    href={`/young-people/${youngPerson.id}`}
                    className="text-xs hover:underline"
                    style={{ color: 'var(--sub)' }}
                >
                    ← Back to {youngPerson.full_name}
                </Link>
            </div>

            {/* Header card */}
            <div
                className="rounded-xl ring-1 px-4 py-4 md:px-5 md:py-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4"
                style={{
                    background: 'var(--card-grad)',
                    borderColor: 'var(--ring)',
                }}
            >
                <div className="flex items-start gap-3 md:gap-4">
                    {/* Avatar */}
                    <div
                        className="flex h-12 w-12 md:h-14 md:w-14 items-center justify-center rounded-full text-2xl md:text-3xl"
                        style={{
                            background: 'rgba(124,58,237,0.18)',
                            color: 'var(--ink)',
                        }}
                    >
                        <span className="translate-y-[1px]">🧍</span>
                    </div>

                    {/* Titles */}
                    <div className="space-y-1">
                        <h1
                            className="text-lg md:text-2xl font-semibold tracking-tight"
                            style={{ color: 'var(--ink)' }}
                        >
                            {blueprint.name}
                        </h1>
                        <p
                            className="text-xs md:text-sm"
                            style={{ color: 'var(--sub)' }}
                        >
                            For{' '}
                            <span className="font-medium">
                                {youngPerson.full_name}
                            </span>
                        </p>

                        <div className="flex flex-wrap gap-2 text-[11px] md:text-xs mt-1">
                            <span
                                className="inline-flex items-center rounded-full px-2 py-[2px]"
                                style={{
                                    background: BRAND_GRADIENT,
                                    color: '#FFFFFF',
                                }}
                            >
                                {statusLabel}
                            </span>
                            <span
                                className="inline-flex items-center rounded-full px-2 py-[2px]"
                                style={{
                                    background:
                                        'rgba(59,130,246,0.18)',
                                    color: 'var(--ink)',
                                }}
                            >
                                {blueprint.form_type === 'FIXED'
                                    ? 'Company-wide template'
                                    : 'Adjustable per home'}
                            </span>
                            {templateUpdatedLabel && (
                                <span
                                    className="inline-flex items-center rounded-full px-2 py-[2px]"
                                    style={{
                                        background: 'transparent',
                                        color: 'var(--sub)',
                                    }}
                                >
                                    Template updated {templateUpdatedLabel}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Side info */}
                <div className="flex flex-row md:flex-col gap-4 md:items-end text-sm">
                    <div className="space-y-1 text-right md:text-right">
                        <div
                            className="text-xs uppercase tracking-wide"
                            style={{ color: 'var(--sub)' }}
                        >
                            Started
                        </div>
                        <div style={{ color: 'var(--ink)' }}>
                            {startedLabel || '—'}
                        </div>
                    </div>
                    <div className="space-y-1 text-right md:text-right">
                        <div
                            className="text-xs uppercase tracking-wide"
                            style={{ color: 'var(--sub)' }}
                        >
                            Submitted
                        </div>
                        <div style={{ color: 'var(--ink)' }}>
                            {submittedLabel || 'Not yet submitted'}
                        </div>
                    </div>
                    <div className="space-y-1 text-right md:text-right">
                        <div
                            className="text-xs uppercase tracking-wide"
                            style={{ color: 'var(--sub)' }}
                        >
                            Date of birth
                        </div>
                        <div style={{ color: 'var(--ink)' }}>
                            {dobLabel || '—'}
                        </div>
                        {ageLabel && (
                            <div
                                className="text-xs"
                                style={{ color: 'var(--sub)' }}
                            >
                                {ageLabel}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Form runtime */}
            <div
                className="rounded-xl ring-1 p-4 md:p-5 space-y-4"
                style={{
                    background: 'var(--card-grad)',
                    borderColor: 'var(--ring)',
                }}
            >
                <div className="flex items-center justify-between gap-2">
                    <div
                        className="font-medium text-sm md:text-base"
                        style={{ color: 'var(--ink)' }}
                    >
                        Form content
                    </div>
                    <span
                        className="inline-flex items-center rounded-full px-2 py-[2px] text-[11px]"
                        style={{
                            background: 'rgba(148,163,184,0.16)',
                            color: 'var(--sub)',
                        }}
                    >
                        {isReadOnly
                            ? 'Read-only (submitted/locked)'
                            : 'Draft – not yet wired to saving'}
                    </span>
                </div>

                {runtimeFields.length === 0 ? (
                    <p className="text-sm" style={{ color: 'var(--sub)' }}>
                        This template doesn&apos;t have any fields yet.
                        Add fields in the Form Builder and they&apos;ll
                        appear here.
                    </p>
                ) : (
                    <div className="space-y-4">
                        {runtimeFields.map((field) => renderField(field))}
                    </div>
                )}
            </div>

            {/* Orbit-friendly tweaks */}
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

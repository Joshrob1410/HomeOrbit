// app/(builder)/form-builder/workspace/page.tsx
'use client';

import React, {
    useEffect,
    useState,
    useCallback,
    type DragEvent,
    type ChangeEvent,
    type MouseEvent,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { supabase } from '@/supabase/client';
import { getEffectiveLevel, type AppLevel } from '@/supabase/roles';

const BRAND_GRADIENT =
    'linear-gradient(135deg, #7C3AED 0%, #6366F1 50%, #3B82F6 100%)';

type Level = AppLevel;

type ViewState =
    | { status: 'loading' }
    | { status: 'signed_out' }
    | { status: 'no_access' }
    | { status: 'ready'; level: Level };

type FieldType =
    | 'HEADER'
    | 'PARAGRAPH'
    | 'TEXT'
    | 'TEXTAREA'
    | 'NUMBER'
    | 'DATE'
    | 'TIME'
    | 'SINGLE_SELECT'
    | 'MULTI_SELECT'
    | 'RADIO'
    | 'CHECKBOX'
    | 'IMAGE'
    | 'FILE'
    | 'ADULT_NAME'
    | 'YOUNG_PERSON_NAME'
    | 'CAR';

type FieldWidth = 'FULL' | 'HALF' | 'THIRD';

type FormField = {
    id: string;
    type: FieldType;
    label: string;
    required: boolean;
    width: FieldWidth;
    options?: string[];
};

type ToolDef = {
    type: FieldType;
    label: string;
    description: string;
    icon: string;
};

type ToolGroup = {
    title: string;
    tools: ToolDef[];
};

type HeadKey = 'YOUNG_PEOPLE' | 'CARS' | 'HOME';
type FormStatus = 'DRAFT' | 'PUBLISHED';

const HEADS: { key: HeadKey; label: string }[] = [
    { key: 'YOUNG_PEOPLE', label: 'Young People' },
    { key: 'CARS', label: 'Cars' },
    { key: 'HOME', label: 'Home' },
];

const TOOL_GROUPS: ToolGroup[] = [
    {
        title: 'Layout & text',
        tools: [
            {
                type: 'HEADER',
                label: 'Heading',
                description: 'Big section title to break up the form.',
                icon: 'H',
            },
            {
                type: 'PARAGRAPH',
                label: 'Paragraph',
                description: 'Helper text or instructions.',
                icon: '¶',
            },
        ],
    },
    {
        title: 'Inputs',
        tools: [
            {
                type: 'TEXT',
                label: 'Short text',
                description: 'Single line answer (name, title, etc).',
                icon: 'T',
            },
            {
                type: 'TEXTAREA',
                label: 'Long text',
                description: 'Multi-line notes or descriptions.',
                icon: '📝',
            },
            {
                type: 'NUMBER',
                label: 'Number',
                description: 'Numeric inputs like scores or quantities.',
                icon: '123',
            },
            {
                type: 'DATE',
                label: 'Date',
                description: 'Pick a calendar date.',
                icon: '📅',
            },
            {
                type: 'TIME',
                label: 'Time',
                description: 'Pick a time of day.',
                icon: '⏰',
            },
        ],
    },
    {
        title: 'Choices',
        tools: [
            {
                type: 'SINGLE_SELECT',
                label: 'Dropdown',
                description: 'Choose one option from a list.',
                icon: '⬇️',
            },
            {
                type: 'RADIO',
                label: 'Single choice',
                description: 'One answer from a short list.',
                icon: '◉',
            },
            {
                type: 'MULTI_SELECT',
                label: 'Multiple choice',
                description: 'Tick all options that apply.',
                icon: '☑️',
            },
            {
                type: 'CHECKBOX',
                label: 'Yes / No',
                description: 'Single checkbox for agreements.',
                icon: '☐',
            },
        ],
    },
    {
        title: 'Uploads & files',
        tools: [
            {
                type: 'IMAGE',
                label: 'Image upload',
                description: 'Let staff attach photos or scans.',
                icon: '🖼️',
            },
            {
                type: 'FILE',
                label: 'File upload',
                description: 'Attach documents or other files.',
                icon: '📎',
            },
        ],
    },
    {
        title: 'Linked data',
        tools: [
            {
                type: 'ADULT_NAME',
                label: 'Adult name',
                description: 'Search & select an adult/staff.',
                icon: '👤',
            },
            {
                type: 'YOUNG_PERSON_NAME',
                label: 'Young person',
                description: 'Search & select a young person.',
                icon: '🧒',
            },
            {
                type: 'CAR',
                label: 'Car',
                description: 'Search & select a car.',
                icon: '🚗',
            },
        ],
    },
];

// Colour accents per group (work in light + dark)
const TOOL_GROUP_ACCENT: Record<string, string> = {
    'Layout & text': 'rgba(56,189,248,0.9)', // cyan
    Inputs: 'rgba(129,140,248,0.95)', // indigo
    Choices: 'rgba(52,211,153,0.95)', // emerald
    'Uploads & files': 'rgba(251,191,36,0.95)', // amber
    'Linked data': 'rgba(96,165,250,0.95)', // blue
};

const TOOL_GROUP_ICON_BG: Record<string, string> = {
    'Layout & text': 'rgba(56,189,248,0.15)',
    Inputs: 'rgba(129,140,248,0.18)',
    Choices: 'rgba(52,211,153,0.18)',
    'Uploads & files': 'rgba(251,191,36,0.2)',
    'Linked data': 'rgba(96,165,250,0.18)',
};

const FIELD_TYPE_LABEL: Record<FieldType, string> = {
    HEADER: 'Heading',
    PARAGRAPH: 'Paragraph',
    TEXT: 'Short text',
    TEXTAREA: 'Long text',
    NUMBER: 'Number',
    DATE: 'Date',
    TIME: 'Time',
    SINGLE_SELECT: 'Dropdown',
    MULTI_SELECT: 'Multiple choice',
    RADIO: 'Single choice',
    CHECKBOX: 'Yes / No checkbox',
    IMAGE: 'Image upload',
    FILE: 'File upload',
    ADULT_NAME: 'Adult name',
    YOUNG_PERSON_NAME: 'Young person name',
    CAR: 'Car',
};

const FIELD_WIDTH_LABEL: Record<FieldWidth, string> = {
    FULL: 'Full width',
    HALF: 'Half width',
    THIRD: 'One third',
};

const WIDTH_ORDER: FieldWidth[] = ['FULL', 'HALF', 'THIRD'];



function getNextWidth(current: FieldWidth): FieldWidth {
    const idx = WIDTH_ORDER.indexOf(current);
    if (idx === -1) return 'FULL';
    return WIDTH_ORDER[(idx + 1) % WIDTH_ORDER.length];
}

function createId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID();
    }
    return `field_${Math.random().toString(36).slice(2, 10)}`;
}

function createFieldFromType(type: FieldType): FormField {
    switch (type) {
        case 'HEADER':
            return {
                id: createId(),
                type,
                label: 'Section heading',
                required: false,
                width: 'FULL',
            };
        case 'PARAGRAPH':
            return {
                id: createId(),
                type,
                label: 'Add some helper text for this section.',
                required: false,
                width: 'FULL',
            };
        case 'TEXT':
            return {
                id: createId(),
                type,
                label: 'Short answer question',
                required: false,
                width: 'FULL',
            };
        case 'TEXTAREA':
            return {
                id: createId(),
                type,
                label: 'Long answer question',
                required: false,
                width: 'FULL',
            };
        case 'NUMBER':
            return {
                id: createId(),
                type,
                label: 'Numeric value',
                required: false,
                width: 'HALF',
            };
        case 'DATE':
            return {
                id: createId(),
                type,
                label: 'Date',
                required: false,
                width: 'THIRD',
            };
        case 'TIME':
            return {
                id: createId(),
                type,
                label: 'Time',
                required: false,
                width: 'THIRD',
            };
        case 'SINGLE_SELECT':
            return {
                id: createId(),
                type,
                label: 'Choose one option',
                required: false,
                width: 'FULL',
                options: ['Option 1', 'Option 2', 'Option 3'],
            };
        case 'RADIO':
            return {
                id: createId(),
                type,
                label: 'Single choice question',
                required: false,
                width: 'FULL',
                options: ['Option A', 'Option B', 'Option C'],
            };
        case 'MULTI_SELECT':
            return {
                id: createId(),
                type,
                label: 'Tick all that apply',
                required: false,
                width: 'FULL',
                options: ['Choice 1', 'Choice 2', 'Choice 3'],
            };
        case 'CHECKBOX':
            return {
                id: createId(),
                type,
                label: 'I confirm / agree',
                required: false,
                width: 'FULL',
            };
        case 'IMAGE':
            return {
                id: createId(),
                type,
                label: 'Upload photo',
                required: false,
                width: 'FULL',
            };
        case 'FILE':
            return {
                id: createId(),
                type,
                label: 'Attach file',
                required: false,
                width: 'FULL',
            };
        case 'ADULT_NAME':
            return {
                id: createId(),
                type,
                label: 'Adult',
                required: false,
                width: 'FULL',
            };
        case 'YOUNG_PERSON_NAME':
            return {
                id: createId(),
                type,
                label: 'Young person',
                required: false,
                width: 'FULL',
            };
        case 'CAR':
            return {
                id: createId(),
                type,
                label: 'Car',
                required: false,
                width: 'FULL',
            };
        default: {
            return {
                id: createId(),
                type: 'TEXT',
                label: 'Short answer question',
                required: false,
                width: 'FULL',
            };
        }
    }
}

/** ========= Main full-screen builder ========= */
export default function FullscreenFormBuilderPage() {
    const router = useRouter();
    const searchParams = useSearchParams();

    const [view, setView] = useState<ViewState>({ status: 'loading' });

    const [fields, setFields] = useState<FormField[]>([]);
    const [mode, setMode] = useState<'BUILD' | 'PREVIEW'>('BUILD');

    // From URL (for new vs existing)
    const initialCompanyId = searchParams.get('companyId');
    const initialFormId = searchParams.get('formId');

    const [companyId, setCompanyId] = useState<string | null>(initialCompanyId);
    const [formId, setFormId] = useState<string | null>(initialFormId);

    // Status: draft vs published
    const [status, setStatus] = useState<FormStatus>('DRAFT');

    // Form-level meta
    const [formName, setFormName] = useState('');
    const [formHead, setFormHead] = useState<HeadKey | ''>('');
    const [showExitWarning, setShowExitWarning] = useState(false);
    const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState(false);

    // Form settings
    const [formType, setFormType] = useState<'FIXED' | 'ADJUSTABLE'>('FIXED');
    const [autoSignEnabled, setAutoSignEnabled] = useState(false);
    const [showSettings, setShowSettings] = useState(false);

    // Exit confirm when unsaved
    const [showExitConfirm, setShowExitConfirm] = useState(false);

    // Drag state for reordering
    const [draggingFieldId, setDraggingFieldId] = useState<string | null>(null);

    // Selected fields + clipboard
    const [selectedFieldIds, setSelectedFieldIds] = useState<string[]>([]);
    type ClipboardField = Omit<FormField, 'id'>;
    const [clipboard, setClipboard] = useState<ClipboardField[] | null>(null);

    // Saving flags
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    const isPreview = mode === 'PREVIEW';
    const canAutoSave =
        formName.trim().length > 0 && !!formHead && !!companyId;

    const isAdmin =
        view.status === 'ready' && view.level === '1_ADMIN';

    const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);

    /** ========= Load session + access level ========= */
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
            if (!mounted) return;

            // Only admin + company-level can use the builder
            if (lvl === '3_MANAGER' || lvl === '4_STAFF') {
                setView({ status: 'no_access' });
                return;
            }

            setView({ status: 'ready', level: lvl });

            // Work out company context
            if (lvl === '1_ADMIN') {
                const { data: companyRows, error } = await supabase
                    .from('companies')
                    .select('id, name')
                    .eq('is_archived', false)
                    .order('name', { ascending: true });

                if (!mounted) return;

                if (error) {
                    console.error('❌ load companies failed', error);
                }

                setCompanies(companyRows ?? []);
                // No default companyId here – admin must pick one,
                // unless it came from URL or from loading an existing form.

            } else if (lvl === '2_COMPANY') {
                // Company-level users are locked to their own company
                const {
                    data: myCompanyId,
                    error: myCompanyError,
                } = await supabase.rpc('_my_company');

                if (!mounted) return;

                if (myCompanyError) {
                    console.error('❌ _my_company failed', myCompanyError);
                }

                if (myCompanyId) {
                    const cid = myCompanyId as string;
                    setCompanyId(cid);

                    // Load its name for display (optional but nice)
                    const { data: rows, error: companyError } = await supabase
                        .from('companies')
                        .select('id, name')
                        .eq('id', cid)
                        .limit(1);

                    if (!mounted) return;

                    if (companyError) {
                        console.error('❌ load company for user failed', companyError);
                    }

                    if (rows && rows.length) {
                        setCompanies(rows);
                    }
                }
            }
        })();

        return () => {
            mounted = false;
        };
    }, [initialCompanyId]);


    /** ========= Save form (draft or publish) ========= */
    const saveForm = useCallback(
        async (mode: 'AUTO' | 'PUBLISH' = 'AUTO') => {
            if (!canAutoSave) return;
            if (!companyId) {
                console.warn('No companyId provided to form builder; cannot save.');
                return;
            }

            try {
                setIsSaving(true);
                setSaveError(null);

                // New forms start as DRAFT. Existing forms keep their status
                // unless this is an explicit PUBLISH action.
                const nextStatus: FormStatus =
                    mode === 'PUBLISH'
                        ? 'PUBLISHED'
                        : formId
                            ? status
                            : 'DRAFT';

                const payload: {
                    id?: string;
                    company_id: string;
                    head: HeadKey;
                    name: string;
                    status: FormStatus;
                    form_type: 'FIXED' | 'ADJUSTABLE';
                    auto_sign_enabled: boolean;
                    definition: { fields: FormField[] };
                } = {
                    company_id: companyId,
                    head: formHead as HeadKey,
                    name: formName.trim(),
                    status: nextStatus,
                    form_type: formType,
                    auto_sign_enabled: autoSignEnabled,
                    definition: { fields },
                };

                if (formId) {
                    payload.id = formId;
                }

                const { data, error } = await supabase
                    .from('form_blueprints')
                    .upsert(payload)
                    .select('id, status, updated_at')
                    .single();

                if (error) {
                    console.error('❌ save form_blueprints failed', error);
                    setSaveError('Could not save form.');
                    return;
                }

                setFormId(data.id);
                setStatus(data.status as FormStatus);
                setLastSavedAt(
                    data.updated_at ? new Date(data.updated_at) : new Date()
                );
            } finally {
                setIsSaving(false);
            }
        },
        [
            canAutoSave,
            companyId,
            formId,
            formHead,
            formName,
            formType,
            autoSignEnabled,
            fields,
            status,
        ]
    );

    /** ========= Auto-save when valid ========= */
    useEffect(() => {
        if (!canAutoSave) return;

        const handle = setTimeout(() => {
            void saveForm('AUTO');
        }, 800);

        return () => clearTimeout(handle);
    }, [canAutoSave, formName, formHead, fields, formType, autoSignEnabled, saveForm]);

    /** ========= Load existing form if editing ========= */
    useEffect(() => {
        if (!formId) return;
        if (view.status !== 'ready') return;

        let cancelled = false;

        (async () => {
            const { data, error } = await supabase
                .from('form_blueprints')
                .select(
                    'id, company_id, head, name, status, form_type, auto_sign_enabled, definition, updated_at'
                )
                .eq('id', formId)
                .single();

            if (cancelled) return;

            if (error || !data) {
                console.error('❌ load form_blueprints failed', error);
                return;
            }

            setCompanyId(data.company_id);
            setFormHead(data.head as HeadKey);
            setFormName(data.name);
            setFormType(data.form_type as 'FIXED' | 'ADJUSTABLE');
            setAutoSignEnabled(data.auto_sign_enabled);
            setStatus(data.status as FormStatus);

            const def = (data.definition || {}) as { fields?: FormField[] };
            setFields(def.fields ?? []);

            if (data.updated_at) {
                setLastSavedAt(new Date(data.updated_at));
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [formId, view.status]);

    const handleExit = async () => {
        if (!canAutoSave) {
            // Warn at the top AND show confirm modal
            setShowExitWarning(true);
            if (typeof window !== 'undefined') {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
            setShowExitConfirm(true);
            return;
        }

        // Final explicit save before leaving
        await saveForm('AUTO');
        router.push('/form-builder');
    };


    const handlePublish = async () => {
        // Publish = save with status = PUBLISHED
        await saveForm('PUBLISH');
    };

    const handleDeleteConfirm = () => {
        // TODO: Hook into a real delete from form_blueprints if you want permanent deletion.
        setDeleteConfirm(false);
        router.push('/form-builder');
    };

    const addFieldFromType = (type: FieldType) => {
        const field = createFieldFromType(type);
        setFields((prev) => [...prev, field]);
    };

    const updateField = (id: string, updater: (f: FormField) => FormField) => {
        setFields((prev) => prev.map((f) => (f.id === id ? updater(f) : f)));
    };

    const handleToolDragStart = (
        event: DragEvent<HTMLButtonElement>,
        type: FieldType
    ) => {
        event.dataTransfer.setData('application/x-homeorbit-field-type', type);
        event.dataTransfer.effectAllowed = 'copy';
    };

    const handleCanvasDragOver = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
    };

    const handleCanvasDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        const type = event.dataTransfer.getData(
            'application/x-homeorbit-field-type'
        ) as FieldType | '';
        if (!type) return;
        addFieldFromType(type);
    };

    const handleRemoveField = (id: string) => {
        setFields((prev) => prev.filter((f) => f.id !== id));
        setSelectedFieldIds((prev) => prev.filter((selId) => selId !== id));
    };

    const handleLabelChange = (id: string, e: ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        updateField(id, (f) => ({ ...f, label: value }));
    };

    const handleRequiredToggle = (id: string) => {
        updateField(id, (f) => ({ ...f, required: !f.required }));
    };

    const handleWidthToggle = (id: string) => {
        updateField(id, (f) => ({
            ...f,
            width: getNextWidth(f.width),
        }));
    };

    const handleOptionChange = (
        id: string,
        index: number,
        e: ChangeEvent<HTMLInputElement>
    ) => {
        const value = e.target.value;
        updateField(id, (f) => {
            const current = f.options ?? [];
            const next = [...current];
            next[index] = value;
            return { ...f, options: next };
        });
    };

    const handleAddOption = (id: string) => {
        updateField(id, (f) => {
            const current = f.options ?? [];
            return { ...f, options: [...current, `Option ${current.length + 1}`] };
        });
    };

    const handleRemoveOption = (id: string, index: number) => {
        updateField(id, (f) => {
            const current = f.options ?? [];
            const next = current.filter((_, i) => i !== index);
            return { ...f, options: next };
        });
    };

    // Drag-reorder handlers for canvas fields
    const handleFieldDragStart = (
        event: DragEvent<HTMLDivElement>,
        fieldId: string
    ) => {
        setDraggingFieldId(fieldId);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('application/x-homeorbit-field-id', fieldId);
    };

    const handleFieldDragOver = (
        event: DragEvent<HTMLDivElement>,
        overFieldId: string
    ) => {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';

        const dragId = draggingFieldId;
        if (!dragId || dragId === overFieldId) return;

        setFields((prev) => {
            const dragIndex = prev.findIndex((f) => f.id === dragId);
            const overIndex = prev.findIndex((f) => f.id === overFieldId);
            if (
                dragIndex === -1 ||
                overIndex === -1 ||
                dragIndex === overIndex
            ) {
                return prev;
            }

            const next = [...prev];
            const [moved] = next.splice(dragIndex, 1);
            next.splice(overIndex, 0, moved);
            return next;
        });
    };

    const handleFieldDragEnd = () => {
        setDraggingFieldId(null);
    };

    // Selection + clipboard for fields
    const handleSelectField = (
        id: string,
        event?: MouseEvent<HTMLDivElement>
    ) => {
        if (event && (event.ctrlKey || event.metaKey)) {
            setSelectedFieldIds((prev) =>
                prev.includes(id)
                    ? prev.filter((x) => x !== id)
                    : [...prev, id]
            );
        } else {
            setSelectedFieldIds([id]);
        }
    };

    const handleClearSelection = () => {
        setSelectedFieldIds([]);
    };

    const handleCopySelected = () => {
        if (!selectedFieldIds.length) return;

        const selected = fields
            .filter((f) => selectedFieldIds.includes(f.id))
            .map(({ id, ...rest }) => rest);

        if (!selected.length) return;

        setClipboard(selected);
    };

    const handlePasteBelow = () => {
        if (!clipboard || clipboard.length === 0) return;

        setFields((prev) => {
            const indices = selectedFieldIds
                .map((id) => prev.findIndex((f) => f.id === id))
                .filter((i) => i >= 0);

            const insertIndex =
                indices.length > 0 ? Math.max(...indices) + 1 : prev.length;

            const newFields: FormField[] = clipboard.map((template) => ({
                id: createId(),
                ...template,
            }));

            const next = [...prev];
            next.splice(insertIndex, 0, ...newFields);

            setSelectedFieldIds(newFields.map((f) => f.id));

            return next;
        });
    };

    if (view.status === 'loading') {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <p style={{ color: 'var(--sub)' }}>Loading form builder…</p>
            </div>
        );
    }

    if (view.status === 'signed_out') {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <p style={{ color: 'var(--sub)' }}>
                    You’re signed out. Please log in again.
                </p>
            </div>
        );
    }

    if (view.status === 'no_access') {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div
                    className="px-6 py-4 rounded-xl ring-1"
                    style={{ borderColor: 'var(--ring)', background: 'var(--panel-bg)' }}
                >
                    <p className="text-sm" style={{ color: 'var(--sub)' }}>
                        Only admins can use the full-screen Form Builder.
                    </p>
                </div>
            </div>
        );
    }

    const headLabel =
        formHead && HEADS.find((h) => h.key === formHead)?.label;

    const formTypeLabel =
        formType === 'FIXED'
            ? 'Fixed across company'
            : 'Adjustable per home';

    const formStatusLabel =
        status === 'PUBLISHED' ? 'Published' : 'Draft';

    return (
        <div
            className="min-h-screen flex flex-col"
            style={{
                background:
                    'radial-gradient(circle at top, rgba(124,58,237,0.18), transparent 55%)',
            }}
        >
            {/* Top control bar */}
            <header
                className="border-b"
                style={{
                    borderColor: 'var(--ring)',
                    background: 'rgba(11, 18, 33, 0.94)',
                    backdropFilter: 'blur(14px)',
                }}
            >
                <div className="w-full px-4 py-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-3">
                        <div
                            className="h-9 w-9 rounded-full flex items-center justify-center text-sm font-semibold"
                            style={{ background: BRAND_GRADIENT, color: '#FFFFFF' }}
                        >
                            FB
                        </div>
                        <div>
                            <div
                                className="text-sm md:text-base font-semibold tracking-tight"
                                style={{ color: 'var(--ink)' }}
                            >
                                Form Builder
                            </div>
                            <p
                                className="text-[11px] md:text-xs"
                                style={{ color: 'var(--sub)' }}
                            >
                                {isPreview
                                    ? 'Previewing how staff will see this form.'
                                    : 'Full-screen workspace for building and previewing forms.'}
                            </p>
                            {/* OPTIONAL BIT: status + autosave info */}
                            <p
                                className="text-[11px]"
                                style={{
                                    color: canAutoSave ? 'var(--sub)' : '#F97373',
                                }}
                            >
                                {canAutoSave ? (
                                    <>
                                        Auto-save is active for this form.
                                        You can safely exit once you&apos;re
                                        done.
                                    </>
                                ) : (
                                    <>
                                        Name the form and choose where it belongs to enable auto-save.
                                        {isAdmin &&
                                            ' You also need to select which company this form belongs to.'}
                                    </>
                                )}
                                {showExitWarning && !canAutoSave && (
                                    <>
                                        {' '}
                                        You&apos;re trying to exit without
                                        fully configuring this form, so
                                        your layout will not be saved.
                                    </>
                                )}
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2 md:justify-end">
                        {/* Preview toggle */}
                        <button
                            type="button"
                            onClick={() =>
                                setMode((m) => (m === 'BUILD' ? 'PREVIEW' : 'BUILD'))
                            }
                            className="px-3 py-1.5 text-xs md:text-sm rounded-md ring-1"
                            style={{
                                background: isPreview
                                    ? 'var(--panel-bg)'
                                    : 'var(--nav-item-bg)',
                                color: 'var(--ink)',
                                borderColor: 'var(--ring)',
                            }}
                        >
                            {isPreview ? 'Back to builder' : 'Preview form'}
                        </button>

                        {/* Settings */}
                        <button
                            type="button"
                            onClick={() => setShowSettings(true)}
                            className="px-3 py-1.5 text-xs md:text-sm rounded-md ring-1 inline-flex items-center gap-1"
                            style={{
                                background: 'var(--panel-bg)',
                                color: 'var(--ink)',
                                borderColor: 'var(--ring)',
                            }}
                        >
                            <span className="text-sm">⚙️</span>
                            <span>Settings</span>
                        </button>

                        {/* Publish */}
                        <button
                            type="button"
                            onClick={handlePublish}
                            className="px-3 py-1.5 text-xs md:text-sm rounded-md shadow-sm"
                            style={{
                                background: BRAND_GRADIENT,
                                color: '#FFFFFF',
                            }}
                        >
                            Publish form
                        </button>

                        {/* Delete form */}
                        {!deleteConfirm ? (
                            <button
                                type="button"
                                onClick={() => setDeleteConfirm(true)}
                                className="px-3 py-1.5 text-xs md:text-sm rounded-md ring-1"
                                style={{
                                    background: 'rgba(127,29,29,0.2)',
                                    color: '#F97373',
                                    borderColor: '#7F1D1D',
                                }}
                            >
                                Delete form
                            </button>
                        ) : (
                            <div className="flex flex-wrap gap-1">
                                <button
                                    type="button"
                                    onClick={handleDeleteConfirm}
                                    className="px-3 py-1.5 text-xs md:text-sm rounded-md"
                                    style={{
                                        background: '#DC2626',
                                        color: '#FFFFFF',
                                    }}
                                >
                                    Confirm delete
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setDeleteConfirm(false)}
                                    className="px-3 py-1.5 text-xs md:text-sm rounded-md ring-1"
                                    style={{
                                        background: 'var(--panel-bg)',
                                        color: 'var(--ink)',
                                        borderColor: 'var(--ring)',
                                    }}
                                >
                                    Cancel
                                </button>
                            </div>
                        )}

                        {/* Exit (furthest right) */}
                        <button
                            type="button"
                            onClick={handleExit}
                            className="px-3 py-1.5 text-xs md:text-sm rounded-md ring-1"
                            style={{
                                background: 'transparent',
                                color: 'var(--sub)',
                                borderColor: 'var(--ring)',
                            }}
                        >
                            Exit form builder
                        </button>
                    </div>
                </div>
            </header>

            {/* Main builder canvas area */}
            <main className="flex-1 min-h-0">
                <div className="h-full w-full px-4 py-6">
                    {isPreview ? (
                        /* ===== PREVIEW MODE ===== */
                        <div className="h-full flex justify-center">
                            <section className="w-full md:max-w-2xl lg:max-w-3xl">
                                <div
                                    className="h-full rounded-2xl ring-1 p-4 md:p-6 overflow-auto"
                                    style={{
                                        borderColor: 'var(--ring)',
                                        background: 'var(--panel-bg)',
                                    }}
                                >
                                    <div className="mb-4 space-y-1">
                                        {formName && (
                                            <h2
                                                className="text-base md:text-lg font-semibold"
                                                style={{ color: 'var(--ink)' }}
                                            >
                                                {formName}
                                            </h2>
                                        )}
                                        <div className="flex flex-wrap items-center gap-2">
                                            {headLabel && (
                                                <span
                                                    className="inline-flex items-center rounded-full px-2 py-[2px] text-[11px] uppercase tracking-wide"
                                                    style={{
                                                        background:
                                                            'rgba(148, 163, 184, 0.16)',
                                                        color: 'var(--sub)',
                                                    }}
                                                >
                                                    {headLabel}
                                                </span>
                                            )}
                                            <span
                                                className="inline-flex items-center rounded-full px-2 py-[2px] text-[11px] uppercase tracking-wide"
                                                style={{
                                                    background:
                                                        'rgba(148, 163, 184, 0.16)',
                                                    color: 'var(--sub)',
                                                }}
                                            >
                                                {formTypeLabel}
                                            </span>
                                            {autoSignEnabled && (
                                                <span
                                                    className="inline-flex items-center rounded-full px-2 py-[2px] text-[11px] uppercase tracking-wide"
                                                    style={{
                                                        background:
                                                            'rgba(34,197,94,0.16)',
                                                        color: '#4ADE80',
                                                    }}
                                                >
                                                    Auto sign on scroll
                                                </span>
                                            )}
                                        </div>
                                        <p
                                            className="text-xs md:text-sm"
                                            style={{ color: 'var(--sub)' }}
                                        >
                                            This is how the form will look to staff when
                                            completing it. You can type into the fields,
                                            but changes here aren&apos;t saved.
                                        </p>
                                    </div>

                                    {fields.length === 0 ? (
                                        <div className="h-full flex items-center justify-center text-center">
                                            <p
                                                className="text-sm md:text-base max-w-md"
                                                style={{ color: 'var(--sub)' }}
                                            >
                                                Add some fields in the builder first, then
                                                come back to preview how the live form
                                                will look.
                                            </p>
                                        </div>
                                    ) : (
                                        <form className="flex flex-col md:flex-row md:flex-wrap gap-4">
                                            {fields.map((field) => {
                                                const widthClass =
                                                    field.width === 'HALF'
                                                        ? 'w-full md:w-[calc(50%-0.5rem)]'
                                                        : field.width === 'THIRD'
                                                            ? 'w-full md:w-[calc(33.333%-0.5rem)]'
                                                            : 'w-full';

                                                return (
                                                    <div
                                                        key={field.id}
                                                        className={widthClass}
                                                    >
                                                        {field.type !== 'HEADER' &&
                                                            field.type !==
                                                            'PARAGRAPH' && (
                                                                <div className="mb-1 flex items-baseline gap-1">
                                                                    <label
                                                                        className="text-xs md:text-sm font-medium"
                                                                        style={{
                                                                            color: 'var(--ink)',
                                                                        }}
                                                                    >
                                                                        {field.label ||
                                                                            FIELD_TYPE_LABEL[field.type]}
                                                                        {field.required && (
                                                                            <span className="ml-0.5 text-[#F97373]">
                                                                                *
                                                                            </span>
                                                                        )}
                                                                    </label>
                                                                </div>
                                                            )}
                                                        {renderFieldLive(field)}
                                                    </div>
                                                );
                                            })}
                                        </form>
                                    )}
                                </div>
                            </section>
                        </div>
                    ) : (
                        /* ===== BUILD MODE ===== */
                        <div className="h-full flex flex-col md:flex-row gap-4 min-h-0">
                            {/* Tools sidebar */}
                            <aside
                                className="w-full md:w-64 lg:w-72 flex-shrink-0 rounded-2xl ring-1 p-3 md:p-4 flex flex-col h-full"
                                style={{
                                    borderColor: 'var(--ring)',
                                    background: 'var(--panel-bg)',
                                    maxHeight: 'calc(100vh - 96px)',
                                }}
                            >
                                <div className="mb-2">
                                    <h2
                                        className="text-sm font-semibold mb-1"
                                        style={{ color: 'var(--ink)' }}
                                    >
                                        Tools
                                    </h2>
                                    <p
                                        className="text-xs"
                                        style={{ color: 'var(--sub)' }}
                                    >
                                        Drag a field onto the canvas, or click to add it
                                        to the bottom of the form.
                                    </p>
                                </div>

                                <div className="flex-1 overflow-auto space-y-3 text-xs mt-1 pr-1">
                                    {TOOL_GROUPS.map((group) => {
                                        const accent =
                                            TOOL_GROUP_ACCENT[group.title] ??
                                            'rgba(148,163,184,0.9)';
                                        const iconBg =
                                            TOOL_GROUP_ICON_BG[group.title] ??
                                            'rgba(148,163,184,0.18)';

                                        return (
                                            <div
                                                key={group.title}
                                                className="space-y-1.5"
                                            >
                                                <div
                                                    className="text-[11px] font-semibold uppercase tracking-wide flex items-center gap-1"
                                                    style={{ color: accent }}
                                                >
                                                    <span
                                                        className="h-[6px] w-[6px] rounded-full"
                                                        style={{ background: accent }}
                                                    />
                                                    {group.title}
                                                </div>
                                                <div className="space-y-1.5">
                                                    {group.tools.map((tool) => (
                                                        <button
                                                            key={tool.type}
                                                            type="button"
                                                            draggable
                                                            onDragStart={(e) =>
                                                                handleToolDragStart(
                                                                    e,
                                                                    tool.type
                                                                )
                                                            }
                                                            onClick={() =>
                                                                addFieldFromType(
                                                                    tool.type
                                                                )
                                                            }
                                                            className="w-full flex items-start gap-2 rounded-lg px-2 py-2 text-left ring-1 cursor-grab active:cursor-grabbing transition-transform hover:-translate-y-[1px] hover:shadow-sm"
                                                            style={{
                                                                background:
                                                                    'var(--nav-item-bg)',
                                                                borderColor:
                                                                    'var(--ring)',
                                                                borderLeftColor:
                                                                    accent,
                                                                borderLeftWidth:
                                                                    '3px',
                                                                borderLeftStyle:
                                                                    'solid',
                                                            }}
                                                        >
                                                            <div
                                                                className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-md text-[11px] font-semibold flex-shrink-0"
                                                                style={{
                                                                    background: iconBg,
                                                                    color: 'var(--ink)',
                                                                }}
                                                            >
                                                                {tool.icon}
                                                            </div>
                                                            <div className="flex-1">
                                                                <div
                                                                    className="text-xs font-medium"
                                                                    style={{
                                                                        color: 'var(--ink)',
                                                                    }}
                                                                >
                                                                    {tool.label}
                                                                </div>
                                                                <p
                                                                    className="text-[11px]"
                                                                    style={{
                                                                        color: 'var(--sub)',
                                                                    }}
                                                                >
                                                                    {tool.description}
                                                                </p>
                                                            </div>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </aside>

                            {/* Canvas on the right */}
                            <section className="flex-1 min-h-0">
                                <div
                                    className="h-full rounded-2xl ring-1 p-4 overflow-auto"
                                    style={{
                                        borderColor: 'var(--ring)',
                                        background: 'var(--panel-bg)',
                                    }}
                                    onDragOver={handleCanvasDragOver}
                                    onDrop={handleCanvasDrop}
                                >
                                    {/* Form-level settings */}
                                    <div className="mb-4 space-y-2">
                                            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
                                                <div className="flex-1">
                                                    <label
                                                        className="block text-xs mb-1"
                                                        style={{ color: 'var(--sub)' }}
                                                    >
                                                        Form name
                                                    </label>
                                                    <input
                                                        type="text"
                                                        value={formName}
                                                        onChange={(e) => {
                                                            setFormName(e.target.value);
                                                            setShowExitWarning(false);
                                                        }}
                                                        className="w-full rounded-md px-2 py-2 text-sm ring-1"
                                                        style={{
                                                            background: 'var(--nav-item-bg)',
                                                            color: 'var(--ink)',
                                                            borderColor: 'var(--ring)',
                                                        }}
                                                        placeholder="e.g. Daily summary log"
                                                    />
                                                </div>

                                                {isAdmin && (
                                                    <div className="w-full md:w-56">
                                                        <label
                                                            className="block text-xs mb-1"
                                                            style={{ color: 'var(--sub)' }}
                                                        >
                                                            Company
                                                        </label>
                                                        <select
                                                            value={companyId ?? ''}
                                                            onChange={(e) => {
                                                                const val = e.target.value || null;
                                                                setCompanyId(val);
                                                                setShowExitWarning(false);
                                                            }}
                                                            className="w-full rounded-md px-2 py-2 text-sm ring-1"
                                                            style={{
                                                                background: 'var(--nav-item-bg)',
                                                                color: 'var(--ink)',
                                                                borderColor: 'var(--ring)',
                                                            }}
                                                        >
                                                            <option value="">Select company…</option>
                                                            {companies.map((c) => (
                                                                <option key={c.id} value={c.id}>
                                                                    {c.name}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                )}

                                                <div className="w-full md:w-56">
                                                    <label
                                                        className="block text-xs mb-1"
                                                        style={{ color: 'var(--sub)' }}
                                                    >
                                                        Where does this form belong?
                                                    </label>
                                                    <select
                                                        value={formHead || ''}
                                                        onChange={(e) => {
                                                            const val = e.target.value as HeadKey | '';
                                                            setFormHead(val);
                                                            setShowExitWarning(false);
                                                        }}
                                                        className="w-full rounded-md px-2 py-2 text-sm ring-1"
                                                        style={{
                                                            background: 'var(--nav-item-bg)',
                                                            color: 'var(--ink)',
                                                            borderColor: 'var(--ring)',
                                                        }}
                                                    >
                                                        <option value="">
                                                            Select Young People, Cars or Home…
                                                        </option>
                                                        {HEADS.map((h) => (
                                                            <option key={h.key} value={h.key}>
                                                                {h.label}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </div>

                                        <p
                                            className="text-[11px]"
                                            style={{
                                                color: canAutoSave
                                                    ? 'var(--sub)'
                                                    : '#F97373',
                                            }}
                                        >
                                            {canAutoSave ? (
                                                <>
                                                    Auto-save is active for this form.
                                                    You can safely exit once you&apos;re
                                                    done.
                                                </>
                                            ) : (
                                                <>
                                                    Name the form and choose where it
                                                    belongs to enable auto-save. Changes
                                                    may be lost if you exit before doing
                                                    this.
                                                </>
                                            )}
                                            {showExitWarning && !canAutoSave && (
                                                <>
                                                    {' '}
                                                    You&apos;re trying to exit without
                                                    naming or categorising this form, so
                                                    your layout will not be saved.
                                                </>
                                            )}
                                        </p>
                                    </div>

                                    {/* Selection toolbar */}
                                    {selectedFieldIds.length > 0 && (
                                        <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] md:text-xs">
                                            <span style={{ color: 'var(--sub)' }}>
                                                {selectedFieldIds.length} field
                                                {selectedFieldIds.length === 1 ? '' : 's'}{' '}
                                                selected. Ctrl/Cmd-click to add or remove
                                                from the selection.
                                            </span>
                                            <button
                                                type="button"
                                                onClick={handleCopySelected}
                                                className="px-2 py-1 rounded-md ring-1"
                                                style={{
                                                    background: 'var(--panel-bg)',
                                                    borderColor: 'var(--ring)',
                                                    color: 'var(--ink)',
                                                }}
                                            >
                                                Copy
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handlePasteBelow}
                                                disabled={
                                                    !clipboard ||
                                                    clipboard.length === 0
                                                }
                                                className="px-2 py-1 rounded-md ring-1 disabled:opacity-60"
                                                style={{
                                                    background:
                                                        clipboard &&
                                                            clipboard.length
                                                            ? 'var(--nav-item-bg)'
                                                            : 'var(--panel-bg)',
                                                    borderColor: 'var(--ring)',
                                                    color: 'var(--ink)',
                                                }}
                                            >
                                                Paste below
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handleClearSelection}
                                                className="px-2 py-1 rounded-md ring-1"
                                                style={{
                                                    background: 'transparent',
                                                    borderColor: 'var(--ring)',
                                                    color: 'var(--sub)',
                                                }}
                                            >
                                                Clear
                                            </button>
                                        </div>
                                    )}

                                    {/* Fields area */}
                                    {fields.length === 0 ? (
                                        <div className="h-full flex items-center justify-center text-center">
                                            <p
                                                className="text-sm md:text-base max-w-md"
                                                style={{ color: 'var(--sub)' }}
                                            >
                                                Drag tools from the left sidebar onto this
                                                canvas, or click a tool to add it. This is
                                                where the live form layout will appear.
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col md:flex-row md:flex-wrap gap-3">
                                            {fields.map((field) => {
                                                const widthClass =
                                                    field.width === 'HALF'
                                                        ? 'w-full md:w-[calc(50%-0.375rem)]'
                                                        : field.width === 'THIRD'
                                                            ? 'w-full md:w-[calc(33.333%-0.375rem)]'
                                                            : 'w-full';

                                                const showRequiredToggle =
                                                    field.type !== 'HEADER' &&
                                                    field.type !== 'PARAGRAPH';

                                                const supportsOptions = Array.isArray(
                                                    field.options
                                                );

                                                const isDragging =
                                                    draggingFieldId === field.id;
                                                const isAnyDragging =
                                                    draggingFieldId !== null;
                                                const isSelected =
                                                    selectedFieldIds.includes(
                                                        field.id
                                                    );
                                                const isDimmed =
                                                    isAnyDragging && !isDragging;

                                                const cardBackground = isDragging
                                                    ? 'linear-gradient(135deg, rgba(251,191,36,0.14), var(--nav-item-bg))'
                                                    : isSelected
                                                        ? 'linear-gradient(135deg, rgba(59,130,246,0.18), var(--nav-item-bg))'
                                                        : 'var(--nav-item-bg)';

                                                const cardBorder = isDragging
                                                    ? '1px solid rgba(251,191,36,0.9)'
                                                    : isSelected
                                                        ? '1px solid rgba(59,130,246,0.9)'
                                                        : '1px solid rgba(148,163,184,0.28)';

                                                const cardShadow = isDragging
                                                    ? '0 16px 36px rgba(251,191,36,0.28)'
                                                    : isSelected
                                                        ? '0 14px 32px rgba(59,130,246,0.28)'
                                                        : '0 10px 24px rgba(15,23,42,0.06)';

                                                const handleAccentForDrag = isAnyDragging;
                                                const handleAccentForSelect =
                                                    !isAnyDragging && isSelected;

                                                return (
                                                    <div
                                                        key={field.id}
                                                        className={widthClass}
                                                        onClick={(e) =>
                                                            handleSelectField(
                                                                field.id,
                                                                e
                                                            )
                                                        }
                                                    >
                                                        <div
                                                            className="rounded-xl px-3 py-3 select-none"
                                                            style={{
                                                                background:
                                                                    cardBackground,
                                                                border: cardBorder,
                                                                boxShadow:
                                                                    cardShadow,
                                                                transform: isDragging
                                                                    ? 'scale(1.01)'
                                                                    : 'scale(1)',
                                                                transition:
                                                                    'transform 120ms ease, box-shadow 120ms ease, opacity 80ms ease, border-color 80ms ease, background 120ms ease',
                                                                opacity: isDimmed
                                                                    ? 0.45
                                                                    : 1,
                                                                filter: isDimmed
                                                                    ? 'grayscale(0.25)'
                                                                    : 'none',
                                                            }}
                                                        >
                                                            <div className="flex items-start justify-between gap-2 mb-2">
                                                                <div className="flex items-start gap-2 flex-1">
                                                                    {/* Drag handle */}
                                                                    <div
                                                                        className="mt-1 h-6 w-6 flex items-center justify-center rounded-md cursor-grab active:cursor-grabbing"
                                                                        draggable
                                                                        onDragStart={(e) =>
                                                                            handleFieldDragStart(
                                                                                e,
                                                                                field.id
                                                                            )
                                                                        }
                                                                        onDragOver={(e) =>
                                                                            handleFieldDragOver(
                                                                                e,
                                                                                field.id
                                                                            )
                                                                        }
                                                                        onDragEnd={
                                                                            handleFieldDragEnd
                                                                        }
                                                                        title="Drag to reorder"
                                                                        style={{
                                                                            background:
                                                                                handleAccentForDrag
                                                                                    ? 'rgba(251,191,36,0.18)'
                                                                                    : handleAccentForSelect
                                                                                        ? 'rgba(59,130,246,0.18)'
                                                                                        : 'var(--panel-bg)',
                                                                            border:
                                                                                handleAccentForDrag
                                                                                    ? '1px solid rgba(251,191,36,0.9)'
                                                                                    : handleAccentForSelect
                                                                                        ? '1px solid rgba(59,130,246,0.9)'
                                                                                        : '1px solid var(--ring)',
                                                                            color:
                                                                                handleAccentForDrag
                                                                                    ? 'rgba(251,191,36,0.95)'
                                                                                    : handleAccentForSelect
                                                                                        ? 'rgba(59,130,246,0.95)'
                                                                                        : 'var(--sub)',
                                                                            boxShadow:
                                                                                handleAccentForDrag
                                                                                    ? '0 0 0 1px rgba(251,191,36,0.35)'
                                                                                    : handleAccentForSelect
                                                                                        ? '0 0 0 1px rgba(59,130,246,0.35)'
                                                                                        : 'none',
                                                                            fontSize:
                                                                                '12px',
                                                                            lineHeight: 1,
                                                                        }}
                                                                        onClick={(e) =>
                                                                            e.stopPropagation()
                                                                        }
                                                                    >
                                                                        ⋮⋮
                                                                    </div>

                                                                    <div className="flex-1">
                                                                        <input
                                                                            type="text"
                                                                            value={
                                                                                field.label
                                                                            }
                                                                            onChange={(e) =>
                                                                                handleLabelChange(
                                                                                    field.id,
                                                                                    e
                                                                                )
                                                                            }
                                                                            className="w-full rounded-md px-2 py-1.5 text-xs md:text-sm ring-1"
                                                                            style={{
                                                                                background:
                                                                                    'var(--panel-bg)',
                                                                                color: 'var(--ink)',
                                                                                borderColor:
                                                                                    'var(--ring)',
                                                                            }}
                                                                            onClick={(e) =>
                                                                                e.stopPropagation()
                                                                            }
                                                                        />

                                                                        <div className="flex flex-wrap items-center gap-2 mt-1">
                                                                            <span
                                                                                className="inline-flex items-center rounded-full px-2 py-[2px] text-[10px] uppercase tracking-wide"
                                                                                style={{
                                                                                    background:
                                                                                        'rgba(148, 163, 184, 0.16)',
                                                                                    color: 'var(--sub)',
                                                                                }}
                                                                            >
                                                                                {
                                                                                    FIELD_TYPE_LABEL[

                                                                                    field.type
                                                                                    ]
                                                                                }
                                                                            </span>

                                                                            <button
                                                                                type="button"
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    handleWidthToggle(
                                                                                        field.id
                                                                                    );
                                                                                }}
                                                                                className="text-[10px] px-2 py-[2px] rounded-full ring-1"
                                                                                style={{
                                                                                    borderColor:
                                                                                        'var(--ring)',
                                                                                    color: 'var(--sub)',
                                                                                    background:
                                                                                        'var(--panel-bg)',
                                                                                }}
                                                                            >
                                                                                {
                                                                                    FIELD_WIDTH_LABEL[
                                                                                    field.width
                                                                                    ]
                                                                                }
                                                                            </button>

                                                                            {showRequiredToggle && (
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={(e) => {
                                                                                        e.stopPropagation();
                                                                                        handleRequiredToggle(
                                                                                            field.id
                                                                                        );
                                                                                    }}
                                                                                    className="text-[10px] px-2 py-[2px] rounded-full ring-1"
                                                                                    style={{
                                                                                        borderColor:
                                                                                            'var(--ring)',
                                                                                        background:
                                                                                            field.required
                                                                                                ? 'rgba(34,197,94,0.12)'
                                                                                                : 'rgba(148,163,184,0.16)',
                                                                                        color:
                                                                                            field.required
                                                                                                ? '#4ADE80'
                                                                                                : 'var(--sub)',
                                                                                    }}
                                                                                >
                                                                                    {field.required
                                                                                        ? 'Required'
                                                                                        : 'Optional'}
                                                                                </button>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>

                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleRemoveField(
                                                                            field.id
                                                                        );
                                                                    }}
                                                                    className="text-[11px] px-2 py-1 rounded-md ring-1"
                                                                    style={{
                                                                        borderColor:
                                                                            'var(--ring)',
                                                                        background:
                                                                            'var(--panel-bg)',
                                                                        color: '#EF4444',
                                                                    }}
                                                                >
                                                                    Remove
                                                                </button>
                                                            </div>

                                                            <div className="text-xs md:text-sm">
                                                                {renderFieldPreview(
                                                                    field
                                                                )}
                                                            </div>

                                                            {supportsOptions && (
                                                                <div className="mt-3 space-y-1.5">
                                                                    {(field.options ?? [])
                                                                        .map(
                                                                            (
                                                                                opt,
                                                                                index
                                                                            ) => (
                                                                                <div
                                                                                    key={`${field.id}_${index}`}


                                                                                    className="flex items-center gap-2"
                                                                                >
                                                                                    <input
                                                                                        type="text"
                                                                                        value={
                                                                                            opt
                                                                                        }
                                                                                        onChange={(
                                                                                            e
                                                                                        ) =>
                                                                                            handleOptionChange(
                                                                                                field.id,
                                                                                                index,
                                                                                                e
                                                                                            )
                                                                                        }
                                                                                        className="flex-1 rounded-md px-2 py-1 text-[11px] ring-1"
                                                                                        style={{
                                                                                            background:
                                                                                                'var(--panel-bg)',
                                                                                            color:
                                                                                                'var(--ink)',
                                                                                            borderColor:
                                                                                                'var(--ring)',
                                                                                        }}
                                                                                        onClick={(
                                                                                            e
                                                                                        ) =>
                                                                                            e.stopPropagation()
                                                                                        }
                                                                                    />
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={(
                                                                                            e
                                                                                        ) => {
                                                                                            e.stopPropagation();
                                                                                            handleRemoveOption(
                                                                                                field.id,
                                                                                                index
                                                                                            );
                                                                                        }}
                                                                                        className="text-[11px] px-2 py-1 rounded-md ring-1"
                                                                                        style={{
                                                                                            borderColor:
                                                                                                'var(--ring)',
                                                                                            background:
                                                                                                'var(--panel-bg)',
                                                                                            color:
                                                                                                'var(--sub)',
                                                                                        }}
                                                                                    >
                                                                                        ✕
                                                                                    </button>
                                                                                </div>
                                                                            )
                                                                        )}
                                                                    <button
                                                                        type="button"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            handleAddOption(
                                                                                field.id
                                                                            );
                                                                        }}
                                                                        className="text-[11px] mt-1 px-2 py-1 rounded-md ring-1"
                                                                        style={{
                                                                            borderColor:
                                                                                'var(--ring)',
                                                                            background:
                                                                                'var(--nav-item-bg)',
                                                                            color: 'var(--ink)',
                                                                        }}
                                                                    >
                                                                        + Add option
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </section>
                        </div>
                    )}
                </div>
            </main>

            {/* Settings modal */}
            {showSettings && (
                <FormSettingsModal
                    formType={formType}
                    autoSignEnabled={autoSignEnabled}
                    onClose={() => setShowSettings(false)}
                    onChangeType={setFormType}
                    onToggleAutoSign={() =>
                        setAutoSignEnabled((prev) => !prev)
                    }
                />
            )}

            {/* Exit without save modal */}
            {showExitConfirm && (
                <ExitWithoutSaveModal
                    onStay={() => setShowExitConfirm(false)}
                    onLeave={() => {
                        setShowExitConfirm(false);
                        router.push('/form-builder');
                    }}
                />
            )}
        </div>
    );
}

/** ========= Settings modal ========= */
function FormSettingsModal({
    formType,
    autoSignEnabled,
    onClose,
    onChangeType,
    onToggleAutoSign,
}: {
    formType: 'FIXED' | 'ADJUSTABLE';
    autoSignEnabled: boolean;
    onClose: () => void;
    onChangeType: (t: 'FIXED' | 'ADJUSTABLE') => void;
    onToggleAutoSign: () => void;
}) {
    const modeDescription =
        formType === 'FIXED'
            ? 'Form is locked company-wide. Homes use the same structure.'
            : 'Managers can adjust a copy of this form for their home.';

    return (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
            <div
                className="w-full max-w-md rounded-2xl ring-1 p-4 md:p-5"
                style={{
                    background: 'var(--panel-bg)',
                    borderColor: 'var(--ring)',
                }}
            >
                <div className="flex items-start justify-between gap-3 mb-4">
                    <div>
                        <h2
                            className="text-base font-semibold"
                            style={{ color: 'var(--ink)' }}
                        >
                            Form settings
                        </h2>
                        <p
                            className="text-xs mt-0.5"
                            style={{ color: 'var(--sub)' }}
                        >
                            Control how this form behaves across homes.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="h-7 w-7 rounded-full flex items-center justify-center text-xs ring-1"
                        style={{
                            borderColor: 'var(--ring)',
                            color: 'var(--sub)',
                            background: 'var(--nav-item-bg)',
                        }}
                    >
                        ✕
                    </button>
                </div>

                <div className="space-y-4 text-sm">
                    {/* Fixed vs adjustable */}
                    <div>
                        <div
                            className="text-xs font-medium mb-1"
                            style={{ color: 'var(--ink)' }}
                        >
                            Form type
                        </div>
                        <div className="inline-flex rounded-lg overflow-hidden ring-1">
                            <button
                                type="button"
                                onClick={() => onChangeType('FIXED')}
                                className="px-3 py-1.5 text-xs md:text-sm"
                                style={{
                                    background:
                                        formType === 'FIXED'
                                            ? BRAND_GRADIENT
                                            : 'var(--nav-item-bg)',
                                    color:
                                        formType === 'FIXED'
                                            ? '#FFFFFF'
                                            : 'var(--ink)',
                                    borderRight:
                                        '1px solid rgba(148,163,184,0.35)',
                                }}
                            >
                                Fixed
                            </button>
                            <button
                                type="button"
                                onClick={() => onChangeType('ADJUSTABLE')}
                                className="px-3 py-1.5 text-xs md:text-sm"
                                style={{
                                    background:
                                        formType === 'ADJUSTABLE'
                                            ? BRAND_GRADIENT
                                            : 'var(--nav-item-bg)',
                                    color:
                                        formType === 'ADJUSTABLE'
                                            ? '#FFFFFF'
                                            : 'var(--ink)',
                                }}
                            >
                                Adjustable
                            </button>
                        </div>
                        <p
                            className="text-[11px] mt-1"
                            style={{ color: 'var(--sub)' }}
                        >
                            {modeDescription}
                        </p>
                    </div>

                    {/* Auto sign */}
                    <div>
                        <div
                            className="text-xs font-medium mb-1"
                            style={{ color: 'var(--ink)' }}
                        >
                            Auto sign
                        </div>
                        <button
                            type="button"
                            onClick={onToggleAutoSign}
                            className="mt-1 flex items-center justify-between w-full rounded-lg px-3 py-2 ring-1"
                            style={{
                                borderColor: 'var(--ring)',
                                background: 'var(--nav-item-bg)',
                            }}
                        >
                            <div className="text-left">
                                <div
                                    className="text-xs font-medium"
                                    style={{ color: 'var(--ink)' }}
                                >
                                    Auto sign on scroll
                                </div>
                                <p
                                    className="text-[11px]"
                                    style={{ color: 'var(--sub)' }}
                                >
                                    When enabled, reaching the bottom of the live form
                                    will sign with the user’s initials and a timestamp.
                                </p>
                            </div>
                            <div
                                className="ml-3 flex h-5 w-9 items-center rounded-full"
                                style={{
                                    background: autoSignEnabled
                                        ? '#4ade80'
                                        : 'rgba(148,163,184,0.35)',
                                }}
                            >
                                <div
                                    className="h-4 w-4 rounded-full bg-white shadow"
                                    style={{
                                        transform: autoSignEnabled
                                            ? 'translateX(12px)'
                                            : 'translateX(2px)',
                                        transition: 'transform 120ms ease-out',
                                    }}
                                />
                            </div>
                        </button>
                    </div>
                </div>

                <div className="mt-4 flex justify-end">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-3 py-1.5 text-xs md:text-sm rounded-md ring-1"
                        style={{
                            background: 'var(--nav-item-bg)',
                            color: 'var(--ink)',
                            borderColor: 'var(--ring)',
                        }}
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}

/** ========= Exit without save modal ========= */
function ExitWithoutSaveModal({
    onStay,
    onLeave,
}: {
    onStay: () => void;
    onLeave: () => void;
}) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45">
            <div
                className="w-full max-w-md rounded-2xl ring-1 p-4 md:p-5"
                style={{
                    background: 'var(--panel-bg)',
                    borderColor: 'var(--ring)',
                }}
            >
                <h2
                    className="text-base font-semibold mb-1"
                    style={{ color: 'var(--ink)' }}
                >
                    Leave form builder?
                </h2>
                <p
                    className="text-xs md:text-sm mb-4"
                    style={{ color: 'var(--sub)' }}
                >
                    This form doesn&apos;t have a name or category yet, so your layout
                    hasn&apos;t been saved. If you leave now, anything you&apos;ve
                    added will be lost.
                </p>
                <div className="flex flex-wrap justify-end gap-2">
                    <button
                        type="button"
                        onClick={onStay}
                        className="px-3 py-1.5 text-xs md:text-sm rounded-md ring-1"
                        style={{
                            background: 'var(--nav-item-bg)',
                            color: 'var(--ink)',
                            borderColor: 'var(--ring)',
                        }}
                    >
                        Stay in builder
                    </button>
                    <button
                        type="button"
                        onClick={onLeave}
                        className="px-3 py-1.5 text-xs md:text-sm rounded-md"
                        style={{
                            background: '#DC2626',
                            color: '#FFFFFF',
                        }}
                    >
                        Leave without saving
                    </button>
                </div>
            </div>
        </div>
    );
}

/** ========= Builder (design-time) preview ========= */
function renderFieldPreview(field: FormField) {
    const commonInputStyle = {
        background: 'var(--panel-bg)',
        color: 'var(--ink)',
        borderColor: 'var(--ring)',
    };

    switch (field.type) {
        case 'HEADER':
            return (
                <h3
                    className="mt-2 text-base md:text-lg font-semibold"
                    style={{ color: 'var(--ink)' }}
                >
                    {field.label || 'Section heading'}
                </h3>
            );
        case 'PARAGRAPH':
            return (
                <p
                    className="mt-2 text-xs md:text-sm"
                    style={{ color: 'var(--sub)' }}
                >
                    {field.label ||
                        'Helper text or explanation for this part of the form.'}
                </p>
            );
        case 'TEXT':
            return (
                <input
                    type="text"
                    readOnly
                    className="mt-2 w-full rounded-md px-2 py-1.5 text-xs md:text-sm ring-1"
                    style={commonInputStyle}
                    placeholder="Short answer"
                />
            );
        case 'ADULT_NAME':
        case 'YOUNG_PERSON_NAME':
        case 'CAR': {
            const placeholder =
                field.type === 'CAR'
                    ? 'Start typing a car…'
                    : 'Start typing a name…';
            return (
                <input
                    type="text"
                    readOnly
                    className="mt-2 w-full rounded-md px-2 py-1.5 text-xs md:text-sm ring-1"
                    style={commonInputStyle}
                    placeholder={placeholder}
                />
            );
        }
        case 'TEXTAREA':
            return (
                <textarea
                    readOnly
                    rows={3}
                    className="mt-2 w-full rounded-md px-2 py-1.5 text-xs md:text-sm ring-1 resize-none"
                    style={commonInputStyle}
                    placeholder="Longer answer"
                />
            );
        case 'NUMBER':
            return (
                <input
                    type="number"
                    readOnly
                    className="mt-2 w-full rounded-md px-2 py-1.5 text-xs md:text-sm ring-1"
                    style={commonInputStyle}
                    placeholder="0"
                />
            );
        case 'DATE':
            return (
                <input
                    type="date"
                    readOnly
                    className="mt-2 rounded-md px-2 py-1.5 text-xs md:text-sm ring-1 w-full"
                    style={commonInputStyle}
                />
            );
        case 'TIME':
            return (
                <input
                    type="time"
                    readOnly
                    className="mt-2 rounded-md px-2 py-1.5 text-xs md:text-sm ring-1 w-full"
                    style={commonInputStyle}
                />
            );
        case 'SINGLE_SELECT':
            return (
                <select
                    disabled
                    className="mt-2 w-full rounded-md px-2 py-1.5 text-xs md:text-sm ring-1"
                    style={commonInputStyle}
                >
                    <option>Select one…</option>
                    {(field.options ?? []).map((opt) => (
                        <option key={opt}>{opt}</option>
                    ))}
                </select>
            );
        case 'RADIO':
            return (
                <div className="mt-2 space-y-1">
                    {(field.options ?? ['Option A', 'Option B']).map((opt) => (
                        <label
                            key={opt}
                            className="flex items-center gap-2 text-xs md:text-sm"
                            style={{ color: 'var(--ink)' }}
                        >
                            <input type="radio" disabled />
                            <span>{opt}</span>
                        </label>
                    ))}
                </div>
            );
        case 'MULTI_SELECT':
            return (
                <div className="mt-2 space-y-1">
                    {(field.options ?? ['Choice 1', 'Choice 2']).map((opt) => (
                        <label
                            key={opt}
                            className="flex items-center gap-2 text-xs md:text-sm"
                            style={{ color: 'var(--ink)' }}
                        >
                            <input type="checkbox" disabled />
                            <span>{opt}</span>
                        </label>
                    ))}
                </div>
            );
        case 'CHECKBOX':
            return (
                <label
                    className="mt-2 flex items-center gap-2 text-xs md:text-sm"
                    style={{ color: 'var(--ink)' }}
                >
                    <input type="checkbox" disabled />
                    <span>{field.label || 'I confirm / agree'}</span>
                </label>
            );
        case 'IMAGE':
            return (
                <div
                    className="mt-2 flex flex-col items-start justify-center gap-1 rounded-lg border border-dashed px-3 py-3 text-xs md:text-sm"
                    style={{
                        borderColor: 'var(--ring)',
                        background: 'var(--nav-item-bg)',
                        color: 'var(--sub)',
                    }}
                >
                    <div className="font-medium" style={{ color: 'var(--ink)' }}>
                        Image upload area
                    </div>
                    <p className="text-[11px]">
                        In the live form, staff will be able to attach photos here.
                    </p>
                </div>
            );
        case 'FILE':
            return (
                <div
                    className="mt-2 flex flex-col items-start justify-center gap-1 rounded-lg border border-dashed px-3 py-3 text-xs md:text-sm"
                    style={{
                        borderColor: 'var(--ring)',
                        background: 'var(--nav-item-bg)',
                        color: 'var(--sub)',
                    }}
                >
                    <div className="font-medium" style={{ color: 'var(--ink)' }}>
                        File upload area
                    </div>
                    <p className="text-[11px]">
                        In the live form, staff will be able to attach documents here.
                    </p>
                </div>
            );
        default:
            return null;
    }
}

/** ========= Live (runtime-style) preview ========= */
function renderFieldLive(field: FormField) {
    const commonInputStyle = {
        background: 'var(--panel-bg)',
        color: 'var(--ink)',
        borderColor: 'var(--ring)',
    };

    switch (field.type) {
        case 'HEADER':
            return (
                <h2
                    className="mt-1 text-base md:text-lg font-semibold"
                    style={{ color: 'var(--ink)' }}
                >
                    {field.label || 'Section heading'}
                </h2>
            );
        case 'PARAGRAPH':
            return (
                <p
                    className="mt-1 text-xs md:text-sm"
                    style={{ color: 'var(--sub)' }}
                >
                    {field.label ||
                        'Helper text or explanation for this part of the form.'}
                </p>
            );
        case 'TEXT':
            return (
                <input
                    type="text"
                    className="mt-1 w-full rounded-md px-2 py-1.5 text-xs md:text-sm ring-1"
                    style={commonInputStyle}
                    placeholder="Type your answer…"
                />
            );
        case 'ADULT_NAME':
        case 'YOUNG_PERSON_NAME':
        case 'CAR': {
            const placeholder =
                field.type === 'CAR'
                    ? 'Start typing a car…'
                    : 'Start typing a name…';
            return (
                <input
                    type="text"
                    className="mt-1 w-full rounded-md px-2 py-1.5 text-xs md:text-sm ring-1"
                    style={commonInputStyle}
                    placeholder={placeholder}
                />
            );
        }
        case 'TEXTAREA':
            return (
                <textarea
                    rows={3}
                    className="mt-1 w-full rounded-md px-2 py-1.5 text-xs md:text-sm ring-1"
                    style={{
                        ...commonInputStyle,
                        maxHeight: '25vh',
                        overflowY: 'auto',
                        resize: 'none',
                    }}
                    placeholder="Type your notes…"
                    onInput={(e) => {
                        const el = e.currentTarget;
                        el.style.height = 'auto';
                        el.style.height = `${Math.min(
                            el.scrollHeight,
                            window.innerHeight * 0.25
                        )}px`;
                    }}
                />
            );
        case 'NUMBER':
            return (
                <input
                    type="number"
                    className="mt-1 w-full rounded-md px-2 py-1.5 text-xs md:text-sm ring-1"
                    style={commonInputStyle}
                    placeholder="0"
                />
            );
        case 'DATE':
            return (
                <input
                    type="date"
                    className="mt-1 rounded-md px-2 py-1.5 text-xs md:text-sm ring-1 w-full"
                    style={commonInputStyle}
                />
            );
        case 'TIME':
            return (
                <input
                    type="time"
                    className="mt-1 rounded-md px-2 py-1.5 text-xs md:text-sm ring-1 w-full"
                    style={commonInputStyle}
                />
            );
        case 'SINGLE_SELECT':
            return (
                <select
                    className="mt-1 w-full rounded-md px-2 py-1.5 text-xs md:text-sm ring-1"
                    style={commonInputStyle}
                >
                    <option value="">Select one…</option>
                    {(field.options ?? []).map((opt) => (
                        <option key={opt}>{opt}</option>
                    ))}
                </select>
            );
        case 'RADIO':
            return (
                <div className="mt-1 space-y-1">
                    {(field.options ?? ['Option A', 'Option B']).map((opt) => (
                        <label
                            key={opt}
                            className="flex items-center gap-2 text-xs md:text-sm"
                            style={{ color: 'var(--ink)' }}
                        >
                            <input type="radio" name={field.id} value={opt} />
                            <span>{opt}</span>
                        </label>
                    ))}
                </div>
            );
        case 'MULTI_SELECT':
            return (
                <div className="mt-1 space-y-1">
                    {(field.options ?? ['Choice 1', 'Choice 2']).map((opt) => (
                        <label
                            key={opt}
                            className="flex items-center gap-2 text-xs md:text-sm"
                            style={{ color: 'var(--ink)' }}
                        >
                            <input type="checkbox" value={opt} />
                            <span>{opt}</span>
                        </label>
                    ))}
                </div>
            );
        case 'CHECKBOX':
            return (
                <label
                    className="mt-1 flex items-center gap-2 text-xs md:text-sm"
                    style={{ color: 'var(--ink)' }}
                >
                    <input type="checkbox" />
                    <span>{field.label || 'I confirm / agree'}</span>
                </label>
            );
        case 'IMAGE':
            return (
                <div
                    className="mt-1 flex flex-col items-start justify-center gap-1 rounded-lg border border-dashed px-3 py-3 text-xs md:text-sm cursor-pointer"
                    style={{
                        borderColor: 'var(--ring)',
                        background: 'var(--nav-item-bg)',
                        color: 'var(--sub)',
                    }}
                >
                    <div className="font-medium" style={{ color: 'var(--ink)' }}>
                        Image upload
                    </div>
                    <p className="text-[11px]">
                        Click here to choose a photo (preview only – not saved).
                    </p>
                </div>
            );
        case 'FILE':
            return (
                <div
                    className="mt-1 flex flex-col items-start justify-center gap-1 rounded-lg border border-dashed px-3 py-3 text-xs md:text-sm cursor-pointer"
                    style={{
                        borderColor: 'var(--ring)',
                        background: 'var(--nav-item-bg)',
                        color: 'var(--sub)',
                    }}
                >
                    <div className="font-medium" style={{ color: 'var(--ink)' }}>
                        File upload
                    </div>
                    <p className="text-[11px]">
                        Click here to choose a file (preview only – not saved).
                    </p>
                </div>
            );
        default:
            return null;
    }
}

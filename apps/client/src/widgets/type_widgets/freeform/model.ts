export const FREEFORM_DOCUMENT_VERSION = 1;
export const FREEFORM_CANVAS_WIDTH = 2400;
export const FREEFORM_CANVAS_HEIGHT = 1600;
const FREEFORM_ITEM_MAX_HEIGHT = 10_000;

export interface FreeformItem {
    id: string;
    type: "richText";
    x: number;
    y: number;
    width: number;
    height: number;
    html: string;
}

export interface FreeformDocument {
    type: "trilium-freeform";
    version: typeof FREEFORM_DOCUMENT_VERSION;
    gridVisible: boolean;
    items: FreeformItem[];
}

export type FreeformParseResult =
    | { ok: true; document: FreeformDocument }
    | { ok: false; document: FreeformDocument };

export function createEmptyFreeformDocument(): FreeformDocument {
    return {
        type: "trilium-freeform",
        version: FREEFORM_DOCUMENT_VERSION,
        gridVisible: false,
        items: []
    };
}

export function parseFreeformDocument(content: string): FreeformParseResult {
    if (!content) {
        return { ok: true, document: createEmptyFreeformDocument() };
    }

    try {
        const parsed = JSON.parse(content) as Partial<FreeformDocument>;
        if (parsed.type !== "trilium-freeform" || parsed.version !== FREEFORM_DOCUMENT_VERSION || !Array.isArray(parsed.items)) {
            return { ok: false, document: createEmptyFreeformDocument() };
        }

        const items = parsed.items.map(normalizeItem).filter((item): item is FreeformItem => item !== null);
        return {
            ok: true,
            document: {
                type: "trilium-freeform",
                version: FREEFORM_DOCUMENT_VERSION,
                gridVisible: parsed.gridVisible === true,
                items
            }
        };
    } catch {
        return { ok: false, document: createEmptyFreeformDocument() };
    }
}

function normalizeItem(item: unknown): FreeformItem | null {
    if (!item || typeof item !== "object") {
        return null;
    }

    const candidate = item as Partial<FreeformItem>;
    if (candidate.type !== "richText" || typeof candidate.id !== "string" || typeof candidate.html !== "string") {
        return null;
    }

    return {
        id: candidate.id,
        type: "richText",
        x: clampNumber(candidate.x, 0, FREEFORM_CANVAS_WIDTH - 160, 80),
        y: clampNumber(candidate.y, 0, FREEFORM_CANVAS_HEIGHT - 80, 80),
        width: clampNumber(candidate.width, 160, 960, 360),
        height: clampNumber(candidate.height, 80, FREEFORM_ITEM_MAX_HEIGHT, 180),
        html: candidate.html
    };
}

function clampNumber(value: unknown, minimum: number, maximum: number, fallback: number) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(Math.max(value, minimum), maximum);
}

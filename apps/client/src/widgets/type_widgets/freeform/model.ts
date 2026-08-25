import {
    FREEFORM_DOCUMENT_TYPE,
    FREEFORM_DOCUMENT_VERSION,
    FREEFORM_LEGACY_DOCUMENT_VERSION
} from "@triliumnext/commons";

export { FREEFORM_DOCUMENT_VERSION };
export const FREEFORM_CLIPBOARD_MIME = "application/x-trilium-freeform-item";
const FREEFORM_CANVAS_PADDING = 192;
const FREEFORM_POSITION_MAX = 100_000;
const FREEFORM_ITEM_MAX_HEIGHT = 10_000;
const FREEFORM_TEXT_AUTOSIZE_INLINE_ALLOWANCE = 16;
export const FREEFORM_TEXT_MIN_WIDTH = 160;
export const FREEFORM_TEXT_MAX_WIDTH = FREEFORM_POSITION_MAX;

interface FreeformItemBase {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface FreeformRichTextItem extends FreeformItemBase {
    type: "richText";
    html: string;
    manualHeight?: number;
}

export interface FreeformImageItem extends FreeformItemBase {
    type: "image";
    url: string;
    alt: string;
}

export type FreeformItem = FreeformRichTextItem | FreeformImageItem;

export interface FreeformItemChanges {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    html?: string;
    manualHeight?: number;
}

export interface FreeformDocument {
    type: typeof FREEFORM_DOCUMENT_TYPE;
    version: typeof FREEFORM_DOCUMENT_VERSION;
    gridVisible: boolean;
    items: FreeformItem[];
}

export interface FreeformCanvasExtent {
    width: number;
    height: number;
}

export type FreeformParseResult =
    | { ok: true; document: FreeformDocument }
    | { ok: false; document: FreeformDocument };

interface FreeformClipboardPayload {
    type: "trilium-freeform-item";
    version: 1;
    sourceNoteId: string;
    item: FreeformItem;
}

export function createEmptyFreeformDocument(): FreeformDocument {
    return {
        type: FREEFORM_DOCUMENT_TYPE,
        version: FREEFORM_DOCUMENT_VERSION,
        gridVisible: false,
        items: []
    };
}

export function getFreeformCanvasExtent(items: FreeformItem[]): FreeformCanvasExtent {
    let width = 0;
    let height = 0;
    for (const item of items) {
        width = Math.max(width, item.x + item.width + FREEFORM_CANVAS_PADDING);
        height = Math.max(height, item.y + item.height + FREEFORM_CANVAS_PADDING);
    }
    return { width, height };
}

export function getFreeformTextAutoWidth(currentWidth: number, measuredWidth: number) {
    if (!Number.isFinite(measuredWidth)) {
        return currentWidth;
    }

    return Math.min(
        FREEFORM_TEXT_MAX_WIDTH,
        Math.max(
            currentWidth,
            FREEFORM_TEXT_MIN_WIDTH,
            Math.ceil(measuredWidth + FREEFORM_TEXT_AUTOSIZE_INLINE_ALLOWANCE)
        )
    );
}

export function parseFreeformDocument(content: string): FreeformParseResult {
    if (!content) {
        return { ok: true, document: createEmptyFreeformDocument() };
    }

    try {
        const parsed = JSON.parse(content) as Partial<Omit<FreeformDocument, "version" | "items">> & {
            version?: number;
            items?: unknown[];
        };
        if (
            parsed.type !== FREEFORM_DOCUMENT_TYPE
            || (parsed.version !== FREEFORM_LEGACY_DOCUMENT_VERSION && parsed.version !== FREEFORM_DOCUMENT_VERSION)
            || !Array.isArray(parsed.items)
        ) {
            return { ok: false, document: createEmptyFreeformDocument() };
        }

        const items: FreeformItem[] = [];
        const itemIds = new Set<string>();
        for (const candidate of parsed.items) {
            const item = normalizeItem(candidate);
            if (!item || itemIds.has(item.id)) {
                return { ok: false, document: createEmptyFreeformDocument() };
            }
            itemIds.add(item.id);
            items.push(item);
        }
        return {
            ok: true,
            document: {
                type: FREEFORM_DOCUMENT_TYPE,
                version: FREEFORM_DOCUMENT_VERSION,
                gridVisible: parsed.gridVisible === true,
                items
            }
        };
    } catch {
        return { ok: false, document: createEmptyFreeformDocument() };
    }
}

export function applyFreeformItemChanges(item: FreeformItem, changes: FreeformItemChanges): FreeformItem {
    const updated = normalizeItem({ ...item, ...changes });
    return updated ?? item;
}

export function duplicateFreeformItem(item: FreeformItem, id: string, offset = 28): FreeformItem {
    return applyFreeformItemChanges({ ...item, id }, {
        x: Math.max(0, item.x + offset),
        y: Math.max(0, item.y + offset)
    });
}

export function serializeFreeformItem(sourceNoteId: string, item: FreeformItem) {
    const payload: FreeformClipboardPayload = {
        type: "trilium-freeform-item",
        version: 1,
        sourceNoteId,
        item
    };
    return JSON.stringify(payload);
}

export function parseFreeformItemClipboard(content: string): FreeformClipboardPayload | null {
    try {
        const parsed = JSON.parse(content) as Partial<FreeformClipboardPayload>;
        const item = normalizeItem(parsed.item);
        if (
            parsed.type !== "trilium-freeform-item"
            || parsed.version !== 1
            || typeof parsed.sourceNoteId !== "string"
            || !parsed.sourceNoteId
            || !item
        ) {
            return null;
        }

        return {
            type: "trilium-freeform-item",
            version: 1,
            sourceNoteId: parsed.sourceNoteId,
            item
        };
    } catch {
        return null;
    }
}

function normalizeItem(item: unknown): FreeformItem | null {
    if (!item || typeof item !== "object") {
        return null;
    }

    const candidate = item as Partial<FreeformItem>;
    if (typeof candidate.id !== "string" || !candidate.id) {
        return null;
    }

    const position = {
        id: candidate.id,
        x: clampNumber(candidate.x, 0, FREEFORM_POSITION_MAX, 80),
        y: clampNumber(candidate.y, 0, FREEFORM_POSITION_MAX, 80)
    };

    if (candidate.type === "richText" && typeof candidate.html === "string") {
        const geometry = {
            ...position,
            width: clampNumber(candidate.width, FREEFORM_TEXT_MIN_WIDTH, FREEFORM_TEXT_MAX_WIDTH, 360),
            height: clampNumber(candidate.height, 80, FREEFORM_ITEM_MAX_HEIGHT, 180)
        };
        const manualHeight = typeof candidate.manualHeight === "number"
            ? clampNumber(candidate.manualHeight, 80, FREEFORM_ITEM_MAX_HEIGHT, 80)
            : undefined;
        return {
            ...geometry,
            height: Math.max(geometry.height, manualHeight ?? 80),
            type: "richText",
            html: candidate.html,
            manualHeight
        };
    }

    if (
        candidate.type === "image"
        && typeof candidate.url === "string"
        && isAttachmentImageUrl(candidate.url)
    ) {
        const geometry = normalizeImageGeometry(candidate.width, candidate.height);
        return {
            ...position,
            ...geometry,
            type: "image",
            url: candidate.url,
            alt: typeof candidate.alt === "string" ? candidate.alt : ""
        };
    }

    return null;
}

function normalizeImageGeometry(widthValue: unknown, heightValue: unknown) {
    let width = clampNumber(widthValue, 1, Number.MAX_SAFE_INTEGER, 480);
    let height = clampNumber(heightValue, 1, Number.MAX_SAFE_INTEGER, 320);
    const scale = Math.min(1, 960 / width, FREEFORM_ITEM_MAX_HEIGHT / height);
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
    return { width, height };
}

function isAttachmentImageUrl(url: string) {
    return /^\/?api\/attachments\/[^/?#]+\/image\/[^?#]+(?:[?#].*)?$/.test(url);
}

function clampNumber(value: unknown, minimum: number, maximum: number, fallback: number) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(Math.max(value, minimum), maximum);
}

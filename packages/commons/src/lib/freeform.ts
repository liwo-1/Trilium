export const FREEFORM_DOCUMENT_TYPE = "trilium-freeform";
export const FREEFORM_DOCUMENT_VERSION = 2;
export const FREEFORM_LEGACY_DOCUMENT_VERSION = 1;

interface FreeformContentItem {
    type?: unknown;
    url?: unknown;
    html?: unknown;
}

export interface FreeformContentDocument {
    type: typeof FREEFORM_DOCUMENT_TYPE;
    version: number;
    items: FreeformContentItem[];
    [key: string]: unknown;
}

export interface FreeformReferenceMapper {
    attachmentId?: (attachmentId: string) => string;
    noteId?: (noteId: string) => string;
}

export function parseFreeformContentDocument(content: string): FreeformContentDocument | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch {
        return null;
    }

    if (!parsed || typeof parsed !== "object") {
        return null;
    }

    const candidate = parsed as Partial<FreeformContentDocument>;
    if (
        candidate.type !== FREEFORM_DOCUMENT_TYPE
        || (candidate.version !== FREEFORM_LEGACY_DOCUMENT_VERSION && candidate.version !== FREEFORM_DOCUMENT_VERSION)
        || !Array.isArray(candidate.items)
    ) {
        return null;
    }

    return candidate as FreeformContentDocument;
}

export function collectFreeformAttachmentIds(content: string): Set<string> {
    const attachmentIds = new Set<string>();
    rewriteFreeformReferences(content, {
        attachmentId(attachmentId) {
            attachmentIds.add(attachmentId);
            return attachmentId;
        }
    });
    return attachmentIds;
}

export function rewriteFreeformReferences(content: string, mapper: FreeformReferenceMapper): string {
    const document = parseFreeformContentDocument(content);
    if (!document) {
        return content;
    }

    let changed = false;
    for (const item of document.items) {
        if (!item || typeof item !== "object") {
            continue;
        }

        if (item.type === "image" && typeof item.url === "string" && mapper.attachmentId) {
            const rewrittenUrl = replaceAttachmentPath(item.url, mapper.attachmentId);
            if (rewrittenUrl !== item.url) {
                item.url = rewrittenUrl;
                changed = true;
            }
        }

        if (item.type === "richText" && typeof item.html === "string") {
            const rewrittenHtml = rewriteRichTextReferences(item.html, mapper);
            if (rewrittenHtml !== item.html) {
                item.html = rewrittenHtml;
                changed = true;
            }
        }
    }

    return changed ? JSON.stringify(document) : content;
}

export function extractFreeformText(content: string): string {
    const document = parseFreeformContentDocument(content);
    if (!document) {
        return "";
    }

    return document.items
        .filter((item) => item?.type === "richText" && typeof item.html === "string")
        .map((item) => (item.html as string).replace(/<[^>]+>/g, " "))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
}

export function convertFreeformAttachmentToNote(content: string, attachmentId: string, noteId: string): string {
    const document = parseFreeformContentDocument(content);
    if (!document || !attachmentId || !noteId) {
        return content;
    }

    const escapedAttachmentId = escapeRegExp(attachmentId);
    let changed = false;

    for (const item of document.items) {
        if (!item || typeof item !== "object") {
            continue;
        }

        if (item.type === "image" && typeof item.url === "string") {
            const rewrittenUrl = item.url.replace(
                new RegExp(`^(\\/?api\\/attachments\\/)${escapedAttachmentId}(\\/image\\/[^?#]+(?:[?#].*)?)$`, "i"),
                (_match, prefix: string, suffix: string) => `${prefix.replace(/attachments\/$/i, "images/")}${noteId}${suffix.replace(/^\/image/i, "")}`
            );
            if (rewrittenUrl !== item.url) {
                item.url = rewrittenUrl;
                changed = true;
            }
        }

        if (item.type === "richText" && typeof item.html === "string") {
            let rewrittenHtml = item.html.replace(
                new RegExp(`((?:src|data-image|data-favicon)=["'][^"']*?api\\/attachments\\/)${escapedAttachmentId}(\\/image\\/[^"']*)`, "gi"),
                (_match, prefix: string, suffix: string) => `${prefix.replace(/attachments\/$/i, "images/")}${noteId}${suffix.replace(/^\/image/i, "")}`
            );
            rewrittenHtml = rewrittenHtml.replace(
                new RegExp(`href=["'][^"']*?[?&](?:amp;)?attachmentId=${escapedAttachmentId}[^"']*["']`, "gi"),
                `href="#root/${noteId}"`
            );
            if (rewrittenHtml !== item.html) {
                item.html = rewrittenHtml;
                changed = true;
            }
        }
    }

    return changed ? JSON.stringify(document) : content;
}

function rewriteRichTextReferences(html: string, mapper: FreeformReferenceMapper): string {
    if (mapper.attachmentId) {
        html = html.replace(
            /((?:src|href|data-image|data-favicon)=["'][^"']*?api\/attachments\/)([a-zA-Z0-9_]+)/gi,
            (_match, prefix: string, attachmentId: string) => `${prefix}${mapper.attachmentId?.(attachmentId) ?? attachmentId}`
        );
        html = html.replace(
            /(href=["'][^"']*?[?&](?:amp;)?attachmentId=)([a-zA-Z0-9_]+)/gi,
            (_match, prefix: string, attachmentId: string) => `${prefix}${mapper.attachmentId?.(attachmentId) ?? attachmentId}`
        );
    }

    if (mapper.noteId) {
        html = html.replace(
            /(href=["'][^"']*?#root\/)([a-zA-Z0-9_]+)/gi,
            (_match, prefix: string, noteId: string) => `${prefix}${mapper.noteId?.(noteId) ?? noteId}`
        );
        html = html.replace(
            /(data-note-id=["'])([a-zA-Z0-9_]+)/gi,
            (_match, prefix: string, noteId: string) => `${prefix}${mapper.noteId?.(noteId) ?? noteId}`
        );
    }

    return html;
}

function replaceAttachmentPath(url: string, mapper: (attachmentId: string) => string): string {
    return url.replace(
        /^(\/?api\/attachments\/)([a-zA-Z0-9_]+)(\/image\/[^?#]+(?:[?#].*)?)$/i,
        (_match, prefix: string, attachmentId: string, suffix: string) => `${prefix}${mapper(attachmentId)}${suffix}`
    );
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

import { t } from "../../../services/i18n";
import server from "../../../services/server";
import toast from "../../../services/toast";

const DEFAULT_IMAGE_WIDTH = 480;

export interface UploadedFreeformImage {
    url: string;
    width: number;
    height: number;
    alt: string;
}

export async function uploadFreeformImage(
    noteId: string,
    file: File
): Promise<UploadedFreeformImage | null> {
    const size = await measureImage(file);
    if (!size) {
        showUploadError(file.name);
        return null;
    }

    const url = await uploadImage(noteId, file);
    if (!url) {
        return null;
    }

    const width = Math.min(DEFAULT_IMAGE_WIDTH, size.width);
    return {
        url,
        width,
        height: Math.max(1, Math.round(width * size.height / size.width)),
        alt: file.name
    };
}

export async function removeUploadedFreeformImage(url: string) {
    const attachmentId = url.match(/^\/?api\/attachments\/([a-zA-Z0-9_]+)\/image\//)?.[1];
    if (attachmentId) {
        await server.remove(`attachments/${attachmentId}`);
    }
}

async function uploadImage(noteId: string, file: File): Promise<string | null> {
    if (!file.type.startsWith("image/")) {
        showUploadError(file.name);
        return null;
    }

    let detail: string | undefined;
    try {
        const result = await server.upload(
            `notes/${noteId}/attachments/upload`,
            file,
            undefined,
            "POST"
        ) as { uploaded?: boolean; url?: string; message?: string };

        if (result.uploaded && result.url) {
            return result.url;
        }
        detail = result.message;
    } catch (e) {
        detail = e instanceof Error ? e.message : undefined;
    }

    showUploadError(file.name, detail);
    return null;
}

function showUploadError(name: string, detail?: string) {
    const message = t("mind-map.image-upload-failed", { name });
    toast.showError(detail ? `${message} ${detail}` : message);
}

function measureImage(file: Blob): Promise<{ width: number; height: number } | null> {
    const url = URL.createObjectURL(file);
    return new Promise((resolve) => {
        const image = new Image();
        image.onload = () => {
            URL.revokeObjectURL(url);
            resolve(image.naturalWidth && image.naturalHeight
                ? { width: image.naturalWidth, height: image.naturalHeight }
                : null);
        };
        image.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(null);
        };
        image.src = url;
    });
}

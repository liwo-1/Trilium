import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import server from "../../../services/server";
import toast from "../../../services/toast";
import { removeUploadedFreeformImage, uploadFreeformImage } from "./images";

vi.mock("../../../services/server", () => ({ default: { remove: vi.fn(), upload: vi.fn() } }));
vi.mock("../../../services/toast", () => ({ default: { showError: vi.fn() } }));

function stubImage(size: { width: number; height: number } | null) {
    vi.stubGlobal("Image", class {
        naturalWidth = size?.width ?? 0;
        naturalHeight = size?.height ?? 0;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;

        set src(_value: string) {
            queueMicrotask(() => (size ? this.onload?.() : this.onerror?.()));
        }
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:picture");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    stubImage({ width: 1200, height: 800 });
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("uploadFreeformImage", () => {
    const file = new File([ "image" ], "diagram.png", { type: "image/png" });

    it("stores an image attachment and keeps its aspect ratio", async () => {
        vi.mocked(server.upload).mockResolvedValue({
            uploaded: true,
            url: "api/attachments/att1/image/diagram.png"
        });

        expect(await uploadFreeformImage("page", file)).toEqual({
            url: "api/attachments/att1/image/diagram.png",
            width: 480,
            height: 320,
            alt: "diagram.png"
        });
        expect(server.upload).toHaveBeenCalledWith(
            "notes/page/attachments/upload",
            file,
            undefined,
            "POST"
        );
    });

    it("does not enlarge a small image", async () => {
        stubImage({ width: 120, height: 60 });
        vi.mocked(server.upload).mockResolvedValue({
            uploaded: true,
            url: "api/attachments/att1/image/small.png"
        });

        expect(await uploadFreeformImage("page", file)).toMatchObject({
            width: 120,
            height: 60
        });
    });

    it("rejects non-images and reports upload failures", async () => {
        const textFile = new File([ "text" ], "notes.txt", { type: "text/plain" });
        expect(await uploadFreeformImage("page", textFile)).toBeNull();
        expect(server.upload).not.toHaveBeenCalled();

        vi.mocked(server.upload).mockRejectedValue(new Error("Offline"));
        expect(await uploadFreeformImage("page", file)).toBeNull();
        expect(vi.mocked(toast.showError).mock.calls.at(-1)?.[0]).toContain("Offline");
    });

    it("removes an uploaded attachment abandoned after navigation", async () => {
        vi.mocked(server.remove).mockResolvedValue(undefined);

        await removeUploadedFreeformImage("api/attachments/att1/image/diagram.png");
        await removeUploadedFreeformImage("https://example.com/image.png");

        expect(server.remove).toHaveBeenCalledOnce();
        expect(server.remove).toHaveBeenCalledWith("attachments/att1");
    });
});

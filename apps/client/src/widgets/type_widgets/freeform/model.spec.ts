import { describe, expect, it } from "vitest";

import {
    createEmptyFreeformDocument,
    duplicateFreeformItem,
    getFreeformCanvasExtent,
    parseFreeformDocument,
    parseFreeformItemClipboard,
    serializeFreeformItem
} from "./model";

describe("parseFreeformDocument", () => {
    it("creates an empty document for new notes", () => {
        expect(parseFreeformDocument("")).toEqual({ ok: true, document: createEmptyFreeformDocument() });
    });

    it("migrates legacy version-1 text and image documents to version 2", () => {
        const result = parseFreeformDocument(JSON.stringify({
            type: "trilium-freeform",
            version: 1,
            gridVisible: false,
            items: [
                { id: "text", type: "richText", x: 0, y: 0, width: 360, height: 180, html: "<p>Legacy</p>" },
                { id: "image", type: "image", x: 20, y: 30, width: 480, height: 320, url: "api/attachments/att1/image/photo.png" }
            ]
        }));

        expect(result.ok).toBe(true);
        expect(result.document.version).toBe(2);
        expect(result.document.items).toHaveLength(2);
    });

    it("normalizes item geometry", () => {
        const result = parseFreeformDocument(JSON.stringify({
            type: "trilium-freeform",
            version: 1,
            gridVisible: true,
            items: [{ id: "box", type: "richText", x: -5, y: 12, width: 12, height: 50_000, html: "Hello" }]
        }));

        expect(result.ok).toBe(true);
        expect(result.document.items[0]).toMatchObject({ x: 0, y: 12, width: 160, height: 10_000 });
    });

    it("preserves a manually chosen text-box height as its minimum height", () => {
        const result = parseFreeformDocument(JSON.stringify({
            type: "trilium-freeform",
            version: 1,
            gridVisible: false,
            items: [{
                id: "box",
                type: "richText",
                x: 20,
                y: 30,
                width: 360,
                height: 120,
                manualHeight: 240,
                html: "<p>Hello</p>"
            }]
        }));

        expect(result.document.items[0]).toMatchObject({ height: 240, manualHeight: 240 });
    });

    it("calculates an expanding canvas from the furthest content edges", () => {
        const items = [
            {
                id: "first",
                type: "richText" as const,
                x: 100,
                y: 200,
                width: 300,
                height: 120,
                html: "<p>First</p>"
            },
            {
                id: "second",
                type: "richText" as const,
                x: 1800,
                y: 900,
                width: 500,
                height: 260,
                html: "<p>Second</p>"
            }
        ];

        expect(getFreeformCanvasExtent(items)).toEqual({ width: 2492, height: 1352 });
        expect(getFreeformCanvasExtent([])).toEqual({ width: 0, height: 0 });
    });

    it("keeps valid items positioned beyond the initial viewport", () => {
        const result = parseFreeformDocument(JSON.stringify({
            type: "trilium-freeform",
            version: 1,
            gridVisible: false,
            items: [{
                id: "distant",
                type: "richText",
                x: 12_000,
                y: 8_000,
                width: 360,
                height: 180,
                html: "<p>Distant</p>"
            }]
        }));

        expect(result.document.items[0]).toMatchObject({ x: 12_000, y: 8_000 });
    });

    it("accepts attachment-backed images without distorting small or panoramic dimensions", () => {
        const result = parseFreeformDocument(JSON.stringify({
            type: "trilium-freeform",
            version: 2,
            gridVisible: false,
            items: [
                {
                    id: "safe",
                    type: "image",
                    x: 20,
                    y: 30,
                    width: 480,
                    height: 320,
                    url: "api/attachments/att1/image/diagram.png",
                    alt: "Diagram"
                },
                {
                    id: "panorama",
                    type: "image",
                    x: 20,
                    y: 30,
                    width: 480,
                    height: 40,
                    url: "api/attachments/att2/image/panorama.png"
                }
            ]
        }));

        expect(result.ok).toBe(true);
        expect(result.document.items).toHaveLength(2);
        expect(result.document.items[0]).toMatchObject({
            id: "safe",
            type: "image",
            url: "api/attachments/att1/image/diagram.png",
            alt: "Diagram"
        });
        expect(result.document.items[1]).toMatchObject({ width: 480, height: 40 });
    });

    it("rejects unknown or corrupt document formats without exposing their content for editing", () => {
        expect(parseFreeformDocument("not-json").ok).toBe(false);
        expect(parseFreeformDocument(JSON.stringify({ type: "trilium-freeform", version: 3, items: [] })).ok).toBe(false);
        expect(parseFreeformDocument(JSON.stringify({
            type: "trilium-freeform",
            version: 2,
            items: [{ id: "unsafe", type: "image", url: "https://tracker.example/pixel.png" }]
        })).ok).toBe(false);
        expect(parseFreeformDocument(JSON.stringify({
            type: "trilium-freeform",
            version: 2,
            items: [{ id: "same", type: "richText", html: "a" }, { id: "same", type: "richText", html: "b" }]
        })).ok).toBe(false);
    });

    it("duplicates and validates clipboard items", () => {
        const item = {
            id: "original",
            type: "richText" as const,
            x: 20,
            y: 30,
            width: 360,
            height: 180,
            html: "<p>Copied</p>"
        };
        const duplicate = duplicateFreeformItem(item, "copy");
        const parsed = parseFreeformItemClipboard(serializeFreeformItem("note", item));

        expect(duplicate).toMatchObject({ id: "copy", x: 48, y: 58, html: "<p>Copied</p>" });
        expect(parsed).toMatchObject({ sourceNoteId: "note", item });
        expect(parseFreeformItemClipboard("not-json")).toBeNull();
    });
});

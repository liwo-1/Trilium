import { describe, expect, it } from "vitest";

import { createEmptyFreeformDocument, parseFreeformDocument } from "./model";

describe("parseFreeformDocument", () => {
    it("creates an empty document for new notes", () => {
        expect(parseFreeformDocument("")).toEqual({ ok: true, document: createEmptyFreeformDocument() });
    });

    it("normalizes item geometry", () => {
        const result = parseFreeformDocument(JSON.stringify({
            type: "trilium-freeform",
            version: 1,
            gridVisible: true,
            items: [{ id: "box", type: "richText", x: -5, y: 12, width: 12, height: 5000, html: "Hello" }]
        }));

        expect(result.ok).toBe(true);
        expect(result.document.items[0]).toMatchObject({ x: 0, y: 12, width: 160, height: 720 });
    });

    it("rejects unknown or corrupt document formats without exposing their content for editing", () => {
        expect(parseFreeformDocument("not-json").ok).toBe(false);
        expect(parseFreeformDocument(JSON.stringify({ type: "trilium-freeform", version: 2, items: [] })).ok).toBe(false);
    });
});

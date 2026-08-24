import { describe, expect, it } from "vitest";

import {
    collectFreeformAttachmentIds,
    convertFreeformAttachmentToNote,
    extractFreeformText,
    parseFreeformContentDocument,
    rewriteFreeformReferences
} from "./freeform.js";

function documentWithItems(items: unknown[]) {
    return JSON.stringify({ type: "trilium-freeform", version: 2, gridVisible: false, items });
}

describe("Freeform content", () => {
    it("rejects malformed, null and unsupported documents", () => {
        expect(parseFreeformContentDocument("null")).toBeNull();
        expect(parseFreeformContentDocument("not json")).toBeNull();
        expect(parseFreeformContentDocument(JSON.stringify({ type: "trilium-freeform", version: 3, items: [] }))).toBeNull();
    });

    it("collects only typed image and rich-text attribute references", () => {
        const content = documentWithItems([
            { type: "image", url: "api/attachments/image1/image/photo.png" },
            {
                type: "richText",
                html: '<p>api/attachments/prose/image/no.png</p><img src="api/attachments/image2/image/two.png"><a href="#root/note?viewMode=attachments&amp;attachmentId=file1">File</a>'
            }
        ]);

        expect(collectFreeformAttachmentIds(content)).toEqual(new Set([ "image1", "image2", "file1" ]));
    });

    it("rewrites image, file, note and include-note references without changing prose", () => {
        const content = documentWithItems([
            { type: "image", url: "api/attachments/image1/image/photo.png" },
            {
                type: "richText",
                html: '<p>api/attachments/prose/image/no.png</p><img src="api/attachments/image2/image/two.png"><a href="#root/note1?viewMode=attachments&amp;attachmentId=file1">File</a><section class="include-note" data-note-id="note2"></section>'
            }
        ]);
        const rewritten = rewriteFreeformReferences(content, {
            attachmentId: (id) => `new-${id}`,
            noteId: (id) => `new-${id}`
        });
        const parsed = JSON.parse(rewritten);

        expect(parsed.items[0].url).toBe("api/attachments/new-image1/image/photo.png");
        expect(parsed.items[1].html).toContain("api/attachments/prose/image/no.png");
        expect(parsed.items[1].html).toContain('src="api/attachments/new-image2/image/two.png"');
        expect(parsed.items[1].html).toContain("attachmentId=new-file1");
        expect(parsed.items[1].html).toContain("#root/new-note1");
        expect(parsed.items[1].html).toContain('data-note-id="new-note2"');
    });

    it("extracts searchable text from every rich-text item", () => {
        const content = documentWithItems([
            { type: "richText", html: "<p>First <strong>box</strong></p>" },
            { type: "image", url: "api/attachments/image1/image/photo.png" },
            { type: "richText", html: "<p>Second box</p>" }
        ]);

        expect(extractFreeformText(content)).toBe("First box Second box");
    });

    it("converts structured attachment references to a note without touching prose", () => {
        const content = documentWithItems([
            { type: "image", url: "api/attachments/image1/image/photo.png" },
            {
                type: "richText",
                html: '<p>image1</p><img src="api/attachments/image1/image/photo.png"><a href="#root/owner1?viewMode=attachments&amp;attachmentId=image1">File</a>'
            }
        ]);
        const converted = JSON.parse(convertFreeformAttachmentToNote(content, "image1", "note1"));

        expect(converted.items[0].url).toBe("api/images/note1/photo.png");
        expect(converted.items[1].html).toContain('src="api/images/note1/photo.png"');
        expect(converted.items[1].html).toContain('href="#root/note1"');
        expect(converted.items[1].html).toContain("<p>image1</p>");
    });
});

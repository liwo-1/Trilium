import { describe, expect, it } from "vitest";

import {
    commitFreeformHistory,
    commitFreeformHistoryFrom,
    createFreeformHistory,
    redoFreeformHistory,
    replaceFreeformHistoryPresent,
    synchronizeFreeformHistory,
    undoFreeformHistory
} from "./history";
import { applyFreeformItemChanges, createEmptyFreeformDocument, FreeformDocument } from "./model";

describe("freeform history", () => {
    it("undoes and redoes committed canvas changes", () => {
        const empty = createEmptyFreeformDocument();
        const withItem = addTextItem(empty, "box");
        const committed = commitFreeformHistory(createFreeformHistory(empty), withItem);

        const undone = undoFreeformHistory(committed);
        expect(undone.present.items).toHaveLength(0);
        expect(redoFreeformHistory(undone).present).toBe(withItem);
    });

    it("records a drag as one action and preserves later text across structural history", () => {
        const original = addTextItem(createEmptyFreeformDocument(), "box");
        const history = createFreeformHistory(original);
        const moved = updateItem(original, "box", { x: 240 });
        const transient = replaceFreeformHistoryPresent(history, moved);
        const committed = commitFreeformHistoryFrom(transient, original, moved);
        const withText = synchronizeFreeformHistory(
            committed,
            (document) => updateItem(document, "box", { html: "<p>Updated</p>" })
        );

        const undone = undoFreeformHistory(withText);
        expect(undone.present.items[0]).toMatchObject({ x: 80, html: "<p>Updated</p>" });
        expect(redoFreeformHistory(undone).present.items[0]).toMatchObject({ x: 240, html: "<p>Updated</p>" });
    });
});

function addTextItem(document: FreeformDocument, id: string): FreeformDocument {
    return {
        ...document,
        items: [ ...document.items, {
            id,
            type: "richText",
            x: 80,
            y: 80,
            width: 360,
            height: 180,
            html: "<p>Original</p>"
        } ]
    };
}

function updateItem(
    document: FreeformDocument,
    itemId: string,
    changes: Parameters<typeof applyFreeformItemChanges>[1]
): FreeformDocument {
    return {
        ...document,
        items: document.items.map((item) => (
            item.id === itemId ? applyFreeformItemChanges(item, changes) : item
        ))
    };
}

import { FreeformDocument } from "./model";

const HISTORY_LIMIT = 50;

export interface FreeformHistory {
    past: FreeformDocument[];
    present: FreeformDocument;
    future: FreeformDocument[];
}

export function createFreeformHistory(document: FreeformDocument): FreeformHistory {
    return { past: [], present: document, future: [] };
}

export function commitFreeformHistory(
    history: FreeformHistory,
    document: FreeformDocument
): FreeformHistory {
    if (document === history.present) {
        return history;
    }

    return {
        past: [ ...history.past, history.present ].slice(-HISTORY_LIMIT),
        present: document,
        future: []
    };
}

export function replaceFreeformHistoryPresent(
    history: FreeformHistory,
    document: FreeformDocument
): FreeformHistory {
    return { ...history, present: document };
}

export function commitFreeformHistoryFrom(
    history: FreeformHistory,
    previous: FreeformDocument,
    document: FreeformDocument
): FreeformHistory {
    return {
        past: [ ...history.past, previous ].slice(-HISTORY_LIMIT),
        present: document,
        future: []
    };
}

export function synchronizeFreeformHistory(
    history: FreeformHistory,
    updater: (document: FreeformDocument) => FreeformDocument
): FreeformHistory {
    return {
        past: history.past.map(updater),
        present: updater(history.present),
        future: history.future.map(updater)
    };
}

export function undoFreeformHistory(history: FreeformHistory): FreeformHistory {
    const previous = history.past.at(-1);
    if (!previous) {
        return history;
    }

    return {
        past: history.past.slice(0, -1),
        present: previous,
        future: [ history.present, ...history.future ]
    };
}

export function redoFreeformHistory(history: FreeformHistory): FreeformHistory {
    const next = history.future[0];
    if (!next) {
        return history;
    }

    return {
        past: [ ...history.past, history.present ].slice(-HISTORY_LIMIT),
        present: next,
        future: history.future.slice(1)
    };
}

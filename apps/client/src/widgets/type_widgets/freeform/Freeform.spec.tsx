import { type ComponentChildren, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
    createdToolbars: [] as HTMLElement[],
    readOnly: false,
    uploadFreeformImage: vi.fn(),
    removeUploadedFreeformImage: vi.fn(async () => {})
}));

vi.mock("../../../components/app_context", () => ({
    default: { tabManager: { getActiveContext: () => undefined } }
}));
vi.mock("../../../services/content_renderer_text", () => ({ postProcessRichContent: vi.fn(async () => {}) }));
vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));
vi.mock("../../../services/link", () => ({
    default: { getNotePathFromUrl: () => undefined },
    parseNavigationStateFromUrl: () => ({})
}));
vi.mock("../../../services/link_embed", () => ({
    default: {
        detectEmbedType: vi.fn(),
        fetchMetadata: vi.fn(),
        renderEmbedPreview: vi.fn(),
        renderMentionPreview: vi.fn()
    }
}));
vi.mock("../../../services/note_create", () => ({
    default: {
        createNote: vi.fn(),
        createNoteWithTypePrompt: vi.fn()
    }
}));
vi.mock("../../../services/options", () => ({
    default: {
        get: vi.fn(() => ""),
        is: vi.fn(() => false)
    }
}));
vi.mock("../../../services/toast", () => ({ default: { showMessage: vi.fn() } }));
vi.mock("../../../services/utils", () => ({
    default: { formatDateTime: vi.fn(() => "") },
    randomString: vi.fn(() => "generated-item")
}));
vi.mock("../../react/FormFileUpload", async () => {
    const { h } = await import("preact");
    return {
        default: (props: { onChange: (files: File[]) => void }) => h("button", {
            class: "upload-fixture",
            onClick: () => props.onChange([ new File([ "image" ], "diagram.png", { type: "image/png" }) ])
        })
    };
});
vi.mock("../../react/OverlayControlGroup", async () => {
    const { h } = await import("preact");
    return {
        default: (props: { className?: string; children: ComponentChildren }) => h("div", { class: props.className }, props.children),
        OverlayControlButton: (props: { title?: string; onClick?: () => void; disabled?: boolean }) => h("button", {
            "aria-label": props.title,
            disabled: props.disabled,
            onClick: props.onClick
        })
    };
});
vi.mock("../../react/hooks", async () => {
    const { useEffect } = await import("preact/hooks");
    return {
        useEditorSpacedUpdate(options: {
            note: { content: string; noteId: string };
            onContentChange: (content: string) => void;
        }) {
            useEffect(() => options.onContentChange(options.note.content), [ options.note.noteId ]);
            return { scheduleUpdate: vi.fn(), updateNowIfNecessary: vi.fn(async () => {}) };
        },
        useEffectiveReadOnly: () => testState.readOnly,
        useLegacyImperativeHandlers: vi.fn(),
        useNoteLabel: () => [ undefined ],
        useTriliumEvent: vi.fn()
    };
});
vi.mock("../text/snippets", () => ({ useTemplates: () => [] }));
vi.mock("../text/utils", () => ({
    loadIncludedNote: vi.fn(),
    refreshIncludedNote: vi.fn()
}));
vi.mock("./images", () => ({
    uploadFreeformImage: testState.uploadFreeformImage,
    removeUploadedFreeformImage: testState.removeUploadedFreeformImage
}));
vi.mock("../text/CKEditorWithWatchdog", async () => {
    const { h } = await import("preact");
    const { useEffect, useRef } = await import("preact/hooks");

    return {
        default: (props: {
            className: string;
            onEditorInitialized: (editor: unknown) => void;
            watchdogRef: { current?: unknown };
        }) => {
            const editableRef = useRef<HTMLDivElement>(null);
            useEffect(() => {
                let disposed = false;
                queueMicrotask(() => {
                    if (disposed) {
                        return;
                    }

                    const toolbar = document.createElement("div");
                    toolbar.className = "ck ck-toolbar editor-toolbar-fixture";
                    toolbar.append(document.createElement("button"));
                    testState.createdToolbars.push(toolbar);

                    const editor = {
                        editing: { view: { focus: vi.fn() } },
                        getData: vi.fn(() => "<p>Text</p>"),
                        model: { document: { selection: { getSelectedElement: () => undefined } } },
                        once: vi.fn(),
                        setData: vi.fn(),
                        ui: {
                            getEditableElement: () => editableRef.current,
                            view: { toolbar: { element: toolbar } }
                        }
                    };
                    props.watchdogRef.current = { editor };
                    props.onEditorInitialized(editor);
                });

                return () => {
                    disposed = true;
                };
            }, []);

            return h("div", { ref: editableRef, class: props.className });
        }
    };
});

const { default: Freeform } = await import("./Freeform");

interface TestNote {
    content: string;
    isProtected: boolean;
    noteId: string;
    type: "freeform";
}

let container: HTMLDivElement;

beforeEach(() => {
    testState.createdToolbars.length = 0;
    testState.readOnly = false;
    testState.uploadFreeformImage.mockReset();
    testState.removeUploadedFreeformImage.mockClear();
    vi.stubGlobal("$", (element: unknown) => element);
    vi.stubGlobal("ResizeObserver", class {
        observe() {}
        disconnect() {}
    });
    container = document.createElement("div");
    document.body.appendChild(container);
});

afterEach(() => {
    render(null, container);
    container.remove();
    vi.unstubAllGlobals();
});

describe("Freeform editor lifecycle", () => {
    it("keeps the formatting toolbar mounted but inactive away from text boxes", async () => {
        const note = createNote("page-a", [
            { id: "text-a", type: "richText", x: 40, y: 40, width: 300, height: 120, html: "<p>One</p>" },
            { id: "text-b", type: "richText", x: 400, y: 40, width: 300, height: 120, html: "<p>Two</p>" },
            { id: "image-a", type: "image", x: 40, y: 220, width: 200, height: 100, url: "/api/attachments/image1/image/a.png", alt: "A" }
        ]);
        await mount(note);

        const toolbarHost = requireElement(".freeform-formatting-toolbar");
        expect(toolbarHost.classList.contains("inactive")).toBe(true);
        expect(toolbarHost.querySelector(".editor-toolbar-fixture")).not.toBeNull();

        await pointerDown(requireElement(".freeform-item.richText"));
        expect(toolbarHost.classList.contains("inactive")).toBe(false);

        await pointerDown(requireElement(".freeform-surface"));
        expect(toolbarHost.classList.contains("inactive")).toBe(true);
        expect(toolbarHost.querySelector(".editor-toolbar-fixture")).not.toBeNull();

        await pointerDown(requireElement(".freeform-item.image"));
        expect(toolbarHost.classList.contains("inactive")).toBe(true);
        expect(toolbarHost.querySelector(".editor-toolbar-fixture")).not.toBeNull();
    });

    it("replaces the shared toolbar when another text box becomes active", async () => {
        const note = createNote("page-a", [
            { id: "text-a", type: "richText", x: 40, y: 40, width: 300, height: 120, html: "<p>One</p>" },
            { id: "text-b", type: "richText", x: 400, y: 40, width: 300, height: 120, html: "<p>Two</p>" }
        ]);
        await mount(note);
        const items = container.querySelectorAll<HTMLElement>(".freeform-item.richText");
        const firstToolbar = testState.createdToolbars[0];

        await pointerDown(items[1]);

        const toolbarHost = requireElement(".freeform-formatting-toolbar");
        expect(testState.createdToolbars).toHaveLength(2);
        expect(toolbarHost.firstElementChild).toBe(testState.createdToolbars[1]);
        expect(toolbarHost.firstElementChild).not.toBe(firstToolbar);
        expect(toolbarHost.classList.contains("inactive")).toBe(false);
    });

    it("discards an image upload that finishes after navigating to another note", async () => {
        let resolveUpload: (value: { url: string; width: number; height: number; alt: string }) => void = () => {};
        testState.uploadFreeformImage.mockReturnValue(new Promise((resolve) => {
            resolveUpload = resolve;
        }));
        const first = createNote("page-a", []);
        const second = createNote("page-b", []);
        await mount(first);

        await act(async () => requireElement<HTMLButtonElement>(".upload-fixture").click());
        await mount(second);
        await act(async () => resolveUpload({
            url: "/api/attachments/uploaded/image/diagram.png",
            width: 320,
            height: 200,
            alt: "diagram.png"
        }));

        expect(container.querySelector(".freeform-item.image")).toBeNull();
        expect(testState.removeUploadedFreeformImage).toHaveBeenCalledWith("/api/attachments/uploaded/image/diagram.png");
    });

    it("discards an image upload if the note becomes read-only while it is running", async () => {
        let resolveUpload: (value: { url: string; width: number; height: number; alt: string }) => void = () => {};
        testState.uploadFreeformImage.mockReturnValue(new Promise((resolve) => {
            resolveUpload = resolve;
        }));
        const note = createNote("page-a", []);
        await mount(note);

        await act(async () => requireElement<HTMLButtonElement>(".upload-fixture").click());
        testState.readOnly = true;
        await mount(note);
        await act(async () => resolveUpload({
            url: "/api/attachments/uploaded/image/diagram.png",
            width: 320,
            height: 200,
            alt: "diagram.png"
        }));

        expect(container.querySelector(".freeform-item.image")).toBeNull();
        expect(testState.removeUploadedFreeformImage).toHaveBeenCalledWith("/api/attachments/uploaded/image/diagram.png");
    });
});

async function mount(note: TestNote) {
    await act(async () => {
        render(<Freeform {...({ note } as unknown as Parameters<typeof Freeform>[0])} />, container);
    });
    await act(async () => {});
}

function createNote(noteId: string, items: unknown[]): TestNote {
    return {
        noteId,
        type: "freeform",
        isProtected: false,
        content: JSON.stringify({ type: "trilium-freeform", version: 2, gridVisible: false, items })
    };
}

function requireElement<T extends Element = HTMLElement>(selector: string): T {
    const element = container.querySelector<T>(selector);
    if (!element) {
        throw new Error(`Missing test element: ${selector}`);
    }
    return element;
}

async function pointerDown(element: Element) {
    await act(async () => {
        element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));
    });
    await act(async () => {});
}

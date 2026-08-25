import { type ComponentChildren, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
    createdEditors: [] as Array<{
        getData: ReturnType<typeof vi.fn>;
        setData: ReturnType<typeof vi.fn>;
        triggerChange: (html: string) => void;
    }>,
    createdToolbars: [] as HTMLElement[],
    readOnly: false,
    resizeCallbacks: [] as ResizeObserverCallback[],
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
        OverlayControlButton: (props: { className?: string; text?: ComponentChildren; title?: string; onClick?: () => void; disabled?: boolean }) => h("button", {
            "aria-label": props.title,
            class: props.className,
            disabled: props.disabled,
            onClick: props.onClick
        }, props.text)
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
            onChange: () => void;
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

                    let data = "<p>Text</p>";
                    const editor = {
                        editing: { view: { focus: vi.fn() } },
                        getData: vi.fn(() => data),
                        model: { document: { selection: { getSelectedElement: () => undefined } } },
                        once: vi.fn(),
                        setData: vi.fn((html: string) => {
                            data = html;
                        }),
                        triggerChange(html: string) {
                            data = html;
                            props.onChange();
                        },
                        ui: {
                            getEditableElement: () => editableRef.current,
                            view: { toolbar: { element: toolbar } }
                        }
                    };
                    testState.createdEditors.push(editor);
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
    testState.createdEditors.length = 0;
    testState.createdToolbars.length = 0;
    testState.resizeCallbacks.length = 0;
    testState.readOnly = false;
    testState.uploadFreeformImage.mockReset();
    testState.removeUploadedFreeformImage.mockClear();
    vi.stubGlobal("$", (element: unknown) => element);
    vi.stubGlobal("ResizeObserver", class {
        constructor(callback: ResizeObserverCallback) {
            testState.resizeCallbacks.push(callback);
        }

        observe() {}
        disconnect() {}
    });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => (
        window.setTimeout(() => callback(performance.now()), 0)
    ));
    vi.stubGlobal("cancelAnimationFrame", (handle: number) => window.clearTimeout(handle));
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

    it("does not write a new text box's empty content into the previous editor", async () => {
        const note = createNote("page-a", [
            {
                id: "text-a",
                type: "richText",
                x: 40,
                y: 40,
                width: 300,
                height: 120,
                html: "<p>Existing text</p>"
            }
        ]);
        await mount(note);
        const previousEditor = testState.createdEditors[0];
        previousEditor.setData.mockClear();

        await click(requireElement<HTMLButtonElement>('button[aria-label="freeform.add_text"]'));

        expect(previousEditor.setData).not.toHaveBeenCalledWith("<p></p>");
    });

    it("does not write locally emitted rapid typing back into CKEditor", async () => {
        const note = createNote("page-a", [
            { id: "text-a", type: "richText", x: 40, y: 40, width: 300, height: 120, html: "<p></p>" }
        ]);
        await mount(note);
        const editor = testState.createdEditors[0];
        editor.setData.mockClear();

        await act(async () => {
            editor.triggerChange("<p>A</p>");
            editor.triggerChange("<p>AB</p>");
            editor.triggerChange("<p>ABC</p>");
        });

        expect(editor.setData).not.toHaveBeenCalled();
    });

    it("zooms the canvas without scaling the editor toolbar", async () => {
        const note = createNote("page-a", []);
        await mount(note);
        const surface = requireElement<HTMLElement>(".freeform-surface");
        const zoomOut = requireElement<HTMLButtonElement>('button[aria-label="svg.zoom_out"]');
        const zoomIn = requireElement<HTMLButtonElement>('button[aria-label="svg.zoom_in"]');
        const resetZoom = requireElement<HTMLButtonElement>('button[aria-label="svg.reset_zoom"]');

        expect(surface.style.getPropertyValue("--freeform-canvas-zoom")).toBe("1");
        await click(zoomOut);
        expect(surface.style.getPropertyValue("--freeform-canvas-zoom")).toBe("0.75");
        expect(resetZoom.textContent).toBe("75%");
        await click(zoomIn);
        expect(surface.style.getPropertyValue("--freeform-canvas-zoom")).toBe("1");
        await click(zoomIn);
        await click(resetZoom);
        expect(surface.style.getPropertyValue("--freeform-canvas-zoom")).toBe("1");
    });

    it("maps double-click placement through the canvas zoom", async () => {
        const note = createNote("page-a", []);
        await mount(note);
        const zoomOut = requireElement<HTMLButtonElement>('button[aria-label="svg.zoom_out"]');
        await click(zoomOut);
        await click(zoomOut);

        const surface = requireElement<HTMLElement>(".freeform-surface");
        vi.spyOn(surface, "getBoundingClientRect").mockReturnValue({
            bottom: 440,
            height: 400,
            left: 20,
            right: 620,
            top: 40,
            width: 600,
            x: 20,
            y: 40,
            toJSON: () => ({})
        });
        await act(async () => {
            surface.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 220, clientY: 140 }));
        });

        const item = requireElement<HTMLElement>(".freeform-item.richText");
        expect(item.style.getPropertyValue("--freeform-item-x")).toBe("400px");
        expect(item.style.getPropertyValue("--freeform-item-y")).toBe("200px");
    });

    it("maps dragging through the canvas zoom", async () => {
        const note = createNote("page-a", [
            { id: "text-a", type: "richText", x: 40, y: 40, width: 300, height: 120, html: "<p>Move me</p>" }
        ]);
        await mount(note);
        const zoomOut = requireElement<HTMLButtonElement>('button[aria-label="svg.zoom_out"]');
        await click(zoomOut);
        await click(zoomOut);

        const dragHandle = requireElement<HTMLElement>(".freeform-item-drag-handle");
        Object.defineProperty(dragHandle, "setPointerCapture", { value: vi.fn(), configurable: true });
        await act(async () => {
            dragHandle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, clientX: 100, clientY: 100 }));
            dragHandle.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: 150, clientY: 125 }));
        });

        const item = requireElement<HTMLElement>(".freeform-item.richText");
        expect(item.style.getPropertyValue("--freeform-item-x")).toBe("140px");
        expect(item.style.getPropertyValue("--freeform-item-y")).toBe("90px");
    });

    it("grows a text box to the intrinsic width of its longest entered line", async () => {
        const note = createNote("page-a", [
            { id: "text-a", type: "richText", x: 40, y: 40, width: 300, height: 120, html: "<p>Long line</p>" }
        ]);
        await mount(note);

        const probe = requireElement<HTMLElement>(".freeform-item-size-probe");
        const item = requireElement<HTMLElement>(".freeform-item.richText");
        Object.defineProperty(probe, "scrollWidth", { value: 742.2, configurable: true });
        Object.defineProperty(item, "offsetWidth", { value: 302, configurable: true });
        Object.defineProperty(item, "clientWidth", { value: 300, configurable: true });

        await act(async () => {
            for (const callback of testState.resizeCallbacks) {
                callback([], {} as ResizeObserver);
            }
            await new Promise((resolve) => window.setTimeout(resolve, 10));
        });

        expect(item.style.getPropertyValue("--freeform-item-width")).toBe("761px");
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

async function click(element: Element) {
    await act(async () => {
        element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
}

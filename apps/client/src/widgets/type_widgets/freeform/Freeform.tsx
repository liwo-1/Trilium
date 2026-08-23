import DOMPurify from "dompurify";
import type { CKTextEditor, EditorWatchdog, SnippetDefinition } from "@triliumnext/ckeditor5";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import { randomString } from "../../../services/utils";
import OverlayControlGroup, { OverlayControlButton } from "../../react/OverlayControlGroup";
import { useEditorSpacedUpdate, useEffectiveReadOnly, useNoteLabel } from "../../react/hooks";
import { TypeWidgetProps } from "../type_widget";
import CKEditorWithWatchdog, { type CKEditorApi } from "../text/CKEditorWithWatchdog";
import { useTemplates } from "../text/snippets";
import "./Freeform.css";
import {
    createEmptyFreeformDocument,
    FREEFORM_CANVAS_HEIGHT,
    FreeformDocument,
    FreeformItem,
    parseFreeformDocument
} from "./model";

interface DragState {
    itemId: string;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
}

export default function Freeform({ note, noteContext }: TypeWidgetProps) {
    const [ document, setDocument ] = useState<FreeformDocument>();
    const [ selectedItemId, setSelectedItemId ] = useState<string>();
    const [ hasLoadError, setHasLoadError ] = useState(false);
    const documentRef = useRef<FreeformDocument>();
    const dragRef = useRef<DragState>();
    const toolbarContainerRef = useRef<HTMLDivElement>(null);
    const readOnly = useEffectiveReadOnly(note, noteContext);
    const [ language ] = useNoteLabel(note, "language");
    const templates = useTemplates();

    useEffect(() => {
        toolbarContainerRef.current?.replaceChildren();
    }, [ selectedItemId ]);

    const spacedUpdate = useEditorSpacedUpdate({
        note,
        noteContext,
        noteType: "freeform",
        onContentChange(content) {
            const result = parseFreeformDocument(content);
            documentRef.current = result.document;
            setDocument(result.document);
            setHasLoadError(!result.ok);
            setSelectedItemId(undefined);
        },
        getData() {
            if (!documentRef.current || hasLoadError) {
                return undefined;
            }

            return { content: JSON.stringify(documentRef.current) };
        }
    });

    function updateDocument(updater: (current: FreeformDocument) => FreeformDocument) {
        if (readOnly || hasLoadError) {
            return;
        }

        setDocument((current) => {
            if (!current) {
                return current;
            }

            const updated = updater(current);
            documentRef.current = updated;
            spacedUpdate.scheduleUpdate();
            return updated;
        });
    }

    function addTextBox() {
        const current = documentRef.current ?? createEmptyFreeformDocument();
        const offset = (current.items.length % 6) * 28;
        const item: FreeformItem = {
            id: randomString(),
            type: "richText",
            x: 96 + offset,
            y: 96 + offset,
            width: 360,
            height: 180,
            html: "<p></p>"
        };

        updateDocument((document) => ({ ...document, items: [ ...document.items, item ] }));
        setSelectedItemId(item.id);
    }

    function updateItem(itemId: string, changes: Partial<FreeformItem>) {
        updateDocument((document) => ({
            ...document,
            items: document.items.map((item) => item.id === itemId ? { ...item, ...changes } : item)
        }));
    }

    function deleteItem(itemId: string) {
        updateDocument((document) => ({ ...document, items: document.items.filter((item) => item.id !== itemId) }));
        if (selectedItemId === itemId) {
            setSelectedItemId(undefined);
        }
    }

    function startDragging(event: PointerEvent, item: FreeformItem) {
        if (readOnly) {
            return;
        }

        event.preventDefault();
        (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
        dragRef.current = {
            itemId: item.id,
            pointerId: event.pointerId,
            startClientX: event.clientX,
            startClientY: event.clientY,
            startX: item.x,
            startY: item.y
        };
        setSelectedItemId(item.id);
    }

    function continueDragging(event: PointerEvent) {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) {
            return;
        }

        updateItem(drag.itemId, {
            x: Math.max(0, drag.startX + event.clientX - drag.startClientX),
            y: Math.max(0, drag.startY + event.clientY - drag.startClientY)
        });
    }

    function finishDragging(event: PointerEvent) {
        if (dragRef.current?.pointerId === event.pointerId) {
            dragRef.current = undefined;
        }
    }

    function captureWidth(event: PointerEvent, item: FreeformItem) {
        const element = event.currentTarget as HTMLDivElement;
        if (Math.abs(element.offsetWidth - item.width) > 1) {
            updateItem(item.id, { width: element.offsetWidth });
        }
    }

    if (hasLoadError) {
        return <div className="freeform-load-error" role="alert"><span className="bx bx-error-circle" />{t("freeform.invalid_content")}</div>;
    }

    if (!document || !templates) {
        return;
    }

    const canvasHeight = Math.max(
        FREEFORM_CANVAS_HEIGHT,
        ...document.items.map((item) => item.y + item.height + 96)
    );

    function attachFormattingToolbar(editor: CKTextEditor) {
        const toolbar = editor.ui.view.toolbar?.element;
        if (toolbar) {
            toolbarContainerRef.current?.replaceChildren(toolbar);
        }
    }

    return (
        <div className="freeform-note">
            <div className="freeform-topbar">
                {!readOnly && <OverlayControlGroup
                    className="freeform-toolbar"
                    placement="top-start"
                    overCanvas
                >
                    <OverlayControlButton
                        title={t("freeform.add_text")}
                        icon="bx-text"
                        onClick={addTextBox}
                    />
                    <OverlayControlButton
                        title={t("freeform.toggle_grid")}
                        icon="bx-grid-alt"
                        active={document.gridVisible}
                        onClick={() => updateDocument((current) => ({
                            ...current,
                            gridVisible: !current.gridVisible
                        }))}
                    />
                </OverlayControlGroup>}
                <div
                    ref={toolbarContainerRef}
                    className={`freeform-formatting-toolbar ${selectedItemId ? "" : "inactive"}`}
                />
            </div>

            <div
                className={`freeform-surface ${document.gridVisible ? "grid-visible" : ""}`}
                style={{ "--freeform-canvas-height": `${canvasHeight}px` }}
                onPointerDown={(event) => {
                    if (event.target === event.currentTarget) {
                        setSelectedItemId(undefined);
                    }
                }}
            >
                {document.items.length === 0 && <div className="freeform-empty-hint">{t("freeform.empty_hint")}</div>}
                {document.items.map((item) => <div
                    key={item.id}
                    className={`freeform-item ${selectedItemId === item.id ? "selected" : ""}`}
                    style={{
                        "--freeform-item-x": `${item.x}px`,
                        "--freeform-item-y": `${item.y}px`,
                        "--freeform-item-width": `${item.width}px`
                    }}
                    onPointerDown={() => setSelectedItemId(item.id)}
                    onPointerUp={(event) => captureWidth(event, item)}
                >
                    {!readOnly && <div
                        className="freeform-item-drag-handle"
                        aria-hidden="true"
                        onPointerDown={(event) => startDragging(event, item)}
                        onPointerMove={continueDragging}
                        onPointerUp={finishDragging}
                        onPointerCancel={finishDragging}
                    />}
                    {selectedItemId === item.id && !readOnly && <OverlayControlGroup
                        className="freeform-item-actions"
                        placement="top-end"
                        overCanvas
                    >
                        <OverlayControlButton
                            title={t("freeform.delete_selected")}
                            icon="bx-trash"
                            onClick={() => deleteItem(item.id)}
                        />
                    </OverlayControlGroup>}
                    <FreeformTextItem
                        html={item.html}
                        language={language}
                        readOnly={readOnly}
                        selected={selectedItemId === item.id}
                        templates={templates}
                        onChange={(html) => updateItem(item.id, { html })}
                        onEditorInitialized={attachFormattingToolbar}
                        onHeightChange={(height) => {
                            if (Math.abs(height - item.height) > 1) {
                                updateItem(item.id, { height });
                            }
                        }}
                        onSelect={() => setSelectedItemId(item.id)}
                    />
                </div>)}
            </div>
        </div>
    );
}

interface FreeformTextItemProps {
    html: string;
    language: string | null | undefined;
    readOnly: boolean;
    selected: boolean;
    templates: SnippetDefinition[];
    onChange: (html: string) => void;
    onEditorInitialized: (editor: CKTextEditor) => void;
    onHeightChange: (height: number) => void;
    onSelect: () => void;
}

function FreeformTextItem({
    html,
    language,
    readOnly,
    selected,
    templates,
    onChange,
    onEditorInitialized,
    onHeightChange,
    onSelect
}: FreeformTextItemProps) {
    const watchdogRef = useRef<EditorWatchdog>(null);
    const editorApiRef = useRef<CKEditorApi>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const htmlRef = useRef(html);
    const onChangeRef = useRef(onChange);
    const onHeightChangeRef = useRef(onHeightChange);
    onChangeRef.current = onChange;
    onHeightChangeRef.current = onHeightChange;

    const handleChange = useCallback(() => {
        const updatedHtml = watchdogRef.current?.editor?.getData();
        if (updatedHtml === undefined || updatedHtml === htmlRef.current) {
            return;
        }

        htmlRef.current = updatedHtml;
        onChangeRef.current(updatedHtml);
    }, []);

    useEffect(() => {
        const editor = watchdogRef.current?.editor;
        htmlRef.current = html;
        if (editor && editor.getData() !== html) {
            editor.setData(html);
        }
    }, [ html ]);

    useEffect(() => {
        const element = contentRef.current;
        if (!element) {
            return;
        }

        let animationFrame: number | undefined;
        const measure = () => {
            if (animationFrame !== undefined) {
                cancelAnimationFrame(animationFrame);
            }

            animationFrame = requestAnimationFrame(() => {
                animationFrame = undefined;
                onHeightChangeRef.current(Math.ceil(element.scrollHeight));
            });
        };
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        measure();

        return () => {
            observer.disconnect();
            if (animationFrame !== undefined) {
                cancelAnimationFrame(animationFrame);
            }
        };
    }, [ readOnly, selected ]);

    if (!selected || readOnly) {
        return <div
            ref={contentRef}
            className="freeform-item-preview ck-content use-tn-links"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
        />;
    }

    return (
        <div ref={contentRef} className="freeform-item-editor-shell" onFocusCapture={onSelect}>
            <CKEditorWithWatchdog
                className="freeform-item-editor note-detail-editable-text-editor use-tn-links"
                contentLanguage={language}
                editorApi={editorApiRef}
                isClassicEditor
                onChange={handleChange}
                onEditorInitialized={(editor) => {
                    editor.setData(htmlRef.current);
                    enableSelectedElementDeletion(editor);
                    onEditorInitialized(editor);
                }}
                templates={templates}
                watchdogRef={watchdogRef}
            />
        </div>
    );
}

function enableSelectedElementDeletion(editor: CKTextEditor) {
    const editableElement = editor.ui.getEditableElement();
    if (!editableElement) {
        return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "Backspace" && event.key !== "Delete") {
            return;
        }

        const selectedElement = editor.model.document.selection.getSelectedElement();
        if (!selectedElement) {
            return;
        }

        event.preventDefault();
        editor.model.change((writer) => writer.remove(selectedElement));
    };

    editableElement.addEventListener("keydown", handleKeyDown);
    editor.once("destroy", () => editableElement.removeEventListener("keydown", handleKeyDown));
}

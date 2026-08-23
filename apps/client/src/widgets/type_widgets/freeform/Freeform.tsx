import DOMPurify from "dompurify";
import { useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import { randomString } from "../../../services/utils";
import OverlayControlGroup, { OverlayControlButton } from "../../react/OverlayControlGroup";
import { useEditorSpacedUpdate, useEffectiveReadOnly } from "../../react/hooks";
import { TypeWidgetProps } from "../type_widget";
import "./Freeform.css";
import { createEmptyFreeformDocument, FreeformDocument, FreeformItem, parseFreeformDocument } from "./model";

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
    const readOnly = useEffectiveReadOnly(note, noteContext);

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

    function deleteSelectedItem() {
        if (!selectedItemId) {
            return;
        }

        updateDocument((document) => ({ ...document, items: document.items.filter((item) => item.id !== selectedItemId) }));
        setSelectedItemId(undefined);
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

    function captureSize(event: PointerEvent, item: FreeformItem) {
        const element = event.currentTarget as HTMLDivElement;
        if (Math.abs(element.offsetWidth - item.width) > 1 || Math.abs(element.offsetHeight - item.height) > 1) {
            updateItem(item.id, { width: element.offsetWidth, height: element.offsetHeight });
        }
    }

    if (hasLoadError) {
        return <div className="freeform-load-error" role="alert"><span className="bx bx-error-circle" />{t("freeform.invalid_content")}</div>;
    }

    if (!document) {
        return;
    }

    return (
        <div className="freeform-note">
            {!readOnly && <OverlayControlGroup className="freeform-toolbar" placement="top-start" overCanvas>
                <OverlayControlButton title={t("freeform.add_text")} icon="bx-text" onClick={addTextBox} />
                <OverlayControlButton
                    title={t("freeform.toggle_grid")}
                    icon="bx-grid-alt"
                    active={document.gridVisible}
                    onClick={() => updateDocument((current) => ({ ...current, gridVisible: !current.gridVisible }))}
                />
                <OverlayControlButton
                    title={t("freeform.delete_selected")}
                    icon="bx-trash"
                    disabled={!selectedItemId}
                    onClick={deleteSelectedItem}
                />
            </OverlayControlGroup>}

            <div
                className={`freeform-surface ${document.gridVisible ? "grid-visible" : ""}`}
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
                        "--freeform-item-width": `${item.width}px`,
                        "--freeform-item-height": `${item.height}px`
                    }}
                    onPointerDown={() => setSelectedItemId(item.id)}
                    onPointerUp={(event) => captureSize(event, item)}
                >
                    {!readOnly && <div
                        className="freeform-item-drag-handle"
                        aria-hidden="true"
                        onPointerDown={(event) => startDragging(event, item)}
                        onPointerMove={continueDragging}
                        onPointerUp={finishDragging}
                        onPointerCancel={finishDragging}
                    />}
                    <div
                        className="freeform-item-content"
                        contentEditable={!readOnly}
                        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(item.html) }}
                        onInput={(event) => updateItem(item.id, { html: DOMPurify.sanitize(event.currentTarget.innerHTML) })}
                    />
                </div>)}
            </div>
        </div>
    );
}

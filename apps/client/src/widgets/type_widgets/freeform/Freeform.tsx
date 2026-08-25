import DOMPurify from "dompurify";
import type { CKTextEditor, EditorWatchdog, SnippetDefinition } from "@triliumnext/ckeditor5";
import type { RefObject } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import appContext from "../../../components/app_context";
import { postProcessRichContent } from "../../../services/content_renderer_text";
import { t } from "../../../services/i18n";
import link, { parseNavigationStateFromUrl } from "../../../services/link";
import linkEmbedService from "../../../services/link_embed";
import note_create from "../../../services/note_create";
import options from "../../../services/options";
import toast from "../../../services/toast";
import utils, { randomString } from "../../../services/utils";
import FormFileUpload from "../../react/FormFileUpload";
import OverlayControlGroup, { OverlayControlButton } from "../../react/OverlayControlGroup";
import { useEditorSpacedUpdate, useEffectiveReadOnly, useLegacyImperativeHandlers, useNoteLabel, useTriliumEvent } from "../../react/hooks";
import { TypeWidgetProps } from "../type_widget";
import CKEditorWithWatchdog, { type CKEditorApi } from "../text/CKEditorWithWatchdog";
import { useTemplates } from "../text/snippets";
import { loadIncludedNote, refreshIncludedNote } from "../text/utils";
import "./Freeform.css";
import {
    commitFreeformHistory,
    commitFreeformHistoryFrom,
    createFreeformHistory,
    FreeformHistory,
    redoFreeformHistory,
    replaceFreeformHistoryPresent,
    synchronizeFreeformHistory,
    undoFreeformHistory
} from "./history";
import { removeUploadedFreeformImage, type UploadedFreeformImage, uploadFreeformImage } from "./images";
import {
    applyFreeformItemChanges,
    createEmptyFreeformDocument,
    duplicateFreeformItem,
    FREEFORM_CLIPBOARD_MIME,
    FreeformCanvasExtent,
    FreeformDocument,
    FreeformImageItem,
    FreeformItem,
    FreeformItemChanges,
    getFreeformCanvasExtent,
    getFreeformTextAutoWidth,
    parseFreeformDocument,
    parseFreeformItemClipboard,
    serializeFreeformItem
} from "./model";

interface DragState {
    itemId: string;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    zoom: number;
    startDocument: FreeformDocument;
}

type FreeformDocumentUpdateMode = "commit" | "transient" | "synchronize";
const FREEFORM_ZOOM_MIN = 0.25;
const FREEFORM_ZOOM_MAX = 2;
const FREEFORM_ZOOM_STEP = 0.25;

export default function Freeform({ note, noteContext, parentComponent }: TypeWidgetProps) {
    const [ document, setDocument ] = useState<FreeformDocument>();
    const [ selectedItemId, setSelectedItemId ] = useState<string>();
    const [ activeTextItemId, setActiveTextItemId ] = useState<string>();
    const [ canvasExtent, setCanvasExtent ] = useState<FreeformCanvasExtent>({ width: 0, height: 0 });
    const [ zoom, setZoom ] = useState(1);
    const [ hasLoadError, setHasLoadError ] = useState(false);
    const [ isUploadingImage, setIsUploadingImage ] = useState(false);
    const documentRef = useRef<FreeformDocument>();
    const dragRef = useRef<DragState>();
    const historyRef = useRef<FreeformHistory>();
    const imageInputRef = useRef<HTMLInputElement>(null);
    const insertionPointRef = useRef({ x: 96, y: 96 });
    const pendingFocusTextItemIdRef = useRef<string>();
    const resizingItemIdRef = useRef<string>();
    const surfaceRef = useRef<HTMLDivElement>(null);
    const toolbarContainerRef = useRef<HTMLDivElement>(null);
    const activeEditorApiRef = useRef<CKEditorApi>(null);
    const activeWatchdogRef = useRef<EditorWatchdog>(null);
    const uploadGenerationRef = useRef(0);
    const textEditSessionRef = useRef<{ itemId: string; startDocument: FreeformDocument }>();
    const noteIdRef = useRef(note.noteId);
    const readOnly = useEffectiveReadOnly(note, noteContext) || options.is("databaseReadonly");
    const readOnlyRef = useRef(readOnly);
    noteIdRef.current = note.noteId;
    readOnlyRef.current = readOnly;
    const [ language ] = useNoteLabel(note, "language");
    const templates = useTemplates();

    useEffect(() => {
        toolbarContainerRef.current?.replaceChildren();
    }, [ activeTextItemId, readOnly ]);

    useEffect(() => {
        uploadGenerationRef.current += 1;
        setIsUploadingImage(false);
        setZoom(1);
    }, [ note.noteId ]);

    const spacedUpdate = useEditorSpacedUpdate({
        note,
        noteContext,
        noteType: "freeform",
        onContentChange(content) {
            const result = parseFreeformDocument(content);
            documentRef.current = result.document;
            historyRef.current = createFreeformHistory(result.document);
            setDocument(result.document);
            setCanvasExtent(getFreeformCanvasExtent(result.document.items));
            setHasLoadError(!result.ok);
            setSelectedItemId(undefined);
            setActiveTextItemId(result.document.items.find((item) => item.type === "richText")?.id);
            textEditSessionRef.current = undefined;
        },
        getData() {
            if (!documentRef.current || hasLoadError) {
                return undefined;
            }

            return { content: JSON.stringify(documentRef.current) };
        }
    });

    useLegacyImperativeHandlers({
        addLinkToTextCommand() {
            const editorApi = activeEditorApiRef.current;
            if (!editorApi) return;
            parentComponent?.triggerCommand("showAddLinkDialog", {
                text: editorApi.getSelectedText(),
                hasSelection: editorApi.hasSelection(),
                async addLink(notePath, linkTitle, externalLink) {
                    editorApi.addLink(notePath, linkTitle, externalLink);
                }
            });
        },
        pasteMarkdownIntoTextCommand() {
            if (activeEditorApiRef.current) {
                parentComponent?.triggerCommand("showPasteMarkdownDialog", { editorApi: activeEditorApiRef.current });
            }
        },
        insertDateTimeToTextCommand() {
            const dateString = utils.formatDateTime(new Date(), options.get("customDateTimeFormat"));
            const editor = activeWatchdogRef.current?.editor as CKTextEditor | undefined;
            editor?.model.change((writer) => {
                const position = editor.model.document.selection.getLastPosition();
                if (position) {
                    writer.insertText(dateString, position);
                }
            });
        },
        addIncludeNoteToTextCommand() {
            if (activeEditorApiRef.current) {
                parentComponent?.triggerCommand("showIncludeNoteDialog", { editorApi: activeEditorApiRef.current });
            }
        },
        loadIncludedNote,
        async fetchLinkMetadata(url: string) {
            return await linkEmbedService.fetchMetadata(url, noteIdRef.current);
        },
        detectEmbedType(url: string) {
            return linkEmbedService.detectEmbedType(url);
        },
        renderLinkEmbed(container, metadata, editable) {
            linkEmbedService.renderEmbedPreview(container, metadata, editable);
        },
        renderLinkMention(container, metadata, editable) {
            linkEmbedService.renderMentionPreview(container, metadata, editable);
        },
        async createNoteForReferenceLink(title: string) {
            const notePath = noteContext?.notePath;
            if (!notePath) return;
            const response = await note_create.createNoteWithTypePrompt(notePath, { activate: false, title });
            return response?.note?.getBestNotePathString();
        },
        async followLinkUnderCursorCommand() {
            const editor = activeWatchdogRef.current?.editor;
            const selection = editor?.model.document.selection;
            const selectedElement = selection?.getSelectedElement();
            if (selectedElement?.name === "reference") {
                const { notePath } = parseNavigationStateFromUrl(selectedElement.getAttribute("href") as string | undefined);
                if (notePath) {
                    await appContext.tabManager.getActiveContext()?.setNote(notePath);
                    return;
                }
            }
            const selectedLinkUrl = selection?.getAttribute("linkHref");
            if (typeof selectedLinkUrl !== "string") return;
            const notePath = link.getNotePathFromUrl(selectedLinkUrl);
            if (notePath) {
                await appContext.tabManager.getActiveContext()?.setNote(notePath);
            } else {
                window.open(selectedLinkUrl, "_blank");
            }
        },
        async cutIntoNoteCommand() {
            const editor = activeWatchdogRef.current?.editor as CKTextEditor | undefined;
            const parentNotePath = noteContext?.notePath;
            if (!editor || !parentNotePath) return;
            if (!editor.getSelectedHtml()) {
                toast.showMessage(t("editable_text.nothing_selected_to_cut"));
                return;
            }
            void note_create.createNote(parentNotePath, {
                isProtected: note.isProtected,
                saveSelection: true,
                textEditor: editor
            });
        },
        async saveNoteDetailNowCommand() {
            spacedUpdate.updateNowIfNecessary();
        }
    });

    useTriliumEvent("refreshIncludedNote", ({ noteId }) => {
        if (surfaceRef.current) {
            refreshIncludedNote(surfaceRef.current, noteId);
        }
    });

    function updateDocument(
        updater: (current: FreeformDocument) => FreeformDocument,
        mode: FreeformDocumentUpdateMode = "commit"
    ) {
        if (readOnlyRef.current || hasLoadError) {
            return;
        }

        setDocument((current) => {
            if (!current) {
                return current;
            }

            const updated = updater(current);
            documentRef.current = updated;
            expandCanvasToFit(updated.items);
            const history = historyRef.current ?? createFreeformHistory(current);
            if (mode === "commit") {
                historyRef.current = commitFreeformHistory(history, updated);
            } else if (mode === "transient") {
                historyRef.current = replaceFreeformHistoryPresent(history, updated);
            } else {
                historyRef.current = synchronizeFreeformHistory(history, updater);
            }
            spacedUpdate.scheduleUpdate();
            return updated;
        });
    }

    function addTextBox(position?: { x: number; y: number }) {
        commitTextEditingSession();
        const current = documentRef.current ?? createEmptyFreeformDocument();
        const offset = (current.items.length % 6) * 28;
        const item: FreeformItem = {
            id: randomString(),
            type: "richText",
            x: position?.x ?? 96 + offset,
            y: position?.y ?? 96 + offset,
            width: 360,
            height: 180,
            html: "<p></p>"
        };

        pendingFocusTextItemIdRef.current = item.id;
        updateDocument((document) => ({ ...document, items: [ ...document.items, item ] }));
        setSelectedItemId(item.id);
        setActiveTextItemId(item.id);
    }

    function expandCanvasToFit(items: FreeformItem[]) {
        const required = getFreeformCanvasExtent(items);
        setCanvasExtent((current) => ({
            width: Math.max(current.width, required.width),
            height: Math.max(current.height, required.height)
        }));
    }

    async function addImageFiles(files: File[]) {
        if (isUploadingImage || files.length === 0) {
            return;
        }

        setIsUploadingImage(true);
        const sourceNoteId = note.noteId;
        const generation = ++uploadGenerationRef.current;
        try {
            const images: UploadedFreeformImage[] = [];
            for (const file of files) {
                const image = await uploadFreeformImage(sourceNoteId, file);
                if (!image) {
                    continue;
                }

                if (
                    generation !== uploadGenerationRef.current
                    || sourceNoteId !== noteIdRef.current
                    || readOnlyRef.current
                ) {
                    await removeUploadedFreeformImage(image.url);
                    continue;
                }
                images.push(image);
            }
            if (images.length === 0) {
                return;
            }

            if (
                generation !== uploadGenerationRef.current
                || sourceNoteId !== noteIdRef.current
                || readOnlyRef.current
            ) {
                await Promise.all(images.map((image) => removeUploadedFreeformImage(image.url)));
                return;
            }

            const origin = insertionPointRef.current;
            const items: FreeformImageItem[] = images.map((image, index) => ({
                id: randomString(),
                type: "image",
                x: origin.x + index * 28,
                y: origin.y + index * 28,
                ...image
            }));

            updateDocument((document) => ({ ...document, items: [ ...document.items, ...items ] }));
            setSelectedItemId(items.at(-1)?.id);
        } finally {
            if (generation === uploadGenerationRef.current && sourceNoteId === noteIdRef.current) {
                setIsUploadingImage(false);
            }
            if (imageInputRef.current) {
                imageInputRef.current.value = "";
            }
        }
    }

    function handleCanvasCopy(event: ClipboardEvent) {
        if (isEditorEvent(event) || !selectedItemId) {
            return;
        }

        const item = documentRef.current?.items.find((candidate) => candidate.id === selectedItemId);
        if (!item || !event.clipboardData) {
            return;
        }

        event.preventDefault();
        event.clipboardData.setData(FREEFORM_CLIPBOARD_MIME, serializeFreeformItem(note.noteId, item));
    }

    function handleCanvasPaste(event: ClipboardEvent) {
        if (readOnly || isEditorEvent(event)) {
            return;
        }

        const clipboardItem = parseFreeformItemClipboard(
            event.clipboardData?.getData(FREEFORM_CLIPBOARD_MIME) ?? ""
        );
        if (clipboardItem) {
            event.preventDefault();
            duplicateItem(
                clipboardItem.item,
                clipboardItem.sourceNoteId === note.noteId ? undefined : insertionPointRef.current
            );
            return;
        }

        const files = Array.from(event.clipboardData?.files ?? [])
            .filter((file) => file.type.startsWith("image/"));
        if (files.length === 0) {
            return;
        }

        event.preventDefault();
        void addImageFiles(files);
    }

    function updateItem(
        itemId: string,
        changes: FreeformItemChanges,
        mode: FreeformDocumentUpdateMode = "commit"
    ) {
        updateDocument((document) => ({
            ...document,
            items: document.items.map((item) => (
                item.id === itemId ? applyFreeformItemChanges(item, changes) : item
            ))
        }), mode);
    }

    function duplicateItem(source: FreeformItem, position?: { x: number; y: number }) {
        let item = duplicateFreeformItem(source, randomString());
        if (position) {
            item = applyFreeformItemChanges(item, position);
        }
        updateDocument((document) => ({ ...document, items: [ ...document.items, item ] }));
        setSelectedItemId(item.id);
        if (item.type === "richText") {
            setActiveTextItemId(item.id);
        }
        surfaceRef.current?.focus({ preventScroll: true });
    }

    function deleteItem(itemId: string) {
        if (activeTextItemId === itemId) {
            commitTextEditingSession();
            setActiveTextItemId(documentRef.current?.items.find((item) => (
                item.id !== itemId && item.type === "richText"
            ))?.id);
        }
        updateDocument((document) => ({ ...document, items: document.items.filter((item) => item.id !== itemId) }));
        if (selectedItemId === itemId) {
            setSelectedItemId(undefined);
        }
    }

    function restoreHistory(history: FreeformHistory) {
        if (history === historyRef.current) {
            return;
        }

        historyRef.current = history;
        textEditSessionRef.current = undefined;
        documentRef.current = history.present;
        setDocument(history.present);
        expandCanvasToFit(history.present.items);
        setSelectedItemId((current) => (
            history.present.items.some((item) => item.id === current) ? current : undefined
        ));
        setActiveTextItemId((current) => (
            history.present.items.some((item) => item.id === current && item.type === "richText")
                ? current
                : history.present.items.find((item) => item.type === "richText")?.id
        ));
        spacedUpdate.scheduleUpdate();
    }

    function undoCanvasChange() {
        commitTextEditingSession();
        const history = historyRef.current;
        if (history) {
            restoreHistory(undoFreeformHistory(history));
        }
    }

    function redoCanvasChange() {
        commitTextEditingSession();
        const history = historyRef.current;
        if (history) {
            restoreHistory(redoFreeformHistory(history));
        }
    }

    function handleCanvasKeyDown(event: KeyboardEvent) {
        if (isEditorEvent(event)) {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setSelectedItemId(activeTextItemId);
                surfaceRef.current?.focus({ preventScroll: true });
            }
            return;
        }

        if (event.key === "Escape") {
            setSelectedItemId(undefined);
            return;
        }

        if (readOnly) {
            return;
        }

        const modifier = event.ctrlKey || event.metaKey;
        const key = event.key.toLowerCase();
        if (modifier && key === "z") {
            event.preventDefault();
            event.shiftKey ? redoCanvasChange() : undoCanvasChange();
            return;
        }
        if (modifier && key === "y") {
            event.preventDefault();
            redoCanvasChange();
            return;
        }

        const selectedItem = documentRef.current?.items.find((item) => item.id === selectedItemId);
        if (!selectedItem) {
            return;
        }

        if (modifier && key === "d") {
            event.preventDefault();
            duplicateItem(selectedItem);
            return;
        }
        if (event.key === "Delete" || event.key === "Backspace") {
            event.preventDefault();
            deleteItem(selectedItem.id);
            return;
        }

        const step = event.shiftKey ? 10 : 1;
        const movement = getArrowKeyMovement(event.key, step);
        if (movement) {
            event.preventDefault();
            updateItem(selectedItem.id, {
                x: Math.max(0, selectedItem.x + movement.x),
                y: Math.max(0, selectedItem.y + movement.y)
            });
        }
    }

    function startDragging(event: PointerEvent, item: FreeformItem) {
        const startDocument = documentRef.current;
        if (readOnly || !startDocument) {
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
            startY: item.y,
            zoom,
            startDocument
        };
        setSelectedItemId(item.id);
        surfaceRef.current?.focus({ preventScroll: true });
    }

    function updateRichText(itemId: string, html: string) {
        const current = documentRef.current;
        if (!current) {
            return;
        }

        if (textEditSessionRef.current?.itemId !== itemId) {
            commitTextEditingSession();
            textEditSessionRef.current = { itemId, startDocument: current };
        }
        updateItem(itemId, { html }, "synchronize");
    }

    function commitTextEditingSession() {
        const session = textEditSessionRef.current;
        const current = documentRef.current;
        textEditSessionRef.current = undefined;
        if (!session || !current || session.startDocument === current) {
            return;
        }

        const history = historyRef.current ?? createFreeformHistory(session.startDocument);
        historyRef.current = commitFreeformHistoryFrom(history, session.startDocument, current);
    }

    function startImageDragging(event: PointerEvent, item: FreeformImageItem) {
        const target = event.target as Element;
        if (target.closest(".freeform-item-actions, .freeform-item-drag-handle")) {
            return;
        }

        if (!isResizeHandleEvent(event)) {
            startDragging(event, item);
        }
    }

    function continueDragging(event: PointerEvent) {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) {
            return;
        }

        updateItem(drag.itemId, {
            x: Math.max(0, drag.startX + (event.clientX - drag.startClientX) / drag.zoom),
            y: Math.max(0, drag.startY + (event.clientY - drag.startClientY) / drag.zoom)
        }, "transient");
    }

    function finishDragging(event: PointerEvent) {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) {
            return;
        }

        dragRef.current = undefined;
        const current = documentRef.current;
        const previousItem = drag.startDocument.items.find((item) => item.id === drag.itemId);
        const currentItem = current?.items.find((item) => item.id === drag.itemId);
        if (
            current
            && previousItem
            && currentItem
            && (previousItem.x !== currentItem.x || previousItem.y !== currentItem.y)
        ) {
            const history = historyRef.current ?? createFreeformHistory(drag.startDocument);
            historyRef.current = commitFreeformHistoryFrom(history, drag.startDocument, current);
        }
    }

    function captureSize(event: PointerEvent, item: FreeformItem) {
        const element = event.currentTarget as HTMLDivElement;
        const width = element.offsetWidth;

        if (item.type === "image") {
            if (Math.abs(width - item.width) <= 1) {
                return;
            }

            const ratio = item.width > 0 ? item.height / item.width : 1;
            updateItem(item.id, { width, height: Math.max(1, Math.round(width * ratio)) });
        } else {
            const height = element.offsetHeight;
            const widthChanged = Math.abs(width - item.width) > 1;
            const heightChanged = Math.abs(height - item.height) > 1;
            if (widthChanged || heightChanged) {
                updateItem(item.id, {
                    width,
                    height,
                    manualHeight: heightChanged ? height : item.manualHeight
                });
            }
        }
    }

    if (hasLoadError) {
        return <div className="freeform-load-error" role="alert"><span className="bx bx-error-circle" />{t("freeform.invalid_content")}</div>;
    }

    if (!document || !templates) {
        return;
    }

    function attachFormattingToolbar(editor: CKTextEditor, itemId: string) {
        const toolbar = editor.ui.view.toolbar?.element;
        if (toolbar) {
            toolbarContainerRef.current?.replaceChildren(toolbar);
        }

        if (pendingFocusTextItemIdRef.current === itemId) {
            pendingFocusTextItemIdRef.current = undefined;
            editor.editing.view.focus();
        }
    }

    return (
        <div className={`freeform-note ${readOnly ? "read-only" : ""}`}>
            <div className="freeform-topbar">
                {!readOnly && <OverlayControlGroup
                    className="freeform-toolbar"
                    placement="top-start"
                    overCanvas
                >
                    <OverlayControlButton
                        title={t("freeform.add_text")}
                        icon="bx-text"
                        onClick={() => addTextBox()}
                    />
                    <OverlayControlButton
                        title={t("mind-map.add-image")}
                        icon="bx-image-add"
                        disabled={isUploadingImage}
                        onClick={() => imageInputRef.current?.click()}
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
                <FormFileUpload
                    accept="image/*"
                    hidden
                    inputRef={imageInputRef}
                    multiple
                    onChange={(files) => void addImageFiles(Array.from(files ?? []))}
                />
                <div
                    ref={toolbarContainerRef}
                    className={`freeform-formatting-toolbar ${activeTextItemId && activeTextItemId === selectedItemId && !readOnly ? "" : "inactive"}`}
                />
                <OverlayControlGroup
                    className="freeform-zoom-controls"
                    placement="top-end"
                    overCanvas
                >
                    <OverlayControlButton
                        title={t("svg.zoom_out")}
                        icon="bx-minus-circle"
                        disabled={zoom <= FREEFORM_ZOOM_MIN}
                        onClick={() => setZoom((current) => Math.max(FREEFORM_ZOOM_MIN, current - FREEFORM_ZOOM_STEP))}
                    />
                    <OverlayControlButton
                        title={t("svg.reset_zoom")}
                        text={`${Math.round(zoom * 100)}%`}
                        onClick={() => setZoom(1)}
                    />
                    <OverlayControlButton
                        title={t("svg.zoom_in")}
                        icon="bx-plus-circle"
                        disabled={zoom >= FREEFORM_ZOOM_MAX}
                        onClick={() => setZoom((current) => Math.min(FREEFORM_ZOOM_MAX, current + FREEFORM_ZOOM_STEP))}
                    />
                </OverlayControlGroup>
            </div>

            <div
                ref={surfaceRef}
                className={`freeform-surface ${document.gridVisible ? "grid-visible" : ""}`}
                style={{
                    "--freeform-canvas-width": `${Math.max(1, canvasExtent.width)}px`,
                    "--freeform-canvas-height": `${Math.max(1, canvasExtent.height)}px`,
                    "--freeform-canvas-zoom": zoom
                }}
                tabIndex={readOnly ? undefined : 0}
                onCopy={handleCanvasCopy}
                onKeyDownCapture={handleCanvasKeyDown}
                onPaste={handleCanvasPaste}
                onDblClick={(event) => {
                    if (readOnly || event.target !== event.currentTarget) {
                        return;
                    }

                    event.preventDefault();
                    const bounds = event.currentTarget.getBoundingClientRect();
                    addTextBox({
                        x: Math.max(0, (event.clientX - bounds.left) / zoom),
                        y: Math.max(0, (event.clientY - bounds.top) / zoom)
                    });
                }}
                onPointerDown={(event) => {
                    if (event.target === event.currentTarget) {
                        commitTextEditingSession();
                        setSelectedItemId(undefined);
                        const surface = event.currentTarget;
                        const bounds = surface.getBoundingClientRect();
                        insertionPointRef.current = {
                            x: Math.max(0, (event.clientX - bounds.left) / zoom),
                            y: Math.max(0, (event.clientY - bounds.top) / zoom)
                        };
                        surface.focus({ preventScroll: true });
                    }
                }}
            >
                {document.items.length === 0 && <div className="freeform-empty-hint">{t("freeform.empty_hint")}</div>}
                {document.items.map((item) => <div
                    key={item.id}
                    className={`freeform-item ${item.type} ${selectedItemId === item.id ? "selected" : ""}`}
                    style={{
                        "--freeform-item-x": `${item.x}px`,
                        "--freeform-item-y": `${item.y}px`,
                        "--freeform-item-width": `${item.width}px`,
                        "--freeform-item-height": `${item.height}px`,
                        "--freeform-image-aspect-ratio": item.type === "image"
                            ? `${item.width} / ${item.height}`
                            : undefined
                    }}
                    onPointerDown={(event) => {
                        setSelectedItemId(item.id);
                        resizingItemIdRef.current = isResizeHandleEvent(event) ? item.id : undefined;
                        if (item.type === "richText") {
                            if (activeTextItemId !== item.id) {
                                commitTextEditingSession();
                            }
                            setActiveTextItemId(item.id);
                        } else {
                            commitTextEditingSession();
                            startImageDragging(event, item);
                        }
                    }}
                    onPointerMove={item.type === "image" ? continueDragging : undefined}
                    onPointerUp={(event) => {
                        if (item.type === "image") {
                            finishDragging(event);
                        }
                        captureSize(event, item);
                        window.requestAnimationFrame(() => {
                            if (resizingItemIdRef.current === item.id) {
                                resizingItemIdRef.current = undefined;
                            }
                        });
                    }}
                    onPointerCancel={(event) => {
                        if (item.type === "image") {
                            finishDragging(event);
                        }
                        if (resizingItemIdRef.current === item.id) {
                            resizingItemIdRef.current = undefined;
                        }
                    }}
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
                    {item.type === "richText" ? <FreeformTextItem
                        activeWatchdogRef={activeWatchdogRef}
                        editorApiRef={activeEditorApiRef}
                        html={item.html}
                        language={language}
                        note={note}
                        readOnly={readOnly}
                        editing={activeTextItemId === item.id}
                        templates={templates}
                        onChange={(html) => updateRichText(item.id, html)}
                        onEditorInitialized={(editor) => attachFormattingToolbar(editor, item.id)}
                        onWidthChange={(width) => {
                            if (resizingItemIdRef.current === item.id) {
                                return;
                            }

                            const autoWidth = getFreeformTextAutoWidth(item.width, width);
                            if (Math.abs(autoWidth - item.width) > 1) {
                                updateItem(item.id, { width: autoWidth }, "synchronize");
                            }
                        }}
                        onHeightChange={(height) => {
                            if (resizingItemIdRef.current === item.id) {
                                return;
                            }

                            const autoHeight = Math.max(item.manualHeight ?? 80, height);
                            if (Math.abs(autoHeight - item.height) > 1) {
                                updateItem(item.id, { height: autoHeight }, "synchronize");
                            }
                        }}
                        onSelect={() => {
                            setSelectedItemId(item.id);
                            setActiveTextItemId(item.id);
                        }}
                    /> : <img
                        className="freeform-item-image"
                        src={item.url}
                        alt={item.alt}
                        draggable={false}
                    />}
                </div>)}
            </div>
        </div>
    );
}

interface FreeformTextItemProps {
    activeWatchdogRef: RefObject<EditorWatchdog>;
    editorApiRef: RefObject<CKEditorApi>;
    html: string;
    language: string | null | undefined;
    note: TypeWidgetProps["note"];
    readOnly: boolean;
    editing: boolean;
    templates: SnippetDefinition[];
    onChange: (html: string) => void;
    onEditorInitialized: (editor: CKTextEditor) => void;
    onWidthChange: (width: number) => void;
    onHeightChange: (height: number) => void;
    onSelect: () => void;
}

function FreeformTextItem({
    activeWatchdogRef,
    editorApiRef,
    html,
    language,
    note,
    readOnly,
    editing,
    templates,
    onChange,
    onEditorInitialized,
    onWidthChange,
    onHeightChange,
    onSelect
}: FreeformTextItemProps) {
    const contentRef = useRef<HTMLDivElement>(null);
    const itemWatchdogRef = useRef<EditorWatchdog>(null);
    const sizeProbeRef = useRef<HTMLDivElement>(null);
    const htmlRef = useRef(html);
    const pendingLocalHtmlRef = useRef<string[]>([]);
    const onChangeRef = useRef(onChange);
    const onWidthChangeRef = useRef(onWidthChange);
    const onHeightChangeRef = useRef(onHeightChange);
    onChangeRef.current = onChange;
    onWidthChangeRef.current = onWidthChange;
    onHeightChangeRef.current = onHeightChange;

    const handleChange = useCallback(() => {
        const updatedHtml = itemWatchdogRef.current?.editor?.getData();
        if (updatedHtml === undefined || updatedHtml === htmlRef.current) {
            return;
        }

        htmlRef.current = updatedHtml;
        pendingLocalHtmlRef.current.push(updatedHtml);
        onChangeRef.current(updatedHtml);
    }, []);

    useEffect(() => {
        const editor = itemWatchdogRef.current?.editor;
        const pendingLocalHtml = pendingLocalHtmlRef.current;
        const localUpdateIndex = pendingLocalHtml.indexOf(html);
        if (localUpdateIndex >= 0) {
            pendingLocalHtml.splice(0, localUpdateIndex + 1);
            htmlRef.current = editor?.getData() ?? html;
            return;
        }

        pendingLocalHtml.length = 0;
        htmlRef.current = html;
        if (editor && editor.getData() !== html) {
            editor.setData(html);
        }
    }, [ html ]);

    useEffect(() => {
        if (!editing && activeWatchdogRef.current === itemWatchdogRef.current) {
            activeWatchdogRef.current = null;
        }
    }, [ activeWatchdogRef, editing ]);

    useEffect(() => {
        const element = contentRef.current;
        if (editing || !element) {
            return;
        }

        element.innerHTML = DOMPurify.sanitize(html);
        void postProcessRichContent(note, $(element));
    }, [ editing, html, note ]);

    useEffect(() => {
        const element = contentRef.current;
        const sizeProbe = sizeProbeRef.current;
        if (!element || !sizeProbe) {
            return;
        }

        let animationFrame: number | undefined;
        const measure = () => {
            if (animationFrame !== undefined) {
                cancelAnimationFrame(animationFrame);
            }

            animationFrame = requestAnimationFrame(() => {
                animationFrame = undefined;
                const itemElement = element.closest<HTMLElement>(".freeform-item");
                const horizontalChrome = itemElement
                    ? Math.max(0, itemElement.offsetWidth - itemElement.clientWidth)
                    : 0;
                onWidthChangeRef.current(Math.ceil(sizeProbe.scrollWidth + horizontalChrome));
                onHeightChangeRef.current(Math.ceil(element.scrollHeight));
            });
        };
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        observer.observe(sizeProbe);
        measure();

        return () => {
            observer.disconnect();
            if (animationFrame !== undefined) {
                cancelAnimationFrame(animationFrame);
            }
        };
    }, [ editing, readOnly ]);

    if (!editing || readOnly) {
        return <>
            <FreeformTextSizeProbe probeRef={sizeProbeRef} html={html} />
            <div
                ref={contentRef}
                className="freeform-item-preview ck-content use-tn-links"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
            />
        </>;
    }

    return (
        <>
            <FreeformTextSizeProbe probeRef={sizeProbeRef} html={html} />
            <div ref={contentRef} className="freeform-item-editor-shell" onFocusCapture={onSelect}>
                <CKEditorWithWatchdog
                    className="freeform-item-editor note-detail-editable-text-editor use-tn-links"
                    contentLanguage={language}
                    editorApi={editorApiRef}
                    isClassicEditor
                    onChange={handleChange}
                    onEditorInitialized={(editor) => {
                        activeWatchdogRef.current = itemWatchdogRef.current;
                        editor.setData(htmlRef.current);
                        enableSelectedElementDeletion(editor);
                        onEditorInitialized(editor);
                    }}
                    templates={templates}
                    watchdogRef={itemWatchdogRef}
                />
            </div>
        </>
    );
}

function FreeformTextSizeProbe({ probeRef, html }: { probeRef: RefObject<HTMLDivElement>; html: string }) {
    return <div
        ref={probeRef}
        className="freeform-item-size-probe ck-content"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
    />;
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

function isEditorEvent(event: Event) {
    return event.target instanceof Element && Boolean(event.target.closest(".freeform-item-editor"));
}

function isResizeHandleEvent(event: PointerEvent) {
    const element = event.currentTarget as HTMLElement;
    const bounds = element.getBoundingClientRect();
    return bounds.right - event.clientX <= 18 && bounds.bottom - event.clientY <= 18;
}

function getArrowKeyMovement(key: string, step: number) {
    switch (key) {
        case "ArrowLeft":
            return { x: -step, y: 0 };
        case "ArrowRight":
            return { x: step, y: 0 };
        case "ArrowUp":
            return { x: 0, y: -step };
        case "ArrowDown":
            return { x: 0, y: step };
        default:
            return null;
    }
}

import * as Tooltip from "@radix-ui/react-tooltip";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import {
  BackgroundTaskError,
  type BackgroundTask,
  type EditorStore,
  type MapRect,
} from "@tessera/core";
import { FRAGMENT_EXTENSION, PROJECT_EXTENSION } from "@tessera/formats";
import {
  TesseraRenderer,
  type BrushMode,
  type ConnectionPlacement,
  type ConnectionRebindTarget,
  type OverlayPlacement,
  type RendererInteractionRejection,
} from "@tessera/renderer";
import type { ProjectSaveTarget } from "../project-file-workflow.js";
import { createFillRegionWorker } from "../fill-region-worker-adapter.js";
import { AppCommandBar } from "./AppCommandBar.js";
import { CanvasToolRail } from "./CanvasToolRail.js";
import { ContextPanel } from "./ContextPanel.js";
import { EditorStatusBar } from "./EditorStatusBar.js";
import { ElementCatalog, type TextPlacementOptions } from "./ElementCatalog.js";
import { ExportHubDialog } from "./ExportHubDialog.js";
import { PartialProjectBanner } from "./PartialProjectBanner.js";
import styles from "./EditorView.module.css";

type SaveStatusKey =
  "status.saved" | "status.saving" | "status.saveFailed" | "status.unsaved";

export interface EditorViewProps {
  store: EditorStore;
  repository: ProjectSaveTarget;
  onNew(): void;
  onOpenFile(file: File): Promise<void>;
  onOpenFragmentFile(file: File): Promise<void>;
  onOpenPackageSettings?(): void;
  externalErrorKey?: string | null;
  onDismissExternalError?(): void;
}

function alphaColor(value: string): string {
  return `${value.toUpperCase()}FF`;
}

export function EditorView({
  store,
  repository,
  onNew,
  onOpenFile,
  onOpenFragmentFile,
  onOpenPackageSettings = () => undefined,
  externalErrorKey = null,
  onDismissExternalError,
}: EditorViewProps) {
  const { t } = useTranslation();
  const version = useSyncExternalStore(store.subscribe, () => store.version);
  const state = store.state;
  const canvasHost = useRef<HTMLDivElement>(null);
  const renderer = useRef<TesseraRenderer | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);
  const fragmentInput = useRef<HTMLInputElement>(null);
  const dialogPreviousFocus = useRef<HTMLElement | null>(null);
  const fillTaskRef = useRef<BackgroundTask<number> | null>(null);
  const [exportDialog, setExportDialog] = useState<{
    selectionBounds: MapRect | null;
    customBounds: MapRect;
  } | null>(null);
  const [brushColor, setBrushColor] = useState("#E3614D");
  const [brushMode, setBrushMode] = useState<BrushMode>("paint");
  const [edgeColor, setEdgeColor] = useState("#D9B866");
  const [overlay, setOverlay] = useState<OverlayPlacement>({
    type: "marker",
    anchor: "cell",
    markerShape: "pin",
  });
  const [textOptions, setTextOptions] = useState<TextPlacementOptions>({
    text: "",
    fontSize: 18,
    color: "#F4EFE4",
    fontWeight: "normal",
    align: "center",
    rotation: 0,
  });
  const [connection, setConnection] = useState<ConnectionPlacement>({
    kind: "arrow",
    endpoint: "cell-center",
    arrowMode: "end",
    label: "",
  });
  const placementRef = useRef({
    brushColor,
    brushMode,
    edgeColor,
    overlay,
    textOptions,
    connection,
  });
  const [catalogCollapsed, setCatalogCollapsed] = useState(false);
  const [contextPanel, setContextPanel] = useState<
    "properties" | "layers" | "modules" | "map" | null
  >(null);
  const [saveStatusKey, setSaveStatusKey] =
    useState<SaveStatusKey>("status.saved");
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [fillBusy, setFillBusy] = useState(false);
  const [fillProgress, setFillProgress] = useState(0);
  const [rendererContextLost, setRendererContextLost] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [connectionRebind, setConnectionRebind] =
    useState<ConnectionRebindTarget | null>(null);
  const connectionRebindRef = useRef<ConnectionRebindTarget | null>(null);
  connectionRebindRef.current = connectionRebind;

  placementRef.current = {
    brushColor,
    brushMode,
    edgeColor,
    overlay,
    textOptions,
    connection,
  };

  useEffect(() => {
    const host = canvasHost.current;
    if (host === null) return;
    let cancelled = false;
    const startFill = (row: number, column: number, confirmed = false) => {
      try {
        fillTaskRef.current?.cancel();
        const task = store.startFillCells(
          row,
          column,
          alphaColor(placementRef.current.brushColor),
          { confirmed, workerFactory: createFillRegionWorker },
        );
        fillTaskRef.current = task;
        setFillBusy(true);
        setFillProgress(0);
        const unsubscribe = task.subscribeProgress((event) => {
          if (!cancelled && fillTaskRef.current === task) {
            setFillProgress(event.progress);
          }
        });
        void task.result
          .catch((error: unknown) => {
            if (
              cancelled ||
              (error instanceof BackgroundTaskError &&
                error.code === "batch-task-cancelled")
            ) {
              return;
            }
            setErrorKey(
              error instanceof BackgroundTaskError &&
                (error.code === "batch-work-too-large" ||
                  error.code === "batch-history-too-large")
                ? "error.fillTooLarge"
                : "error.fillFailed",
            );
          })
          .finally(() => {
            unsubscribe();
            if (!cancelled && fillTaskRef.current === task) {
              fillTaskRef.current = null;
              setFillBusy(false);
            }
          });
      } catch (error) {
        if (
          error instanceof BackgroundTaskError &&
          error.code === "batch-confirmation-required"
        ) {
          if (window.confirm(t("fill.confirmLarge"))) {
            startFill(row, column, true);
          }
          return;
        }
        setErrorKey("error.fillTooLarge");
      }
    };
    const instance = new TesseraRenderer(
      host,
      store.state,
      {
        getToolState: () => store.toolState,
        beginStroke: () => store.beginBatch(),
        endStroke: () => store.commitBatch(),
        cancelStroke: () => store.cancelBatch(),
        pointerDown: (point, cellId) => store.pointerDown(point, cellId),
        pointerMove: (point) => store.pointerMove(point),
        pointerUp: (point) => store.pointerUp(point),
        paintCell: (row, column) =>
          store.paintCell(
            row,
            column,
            alphaColor(placementRef.current.brushColor),
          ),
        eraseCell: (row, column) => store.eraseCell(row, column),
        fillCells: (row, column) => startFill(row, column),
        getBrushMode: () => placementRef.current.brushMode,
        paintEdge: (edgeId, adjacentCellIds) =>
          store.paintEdge(
            edgeId,
            adjacentCellIds,
            alphaColor(placementRef.current.edgeColor),
          ),
        getOverlayPlacement: () => placementRef.current.overlay,
        placeOverlay: (point, cellId, edge) => {
          const current = placementRef.current;
          const anchor =
            current.overlay.anchor === "map-point"
              ? point
              : current.overlay.anchor === "cell" && cellId !== null
                ? { kind: "cell" as const, cellId }
                : null;
          const style = {
            ...current.textOptions,
            color: alphaColor(current.textOptions.color),
            rotation: current.textOptions.rotation,
          };
          if (current.overlay.anchor === "edge" && edge !== null) {
            const edgeData = {
              instanceId: crypto.randomUUID(),
              ...edge,
              strokeColor: store.state.style.defaultEdgeColor,
              strokeWidth: Math.max(2, store.state.style.gridWidth * 2),
              strokeOpacity: 1,
              lineStyle: "solid" as const,
            };
            if (current.overlay.type === "text") {
              store.placeEdgeText(edgeData, current.textOptions.text, style);
            } else {
              store.placeEdgeMarker(
                edgeData,
                alphaColor(current.brushColor),
                current.overlay.markerShape,
              );
            }
          } else if (anchor !== null) {
            if (current.overlay.type === "text") {
              store.placeText(anchor, current.textOptions.text, style);
            } else {
              store.placeMarker(
                anchor,
                alphaColor(current.brushColor),
                current.overlay.markerShape,
              );
            }
          }
        },
        getConnectionPlacement: () => placementRef.current.connection,
        commitConnection: (start, end, edgeReferences) => {
          const current = placementRef.current.connection;
          return (
            store.commitConnection(
              start,
              end,
              {
                kind: current.kind,
                arrowMode: current.arrowMode,
                label: current.label === "" ? null : current.label,
              },
              edgeReferences,
            ) !== ""
          );
        },
        getConnectionRebind: () => connectionRebindRef.current,
        commitConnectionRebind: (target, cellId) =>
          store.rebindConnectionCellEndpoint(
            target.connectionId,
            target.endpoint,
            cellId,
          ),
        cancelConnectionRebind: () => setConnectionRebind(null),
        operationRejected: (code: RendererInteractionRejection) => {
          const keyByCode = {
            "connection-self-not-allowed": "error.connectionSelf",
            "connection-rebind-target-invalid":
              "error.connectionRebindTargetInvalid",
            "connection-commit-failed": "error.connectionCommitFailed",
          } as const;
          setErrorKey(keyByCode[code]);
        },
        select: (objects, additive) => store.select(objects, additive),
        cancelTool: () => store.cancelTool(),
        contextStatusChanged: (status) => {
          if (status === "lost") fillTaskRef.current?.cancel();
          if (!cancelled) setRendererContextLost(status === "lost");
        },
        zoomChanged: (value) => {
          if (!cancelled) setZoom(value);
        },
      },
      t("canvas.label"),
    );
    void instance.initialize().then(() => {
      if (cancelled) instance.destroy();
      else renderer.current = instance;
    });
    return () => {
      cancelled = true;
      fillTaskRef.current?.cancel();
      fillTaskRef.current = null;
      if (renderer.current === instance) {
        renderer.current = undefined;
        instance.destroy();
      }
    };
  }, [store, t]);

  useEffect(() => {
    if (
      connectionRebind !== null &&
      !store.selection.some(
        (selected) =>
          selected.kind === "connection" &&
          selected.id === connectionRebind.connectionId,
      )
    ) {
      setConnectionRebind(null);
    }
  }, [connectionRebind, store, version]);

  useEffect(() => {
    renderer.current?.render(store.state);
  }, [store, version]);

  useEffect(() => {
    if (version === 0) return;
    setSaveStatusKey("status.unsaved");
    const savingVersion = version;
    const timeout = window.setTimeout(() => {
      setSaveStatusKey("status.saving");
      void repository
        .save(store.state)
        .then(() => {
          setSaveStatusKey(
            store.version === savingVersion ? "status.saved" : "status.unsaved",
          );
        })
        .catch(() => setSaveStatusKey("status.saveFailed"));
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [repository, store, version]);

  const save = async () => {
    const savingVersion = store.version;
    setSaveStatusKey("status.saving");
    try {
      await repository.save(store.state);
      setSaveStatusKey(
        store.version === savingVersion ? "status.saved" : "status.unsaved",
      );
    } catch {
      setSaveStatusKey("status.saveFailed");
    }
  };

  const openExportDialog = async () => {
    dialogPreviousFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const viewport = renderer.current?.getViewportBounds() ?? null;
    const selection = renderer.current?.getSelectionBounds() ?? null;
    try {
      const ranges = await import("../visual-export-range.js");
      const interaction = {
        viewportBounds: viewport,
        selectionBounds: selection,
      };
      const custom = await ranges.resolveVisualExportRangeSnapshot(
        state,
        viewport === null ? { kind: "full-map" } : { kind: "viewport" },
        interaction,
      );
      const clippedSelection =
        selection === null
          ? null
          : (
              await ranges.resolveVisualExportRangeSnapshot(
                state,
                { kind: "selection" },
                interaction,
              )
            ).bounds;
      setExportDialog({
        selectionBounds: clippedSelection,
        customBounds: custom.bounds,
      });
    } catch {
      setErrorKey("error.dataExportSelectionInvalid");
    }
  };

  const closeExportDialog = () => {
    setExportDialog(null);
    queueMicrotask(() => dialogPreviousFocus.current?.focus());
  };

  return (
    <Tooltip.Provider delayDuration={280}>
      <main className={styles.editor}>
        <div ref={canvasHost} className={styles.canvasHost} />
        {rendererContextLost ? (
          <div
            className={styles.contextLost}
            role="alert"
            data-testid="renderer-context-lost"
          >
            {t("renderer.contextLost")}
          </div>
        ) : null}
        <AppCommandBar
          projectName={state.name}
          saveStatusKey={saveStatusKey}
          canUndo={store.canUndo}
          canRedo={store.canRedo}
          onNew={onNew}
          onOpen={() => fileInput.current?.click()}
          onImportFragment={() => fragmentInput.current?.click()}
          onSave={() => void save()}
          onExport={() => void openExportDialog()}
          onPackageSettings={onOpenPackageSettings}
          onUndo={() => store.undo()}
          onRedo={() => store.redo()}
        />
        <input
          ref={fragmentInput}
          className={styles.hiddenInput}
          type="file"
          accept={FRAGMENT_EXTENSION}
          aria-label={t("action.importFragment")}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file !== undefined) void onOpenFragmentFile(file);
          }}
        />
        <PartialProjectBanner source={state.formatSource} />
        <input
          ref={fileInput}
          className={styles.hiddenInput}
          type="file"
          accept={PROJECT_EXTENSION}
          aria-label={t("action.open")}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file !== undefined) void onOpenFile(file);
          }}
        />
        <ElementCatalog
          collapsed={catalogCollapsed}
          onToggle={() => setCatalogCollapsed((value) => !value)}
          brushColor={brushColor}
          brushMode={brushMode}
          edgeColor={edgeColor}
          overlay={overlay}
          textOptions={textOptions}
          connection={connection}
          onBrushColor={setBrushColor}
          onBrushMode={setBrushMode}
          onEdgeColor={setEdgeColor}
          onOverlay={setOverlay}
          onTextOptions={setTextOptions}
          onConnection={setConnection}
          onElementSelect={(elementId) => {
            setConnectionRebind(null);
            if (elementId === "tessera.basic:cell.color")
              store.setTool("brush");
            else if (elementId === "tessera.basic:edge.style")
              store.setTool("edge");
            else if (elementId === "tessera.basic:marker") {
              setOverlay((value) => ({ ...value, type: "marker" }));
              store.setTool("marker");
            } else if (elementId === "tessera.basic:text") {
              setOverlay((value) => ({ ...value, type: "text" }));
              store.setTool("marker");
            } else if (
              elementId === "tessera.basic:connection.line" ||
              elementId === "tessera.basic:connection.arrow"
            ) {
              setConnection((value) => ({
                ...value,
                kind: elementId.endsWith(".line") ? "line" : "arrow",
              }));
              store.setTool("connection");
            }
          }}
        />
        <CanvasToolRail
          tool={store.toolState.tool}
          catalogCollapsed={catalogCollapsed}
          onTool={(nextTool) => {
            setConnectionRebind(null);
            store.setTool(nextTool);
          }}
          onContext={(panel) =>
            setContextPanel((current) => (current === panel ? null : panel))
          }
        />
        {contextPanel !== null && (
          <ContextPanel
            panel={contextPanel}
            state={state}
            selection={store.selection}
            onSelectionColor={(color) =>
              store.updateSelectionColor(alphaColor(color))
            }
            onEdgeStyle={(edgeId, style) =>
              store.updateEdgeStyle(edgeId, style)
            }
            onOverlay={(overlayId, next) =>
              store.updateOverlay(overlayId, next)
            }
            onConnection={(connectionId, next) =>
              store.updateConnection(connectionId, next)
            }
            connectionRebind={connectionRebind}
            onReverseConnection={(connectionId) =>
              store.reverseConnection(connectionId)
            }
            onBeginConnectionRebind={(target) => {
              setConnectionRebind(target);
              setErrorKey(null);
            }}
            onCancelConnectionRebind={() => setConnectionRebind(null)}
            onDeleteSelection={() => store.deleteSelection()}
            onLayerState={(layerId, patch) =>
              store.setLayerState(layerId, patch)
            }
            onClose={() => setContextPanel(null)}
          />
        )}
        <EditorStatusBar
          state={state}
          zoom={zoom}
          onZoomOut={() => renderer.current?.zoomByStep(-1)}
          onZoomIn={() => renderer.current?.zoomByStep(1)}
        />
        {fillBusy && (
          <div className={styles.fillTask} role="status">
            <span>
              {t("fill.running", {
                percent: Math.round(fillProgress * 100),
              })}
            </span>
            <button type="button" onClick={() => fillTaskRef.current?.cancel()}>
              {t("fill.cancel")}
            </button>
          </div>
        )}
        {(errorKey !== null ||
          externalErrorKey !== null ||
          store.operationRejection !== null) && (
          <div
            role="alert"
            className={styles.error}
            onClick={() => {
              setErrorKey(null);
              store.clearOperationRejection();
              onDismissExternalError?.();
            }}
          >
            {store.operationRejection !== null
              ? t(`operation.${store.operationRejection.code}`, {
                  layer: t(
                    `layer.${store.operationRejection.layerId}`,
                    store.operationRejection.layerId,
                  ),
                })
              : t(errorKey ?? externalErrorKey ?? "error.invalidProject")}
          </div>
        )}
        {exportDialog !== null && (
          <ExportHubDialog
            state={state}
            selectionBounds={exportDialog.selectionBounds}
            viewportBounds={exportDialog.customBounds}
            onClose={closeExportDialog}
          />
        )}
      </main>
    </Tooltip.Provider>
  );
}

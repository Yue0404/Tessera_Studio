import * as Tooltip from "@radix-ui/react-tooltip";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslation } from "react-i18next";
import {
  BackgroundTaskError,
  cellId as projectCellId,
  type BackgroundTask,
  type EditorStore,
  type MapRect,
} from "@tessera/core";
import { FRAGMENT_EXTENSION, PROJECT_EXTENSION } from "@tessera/formats";
import type { ParsedExtensionPackage } from "@tessera/module-runtime";
import {
  TesseraRenderer,
  genericModuleResourceKey,
  type BrushMode,
  type ConnectionPlacement,
  type ConnectionRebindTarget,
  type OverlayPlacement,
  type PointerLogicalStatus,
  type RendererInteractionRejection,
} from "@tessera/renderer";
import type { ProjectSaveTarget } from "../project-file-workflow.js";
import type { ProjectModuleResourceRuntime } from "../project-module-resource-runtime.js";
import {
  ActiveProjectModuleError,
  ActiveProjectModuleSession,
  moduleTextContentValid,
} from "../active-project-module-session.js";
import { createFillRegionWorker } from "../fill-region-worker-adapter.js";
import { dispatchEditorShortcut } from "../editor-shortcuts.js";
import {
  downloadSaveRecoveryProject,
  saveFailureTranslationKey,
  type SaveFailureKey,
} from "../save-recovery.js";
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

const EMPTY_PACKAGES: readonly ParsedExtensionPackage[] = [];

export interface EditorViewProps {
  store: EditorStore;
  repository: ProjectSaveTarget;
  packages?: readonly ParsedExtensionPackage[];
  resourceRuntime?: ProjectModuleResourceRuntime;
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
  packages = EMPTY_PACKAGES,
  resourceRuntime,
  onNew,
  onOpenFile,
  onOpenFragmentFile,
  onOpenPackageSettings = () => undefined,
  externalErrorKey = null,
  onDismissExternalError,
}: EditorViewProps) {
  const { t, i18n } = useTranslation();
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
  const [saveFailureKey, setSaveFailureKey] = useState<SaveFailureKey | null>(
    null,
  );
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [fillBusy, setFillBusy] = useState(false);
  const [fillProgress, setFillProgress] = useState(0);
  const [rendererContextLost, setRendererContextLost] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pointerStatus, setPointerStatus] =
    useState<PointerLogicalStatus | null>(null);
  const [connectionRebind, setConnectionRebind] =
    useState<ConnectionRebindTarget | null>(null);
  const connectionRebindRef = useRef<ConnectionRebindTarget | null>(null);
  const activeModuleElementId = useRef<string | null>(null);
  const moduleSession = useMemo(
    () => new ActiveProjectModuleSession(store, packages, i18n.language),
    [i18n.language, packages, store],
  );
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
    let initialized = false;
    let resourceRenderQueued = false;
    let resourceRenderDirty = false;
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
        paintCell: (row, column) => {
          const elementId = activeModuleElementId.current;
          if (
            elementId !== null &&
            moduleSession.get(elementId)?.definition.primitive === "cell-style"
          ) {
            moduleSession.placeCell(
              elementId,
              projectCellId(store.state.grid.type, row, column),
            );
            return;
          }
          store.paintCell(
            row,
            column,
            alphaColor(placementRef.current.brushColor),
          );
        },
        eraseCell: (row, column) => store.eraseCell(row, column),
        fillCells: (row, column) => startFill(row, column),
        getBrushMode: () => placementRef.current.brushMode,
        paintEdge: (edgeId, adjacentCellIds) => {
          const elementId = activeModuleElementId.current;
          if (
            elementId !== null &&
            moduleSession.get(elementId)?.definition.primitive === "edge-style"
          ) {
            moduleSession.placeEdge(elementId, edgeId, adjacentCellIds);
            return;
          }
          store.paintEdge(
            edgeId,
            adjacentCellIds,
            alphaColor(placementRef.current.edgeColor),
          );
        },
        getOverlayPlacement: () => placementRef.current.overlay,
        placeOverlay: (point, cellId, edge) => {
          const current = placementRef.current;
          const moduleElementId = activeModuleElementId.current;
          const moduleElement =
            moduleElementId === null
              ? undefined
              : moduleSession.get(moduleElementId);
          if (
            moduleElementId !== null &&
            (moduleElement?.definition.primitive === "marker" ||
              moduleElement?.definition.primitive === "text")
          ) {
            const target =
              current.overlay.anchor === "map-point"
                ? { kind: "map-point" as const, point }
                : current.overlay.anchor === "cell" && cellId !== null
                  ? { kind: "cell" as const, cellId }
                  : current.overlay.anchor === "edge" && edge !== null
                    ? {
                        kind: "edge" as const,
                        edgeId: edge.edgeId,
                        adjacentCellIds: edge.adjacentCellIds,
                      }
                    : null;
            if (target !== null) {
              try {
                moduleSession.placeOverlay(
                  moduleElementId,
                  target,
                  moduleElement.definition.primitive === "text"
                    ? current.textOptions.text
                    : undefined,
                );
                setErrorKey(null);
              } catch {
                setErrorKey("error.moduleTextInvalid");
              }
            }
            return;
          }
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
          const moduleElementId = activeModuleElementId.current;
          if (
            moduleElementId !== null &&
            moduleSession.get(moduleElementId)?.definition.primitive ===
              "connection"
          ) {
            const withExtensions = (endpoint: typeof start) => ({
              ...endpoint,
              extensions: {},
            });
            moduleSession.placeConnection(
              moduleElementId,
              withExtensions(start),
              withExtensions(end),
              edgeReferences,
              placementRef.current.connection.label,
            );
            return true;
          }
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
        pointerStatusChanged: (value) => {
          if (!cancelled) setPointerStatus(value);
        },
      },
      t("canvas.label"),
      {
        resolve: (instance) => moduleSession.resolveVisual(instance),
        ...(resourceRuntime === undefined
          ? {}
          : {
              resources: {
                resolve: (identity) =>
                  resourceRuntime.resolve(genericModuleResourceKey(identity)),
                request: (identity) => void resourceRuntime.load(identity),
              },
            }),
      },
    );
    const unsubscribeResources = resourceRuntime?.subscribe(() => {
      resourceRenderDirty = true;
      if (resourceRenderQueued) return;
      resourceRenderQueued = true;
      // 同一资源的 loading/ready 连续通知只合并为一次 Pixi 重绘，不触发 React render。
      queueMicrotask(() => {
        resourceRenderQueued = false;
        if (cancelled || !initialized || !resourceRenderDirty) return;
        resourceRenderDirty = false;
        instance.render(store.state);
      });
    });
    void instance.initialize().then(() => {
      if (cancelled) instance.destroy();
      else {
        initialized = true;
        renderer.current = instance;
        if (resourceRenderDirty) {
          resourceRenderDirty = false;
          instance.render(store.state);
        }
      }
    });
    return () => {
      cancelled = true;
      unsubscribeResources?.();
      fillTaskRef.current?.cancel();
      fillTaskRef.current = null;
      if (renderer.current === instance) {
        renderer.current = undefined;
        instance.destroy();
      }
    };
  }, [moduleSession, resourceRuntime, store, t]);

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
          setSaveFailureKey(null);
          setSaveStatusKey(
            store.version === savingVersion ? "status.saved" : "status.unsaved",
          );
        })
        .catch((error: unknown) => {
          setSaveStatusKey("status.saveFailed");
          setSaveFailureKey(saveFailureTranslationKey(error));
        });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [repository, store, version]);

  const save = useCallback(async () => {
    const savingVersion = store.version;
    setSaveStatusKey("status.saving");
    try {
      await repository.save(store.state);
      setSaveFailureKey(null);
      setSaveStatusKey(
        store.version === savingVersion ? "status.saved" : "status.unsaved",
      );
    } catch (error) {
      setSaveStatusKey("status.saveFailed");
      setSaveFailureKey(saveFailureTranslationKey(error));
    }
  }, [repository, store]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      dispatchEditorShortcut(event, {
        select: () => store.setTool("select"),
        pan: () => store.setTool("pan"),
        brush: () => {
          setBrushMode("paint");
          store.setTool("brush");
        },
        fill: () => {
          setBrushMode("fill");
          store.setTool("brush");
        },
        erase: () => {
          setBrushMode("erase");
          store.setTool("brush");
        },
        text: () => {
          setOverlay((value) => ({ ...value, type: "text" }));
          store.setTool("marker");
        },
        undo: () => store.undo(),
        redo: () => store.redo(),
        save: () => void save(),
        deleteSelection: () => store.deleteSelection(),
        cancel: () => {
          setConnectionRebind(null);
          store.cancelTool();
        },
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [save, store]);

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
          elements={moduleSession.elements}
          onBrushColor={setBrushColor}
          onBrushMode={setBrushMode}
          onEdgeColor={setEdgeColor}
          onOverlay={setOverlay}
          onTextOptions={setTextOptions}
          validateText={(value) => {
            const elementId = activeModuleElementId.current;
            const element =
              elementId === null ? undefined : moduleSession.get(elementId);
            return (
              element?.definition.primitive !== "text" ||
              moduleTextContentValid(value)
            );
          }}
          onTextInvalid={() => setErrorKey("error.moduleTextInvalid")}
          onConnection={setConnection}
          onElementSelect={(elementId) => {
            setConnectionRebind(null);
            if (elementId.startsWith("tessera.basic:")) {
              activeModuleElementId.current = null;
            } else {
              const element = moduleSession.get(elementId);
              if (element === undefined || element.disabledReason !== null)
                return;
              if (element.definition.primitive === "domain-object") {
                activeModuleElementId.current = null;
                try {
                  const instanceId = moduleSession.placeDomainGroup(
                    elementId,
                    store.selection
                      .filter((selected) => selected.kind === "cell")
                      .map((selected) => selected.id),
                  );
                  store.select([{ kind: "module-instance", id: instanceId }]);
                  setErrorKey(null);
                } catch (error) {
                  const code =
                    error instanceof ActiveProjectModuleError
                      ? error.code
                      : "domain-group-member-count-invalid";
                  setErrorKey(
                    code === "domain-group-members-disconnected"
                      ? "error.domainGroupDisconnected"
                      : code === "domain-group-member-out-of-bounds"
                        ? "error.domainGroupOutOfBounds"
                        : "error.domainGroupMemberCount",
                  );
                }
                return;
              }
              activeModuleElementId.current = elementId;
              if (element.definition.primitive === "cell-style") {
                setBrushMode("paint");
                store.setTool("brush");
              } else if (
                element.definition.primitive === "marker" ||
                element.definition.primitive === "text"
              ) {
                const overlayType = element.definition.primitive;
                const anchor =
                  element.definition.anchors.includes("cell") ||
                  element.definition.anchors.includes("cell-center")
                    ? "cell"
                    : element.definition.anchors.includes("map-point")
                      ? "map-point"
                      : "edge";
                setOverlay((value) => ({
                  ...value,
                  type: overlayType,
                  anchor,
                }));
                store.setTool("marker");
              } else if (element.definition.primitive === "edge-style") {
                store.setTool("edge");
              } else if (element.definition.primitive === "connection") {
                const endpoint = element.definition.anchors.includes(
                  "cell-center",
                )
                  ? "cell-center"
                  : element.definition.anchors.includes("map-point")
                    ? "map-point"
                    : "edge-midpoint";
                setConnection((value) => ({
                  ...value,
                  kind:
                    element.definition.defaultStyle.arrowStart === true ||
                    element.definition.defaultStyle.arrowEnd === true
                      ? "arrow"
                      : "line",
                  endpoint,
                }));
                store.setTool("connection");
              }
              return;
            }
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
            onModuleInstance={(instanceId, patch) =>
              moduleSession.updateInstance(instanceId, patch)
            }
            onDomainGroupMembers={(instanceId, memberCellIds) =>
              moduleSession.updateDomainGroupMembers(instanceId, memberCellIds)
            }
            moduleRuleHints={store.selection.flatMap((selected) =>
              selected.kind === "module-instance"
                ? moduleSession.ruleHintsForInstance(selected.id)
                : [],
            )}
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
          saveStatusKey={saveStatusKey}
          pointerStatus={pointerStatus}
          onZoomOut={() => renderer.current?.zoomByStep(-1)}
          onZoomIn={() => renderer.current?.zoomByStep(1)}
          onResetZoom={() => renderer.current?.setZoom(1)}
          onCenterMap={() => renderer.current?.centerMap()}
          onFitMap={() => {
            const result = renderer.current?.fitMap();
            if (result?.status === "limited")
              setErrorKey("error.fitMapLimited");
          }}
          onFitContent={() => {
            const result = renderer.current?.fitContent();
            if (result?.status === "empty")
              setErrorKey("error.fitContentEmpty");
          }}
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
        {saveFailureKey !== null ? (
          <div
            className={styles.error}
            role="alert"
            data-testid="save-recovery"
          >
            <span>{t(saveFailureKey)}</span>
            <button
              type="button"
              onClick={() =>
                void downloadSaveRecoveryProject(store.state).catch(() =>
                  setErrorKey("error.dataExportFailed"),
                )
              }
            >
              {t("action.exportRecoveryProject")}
            </button>
          </div>
        ) : null}
        {exportDialog !== null && (
          <ExportHubDialog
            state={state}
            selectionBounds={exportDialog.selectionBounds}
            viewportBounds={exportDialog.customBounds}
            captureOptions={moduleSession.visualExportCaptureOptions(
              resourceRuntime,
            )}
            onClose={closeExportDialog}
          />
        )}
      </main>
    </Tooltip.Provider>
  );
}

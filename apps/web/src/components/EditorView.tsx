import * as Tooltip from "@radix-ui/react-tooltip";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { EditorStore, FillThresholdError } from "@tessera/core";
import {
  parseProjectV1,
  PROJECT_EXTENSION,
  PROJECT_MIME,
  stringifyProjectV1,
} from "@tessera/formats";
import {
  TesseraRenderer,
  type BrushMode,
  type ConnectionPlacement,
  type OverlayPlacement,
} from "@tessera/renderer";
import type { ProjectRepository } from "@tessera/storage";
import { AppCommandBar } from "./AppCommandBar.js";
import { CanvasToolRail } from "./CanvasToolRail.js";
import { ContextPanel } from "./ContextPanel.js";
import { EditorStatusBar } from "./EditorStatusBar.js";
import { ElementCatalog, type TextPlacementOptions } from "./ElementCatalog.js";
import styles from "./EditorView.module.css";

type SaveStatusKey =
  "status.saved" | "status.saving" | "status.saveFailed" | "status.unsaved";

interface Props {
  store: EditorStore;
  repository: ProjectRepository;
  onNew(): void;
  onLoaded(store: EditorStore): void;
}

function alphaColor(value: string): string {
  return `${value.toUpperCase()}FF`;
}

export function EditorView({ store, repository, onNew, onLoaded }: Props) {
  const { t } = useTranslation();
  const version = useSyncExternalStore(store.subscribe, () => store.version);
  const state = store.state;
  const canvasHost = useRef<HTMLDivElement>(null);
  const renderer = useRef<TesseraRenderer | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);
  const [brushColor, setBrushColor] = useState("#E3614D");
  const [brushMode, setBrushMode] = useState<BrushMode>("paint");
  const [edgeColor, setEdgeColor] = useState("#D9B866");
  const [overlay, setOverlay] = useState<OverlayPlacement>({
    type: "marker",
    anchor: "cell",
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
        fillCells: (row, column) => {
          try {
            store.fillCells(
              row,
              column,
              alphaColor(placementRef.current.brushColor),
            );
          } catch (error) {
            if (error instanceof FillThresholdError) {
              setErrorKey("error.fillTooLarge");
              return;
            }
            throw error;
          }
        },
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
            rotation: (current.textOptions.rotation * Math.PI) / 180,
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
              store.placeEdgeMarker(edgeData, alphaColor(current.brushColor));
            }
          } else if (anchor !== null) {
            if (current.overlay.type === "text") {
              store.placeText(anchor, current.textOptions.text, style);
            } else {
              store.placeMarker(anchor, alphaColor(current.brushColor));
            }
          }
        },
        getConnectionPlacement: () => placementRef.current.connection,
        commitConnection: (start, end, edgeReferences) => {
          const current = placementRef.current.connection;
          void store.commitConnection(
            start,
            end,
            {
              kind: current.kind,
              arrowMode: current.arrowMode,
              label: current.label === "" ? null : current.label,
            },
            edgeReferences,
          );
        },
        select: (objects, additive) => store.select(objects, additive),
        cancelTool: () => store.cancelTool(),
      },
      t("canvas.label"),
    );
    void instance.initialize().then(() => {
      if (cancelled) instance.destroy();
      else renderer.current = instance;
    });
    return () => {
      cancelled = true;
      if (renderer.current === instance) {
        renderer.current = undefined;
        instance.destroy();
      }
    };
  }, [store, t]);

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

  const exportProject = () => {
    const blob = new Blob([stringifyProjectV1(store.state)], {
      type: PROJECT_MIME,
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${store.state.name.replaceAll(/[\\/:*?"<>|]/g, "_")}${PROJECT_EXTENSION}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const loadFile = async (file: File | undefined) => {
    if (file === undefined) return;
    try {
      const loaded = new EditorStore(parseProjectV1(await file.text()));
      await repository.save(loaded.state);
      onLoaded(loaded);
    } catch {
      setErrorKey("error.invalidProject");
    }
  };

  return (
    <Tooltip.Provider delayDuration={280}>
      <main className={styles.editor}>
        <div ref={canvasHost} className={styles.canvasHost} />
        <AppCommandBar
          projectName={state.name}
          saveStatusKey={saveStatusKey}
          canUndo={store.canUndo}
          canRedo={store.canRedo}
          onNew={onNew}
          onOpen={() => fileInput.current?.click()}
          onSave={() => void save()}
          onExport={exportProject}
          onUndo={() => store.undo()}
          onRedo={() => store.redo()}
        />
        <input
          ref={fileInput}
          className={styles.hiddenInput}
          type="file"
          accept={PROJECT_EXTENSION}
          aria-label={t("action.open")}
          onChange={(event) => void loadFile(event.target.files?.[0])}
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
        />
        <CanvasToolRail
          tool={store.toolState.tool}
          catalogCollapsed={catalogCollapsed}
          onTool={(nextTool) => store.setTool(nextTool)}
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
            onDeleteSelection={() => store.deleteSelection()}
            onLayerState={(layerId, patch) =>
              store.setLayerState(layerId, patch)
            }
            onClose={() => setContextPanel(null)}
          />
        )}
        <EditorStatusBar state={state} />
        {errorKey !== null && (
          <div
            role="alert"
            className={styles.error}
            onClick={() => setErrorKey(null)}
          >
            {t(errorKey)}
          </div>
        )}
      </main>
    </Tooltip.Provider>
  );
}

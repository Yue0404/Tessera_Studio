import * as Tooltip from "@radix-ui/react-tooltip";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import type { EditorTool } from "@tessera/core";
import { EditorStore } from "@tessera/core";
import {
  parseProjectV1,
  PROJECT_EXTENSION,
  PROJECT_MIME,
  stringifyProjectV1,
} from "@tessera/formats";
import { TesseraRenderer } from "@tessera/renderer";
import type { ProjectRepository } from "@tessera/storage";
import { AppCommandBar } from "./AppCommandBar.js";
import { CanvasToolRail } from "./CanvasToolRail.js";
import { ContextPanel } from "./ContextPanel.js";
import { EditorStatusBar } from "./EditorStatusBar.js";
import { ElementCatalog } from "./ElementCatalog.js";
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
  const [tool, setTool] = useState<EditorTool>("brush");
  const toolRef = useRef(tool);
  const [brushColor, setBrushColor] = useState("#E3614D");
  const brushColorRef = useRef(brushColor);
  const [edgeColor, setEdgeColor] = useState("#D9B866");
  const edgeColorRef = useRef(edgeColor);
  const [catalogCollapsed, setCatalogCollapsed] = useState(false);
  const [contextPanel, setContextPanel] = useState<
    "properties" | "layers" | "modules" | "map" | null
  >(null);
  const [saveStatusKey, setSaveStatusKey] =
    useState<SaveStatusKey>("status.saved");
  const [errorKey, setErrorKey] = useState<string | null>(null);

  toolRef.current = tool;
  brushColorRef.current = brushColor;
  edgeColorRef.current = edgeColor;

  useEffect(() => {
    const host = canvasHost.current;
    if (host === null) return;
    let cancelled = false;
    const instance = new TesseraRenderer(
      host,
      store.state,
      {
        getTool: () => toolRef.current,
        beginStroke: () => store.beginBatch(),
        endStroke: () => store.commitBatch(),
        paintCell: (row, column) =>
          store.paintCell(row, column, alphaColor(brushColorRef.current)),
        paintEdge: (edgeId, adjacentCellIds) =>
          store.paintEdge(
            edgeId,
            adjacentCellIds,
            alphaColor(edgeColorRef.current),
          ),
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
          edgeColor={edgeColor}
          onBrushColor={setBrushColor}
          onEdgeColor={setEdgeColor}
        />
        <CanvasToolRail
          tool={tool}
          catalogCollapsed={catalogCollapsed}
          onTool={setTool}
          onContext={(panel) =>
            setContextPanel((current) => (current === panel ? null : panel))
          }
        />
        {contextPanel !== null && (
          <ContextPanel
            panel={contextPanel}
            state={state}
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

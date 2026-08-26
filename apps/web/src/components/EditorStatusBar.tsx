import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProjectState } from "@tessera/core";
import type { PointerLogicalStatus } from "@tessera/renderer";
import styles from "./EditorStatusBar.module.css";

export function EditorStatusBar({
  state,
  zoom,
  onZoomOut,
  onZoomIn,
  onZoomChange,
  saveStatusKey,
  pointerStatus,
  onResetZoom,
  onCenterMap,
  onFitMap,
  onFitContent,
}: {
  state: Readonly<ProjectState>;
  zoom: number;
  onZoomOut(): void;
  onZoomIn(): void;
  onZoomChange(zoom: number): void;
  saveStatusKey: string;
  pointerStatus: PointerLogicalStatus | null;
  onResetZoom(): void;
  onCenterMap(): void;
  onFitMap(): void;
  onFitContent(): void;
}) {
  const { t } = useTranslation();
  const percent = Math.round(zoom * 100);
  const [zoomDraft, setZoomDraft] = useState(String(percent));
  const editingZoom = useRef(false);

  useEffect(() => {
    if (!editingZoom.current) setZoomDraft(String(percent));
  }, [percent]);

  const commitZoom = () => {
    if (!editingZoom.current) return;
    editingZoom.current = false;
    const parsed = Number(zoomDraft);
    if (!Number.isFinite(parsed) || zoomDraft.trim() === "") {
      setZoomDraft(String(percent));
      return;
    }
    const clamped = Math.min(400, Math.max(25, parsed));
    setZoomDraft(String(clamped));
    onZoomChange(clamped / 100);
  };
  return (
    <div className={styles.status} aria-live="polite">
      <span>
        {t("status.grid")}:{" "}
        {t(state.grid.type === "square" ? "grid.square" : "grid.hexPointy")}
      </span>
      <span data-testid="cell-count">
        {t("status.cells")}: {state.cells.size}
      </span>
      <span data-testid="edge-count">
        {t("status.edges")}: {state.edges.size}
      </span>
      <span data-testid="overlay-count">
        {t("status.overlays")}: {state.overlays.size}
      </span>
      <span data-testid="connection-count">
        {t("status.connections")}: {state.connections.size}
      </span>
      <span data-testid="pointer-status">
        {pointerStatus === null
          ? t("status.pointerEmpty")
          : t("status.pointer", {
              row: pointerStatus.row,
              column: pointerStatus.column,
              kind: t(`object.${pointerStatus.objectKind}`),
            })}
      </span>
      <span data-testid="status-save">{t(saveStatusKey)}</span>
      <div className={styles.zoom} role="group" aria-label={t("zoom.controls")}>
        <button
          type="button"
          title={t("zoom.out")}
          aria-label={t("zoom.out")}
          disabled={zoom <= 0.25}
          onClick={onZoomOut}
        >
          −
        </button>
        <output
          className={styles.zoomLevel}
          data-testid="zoom-level"
          aria-live="polite"
        >
          {t("status.zoom", { percent: Math.round(zoom * 100) })}
        </output>
        <label className={styles.zoomInput}>
          <span>{t("zoom.input")}</span>
          <input
            type="number"
            min={25}
            max={400}
            step={1}
            inputMode="decimal"
            value={zoomDraft}
            aria-label={t("zoom.input")}
            onFocus={() => {
              editingZoom.current = true;
            }}
            onChange={(event) => setZoomDraft(event.target.value)}
            onBlur={commitZoom}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitZoom();
                event.currentTarget.blur();
              } else if (event.key === "Escape") {
                event.preventDefault();
                editingZoom.current = false;
                setZoomDraft(String(percent));
                event.currentTarget.blur();
              }
            }}
          />
          <span aria-hidden="true">%</span>
        </label>
        <button
          type="button"
          title={t("zoom.in")}
          aria-label={t("zoom.in")}
          disabled={zoom >= 4}
          onClick={onZoomIn}
        >
          +
        </button>
        <button type="button" onClick={onResetZoom}>
          {t("zoom.reset")}
        </button>
        <button type="button" onClick={onCenterMap}>
          {t("zoom.center")}
        </button>
        <button type="button" onClick={onFitMap}>
          {t("zoom.fitMap")}
        </button>
        <button type="button" onClick={onFitContent}>
          {t("zoom.fitContent")}
        </button>
      </div>
    </div>
  );
}

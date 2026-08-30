import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw, RotateCw } from "lucide-react";
import type { ProjectState } from "@tessera/core";
import {
  MAX_ROTATION,
  MIN_ROTATION,
  type PointerLogicalStatus,
} from "@tessera/renderer";
import styles from "./EditorStatusBar.module.css";

export function EditorStatusBar({
  state,
  zoom,
  rotation,
  onZoomOut,
  onZoomIn,
  onZoomChange,
  onRotateCounterclockwise,
  onRotateClockwise,
  onRotationChange,
  saveStatusKey,
  pointerStatus,
  onResetZoom,
  onResetRotation,
  onCenterMap,
  onFitMap,
  onFitContent,
}: {
  state: Readonly<ProjectState>;
  zoom: number;
  rotation: number;
  onZoomOut(): void;
  onZoomIn(): void;
  onZoomChange(zoom: number): void;
  onRotateCounterclockwise(): void;
  onRotateClockwise(): void;
  onRotationChange(rotation: number): void;
  saveStatusKey: string;
  pointerStatus: PointerLogicalStatus | null;
  onResetZoom(): void;
  onResetRotation(): void;
  onCenterMap(): void;
  onFitMap(): void;
  onFitContent(): void;
}) {
  const { t } = useTranslation();
  const percent = Math.round(zoom * 100);
  const [zoomDraft, setZoomDraft] = useState(String(percent));
  const [rotationDraft, setRotationDraft] = useState(String(rotation));
  const editingZoom = useRef(false);
  const editingRotation = useRef(false);

  useEffect(() => {
    if (!editingZoom.current) setZoomDraft(String(percent));
  }, [percent]);

  useEffect(() => {
    if (!editingRotation.current) setRotationDraft(String(rotation));
  }, [rotation]);

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

  const commitRotation = () => {
    if (!editingRotation.current) return;
    editingRotation.current = false;
    const parsed = Number(rotationDraft);
    if (!Number.isFinite(parsed) || rotationDraft.trim() === "") {
      setRotationDraft(String(rotation));
      return;
    }
    const clamped = Math.min(MAX_ROTATION, Math.max(MIN_ROTATION, parsed));
    setRotationDraft(String(clamped));
    onRotationChange(clamped);
  };
  return (
    <div className={styles.status} aria-live="polite">
      <span className={styles.metric}>
        {t("status.grid")}:{" "}
        {t(state.grid.type === "square" ? "grid.square" : "grid.hexPointy")}
      </span>
      <span className={styles.metric} data-testid="cell-count">
        {t("status.cells")}: {state.cells.size}
      </span>
      <span className={styles.metric} data-testid="edge-count">
        {t("status.edges")}: {state.edges.size}
      </span>
      <span className={styles.metric} data-testid="overlay-count">
        {t("status.overlays")}: {state.overlays.size}
      </span>
      <span className={styles.metric} data-testid="connection-count">
        {t("status.connections")}: {state.connections.size}
      </span>
      <span className={styles.pointerStatus} data-testid="pointer-status">
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
        <span className={styles.controlDivider} aria-hidden="true" />
        <div
          className={styles.rotation}
          role="group"
          aria-label={t("rotation.controls")}
        >
          <button
            type="button"
            className={styles.iconButton}
            title={t("rotation.counterclockwise")}
            aria-label={t("rotation.counterclockwise")}
            disabled={rotation <= MIN_ROTATION}
            onClick={onRotateCounterclockwise}
          >
            <RotateCcw size={15} aria-hidden="true" />
          </button>
          <label className={styles.rotationInput}>
            <span>{t("rotation.input")}</span>
            <input
              type="number"
              min={MIN_ROTATION}
              max={MAX_ROTATION}
              step="any"
              inputMode="decimal"
              value={rotationDraft}
              aria-label={t("rotation.input")}
              onFocus={() => {
                editingRotation.current = true;
              }}
              onChange={(event) => setRotationDraft(event.target.value)}
              onBlur={commitRotation}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitRotation();
                  event.currentTarget.blur();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  editingRotation.current = false;
                  setRotationDraft(String(rotation));
                  event.currentTarget.blur();
                }
              }}
            />
            <span aria-hidden="true">°</span>
          </label>
          <button
            type="button"
            className={styles.iconButton}
            title={t("rotation.clockwise")}
            aria-label={t("rotation.clockwise")}
            disabled={rotation >= MAX_ROTATION}
            onClick={onRotateClockwise}
          >
            <RotateCw size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={styles.rotationReset}
            title={t("rotation.reset")}
            aria-label={t("rotation.reset")}
            disabled={rotation === 0}
            onClick={onResetRotation}
          >
            0°
          </button>
        </div>
      </div>
    </div>
  );
}

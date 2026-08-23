import { useTranslation } from "react-i18next";
import type { ProjectState } from "@tessera/core";
import styles from "./EditorStatusBar.module.css";

export function EditorStatusBar({
  state,
  zoom,
  onZoomOut,
  onZoomIn,
}: {
  state: Readonly<ProjectState>;
  zoom: number;
  onZoomOut(): void;
  onZoomIn(): void;
}) {
  const { t } = useTranslation();
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
        <output data-testid="zoom-level" aria-live="polite">
          {t("status.zoom", { percent: Math.round(zoom * 100) })}
        </output>
        <button
          type="button"
          title={t("zoom.in")}
          aria-label={t("zoom.in")}
          disabled={zoom >= 4}
          onClick={onZoomIn}
        >
          +
        </button>
      </div>
    </div>
  );
}

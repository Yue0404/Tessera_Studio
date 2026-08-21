import { useTranslation } from "react-i18next";
import type { ProjectState } from "@tessera/core";
import styles from "./EditorStatusBar.module.css";

export function EditorStatusBar({ state }: { state: Readonly<ProjectState> }) {
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
      <span>{t("status.zoom")}</span>
    </div>
  );
}

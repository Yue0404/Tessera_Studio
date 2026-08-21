import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProjectState } from "@tessera/core";
import type { DataExportBounds } from "../data-export-workflow.js";
import { DataExportDialog } from "./DataExportDialog.js";
import { VisualExportDialog } from "./VisualExportDialog.js";
import styles from "./WorkflowDialog.module.css";

interface Props {
  state: Readonly<ProjectState>;
  selectionBounds: DataExportBounds | null;
  viewportBounds: DataExportBounds;
  onClose(): void;
}

export function ExportHubDialog({
  state,
  selectionBounds,
  viewportBounds,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<"data" | "visual" | null>(null);
  if (kind === "data") {
    return (
      <DataExportDialog
        state={state}
        selectionBounds={selectionBounds}
        initialCustomBounds={viewportBounds}
        onClose={onClose}
      />
    );
  }
  if (kind === "visual") {
    return (
      <VisualExportDialog
        state={state}
        interaction={{
          viewportBounds,
          selectionBounds,
        }}
        initialCustomBounds={viewportBounds}
        onClose={onClose}
      />
    );
  }
  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-hub-title"
      >
        <h2 id="export-hub-title">{t("exportHub.title")}</h2>
        <p className={styles.muted}>{t("exportHub.description")}</p>
        <div className={styles.choiceGrid}>
          <button type="button" autoFocus onClick={() => setKind("data")}>
            <strong>{t("exportHub.data")}</strong>
            <span>{t("exportHub.dataDescription")}</span>
          </button>
          <button type="button" onClick={() => setKind("visual")}>
            <strong>{t("exportHub.visual")}</strong>
            <span>{t("exportHub.visualDescription")}</span>
          </button>
        </div>
        <div className={styles.actions}>
          <button type="button" onClick={onClose}>
            {t("action.cancel")}
          </button>
        </div>
      </section>
    </div>
  );
}

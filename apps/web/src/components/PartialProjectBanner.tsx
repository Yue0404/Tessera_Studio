import { useTranslation } from "react-i18next";
import type { ProjectFormatSource } from "@tessera/core";
import styles from "./EditorView.module.css";

interface Props {
  source: ProjectFormatSource;
}

interface PartialLineage {
  readonly sourceProjectId?: unknown;
  readonly omittedLayerIds?: unknown;
}

export function PartialProjectBanner({ source }: Props) {
  const { t } = useTranslation();
  if (source.exportScope !== "partial" && source.isComplete) return null;
  const lineage: PartialLineage =
    typeof source.lineage === "object" && source.lineage !== null
      ? source.lineage
      : {};
  return (
    <aside className={styles.partialBanner} role="status">
      <strong>{t("partialProject.title")}</strong>
      <span>{t("partialProject.description")}</span>
      <small>
        {t("partialProject.source", {
          source:
            typeof lineage.sourceProjectId === "string"
              ? lineage.sourceProjectId
              : t("partialProject.sourceUnknown"),
          omitted: Array.isArray(lineage.omittedLayerIds)
            ? lineage.omittedLayerIds.length
            : 0,
        })}
      </small>
    </aside>
  );
}

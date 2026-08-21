import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ProjectState } from "@tessera/core";
import styles from "./ContextPanel.module.css";

interface Props {
  panel: "properties" | "layers" | "modules" | "map";
  state: Readonly<ProjectState>;
  onClose(): void;
}

export function ContextPanel({ panel, state, onClose }: Props) {
  const { t } = useTranslation();
  const titleKey =
    panel === "properties"
      ? "tool.properties"
      : panel === "layers"
        ? "tool.layers"
        : panel === "modules"
          ? "tool.modules"
          : "tool.mapSettings";
  return (
    <aside className={styles.panel}>
      <header>
        <h2>{t(titleKey)}</h2>
        <button type="button" onClick={onClose} aria-label={t("action.close")}>
          <X size={18} />
        </button>
      </header>
      {panel === "properties" && <p>{t("inspector.help")}</p>}
      {panel === "layers" && (
        <ul>
          {[
            "cell-style",
            "edge-style",
            "placed-object",
            "connection",
            "annotation",
          ].map((layer) => (
            <li key={layer}>
              <span>tessera.basic.{layer}</span>
              <small>
                {layer === "cell-style"
                  ? 500
                  : layer === "edge-style"
                    ? 1500
                    : layer === "placed-object"
                      ? 3000
                      : layer === "connection"
                        ? 4300
                        : 4400}
              </small>
            </li>
          ))}
        </ul>
      )}
      {panel === "modules" && (
        <div className={styles.module}>
          <strong>{t("package.basic.name")}</strong>
          <span>tessera.basic · 1.0.0</span>
          <small>{t("package.status.alwaysEnabled")}</small>
        </div>
      )}
      {panel === "map" && (
        <dl>
          <dt>{t("field.width")}</dt>
          <dd>{state.grid.width}</dd>
          <dt>{t("field.height")}</dt>
          <dd>{state.grid.height}</dd>
          <dt>{t("field.cellSize")}</dt>
          <dd>{state.grid.cellSize}</dd>
        </dl>
      )}
    </aside>
  );
}

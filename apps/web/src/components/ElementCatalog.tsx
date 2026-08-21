import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import styles from "./ElementCatalog.module.css";

interface Props {
  collapsed: boolean;
  onToggle(): void;
  brushColor: string;
  edgeColor: string;
  onBrushColor(color: string): void;
  onEdgeColor(color: string): void;
}

export function ElementCatalog(props: Props) {
  const { t } = useTranslation();
  if (props.collapsed)
    return (
      <button
        className={styles.restore}
        type="button"
        onClick={props.onToggle}
        aria-label={t("catalog.search")}
      >
        <ChevronRight size={19} />
      </button>
    );
  return (
    <aside className={styles.panel}>
      <header>
        <div>
          <strong>{t("package.basic.name")}</strong>
          <small>tessera.basic · 1.0.0</small>
        </div>
        <button
          type="button"
          onClick={props.onToggle}
          aria-label={t("action.close")}
        >
          <ChevronLeft size={18} />
        </button>
      </header>
      <input
        className={styles.search}
        type="search"
        placeholder={t("catalog.search")}
      />
      <section>
        <h2>{t("catalog.cellColors")}</h2>
        <label>
          {t("inspector.fillColor")}
          <input
            type="color"
            value={props.brushColor}
            onChange={(event) => props.onBrushColor(event.target.value)}
          />
        </label>
      </section>
      <section>
        <h2>{t("catalog.edgeStyles")}</h2>
        <label>
          {t("inspector.edgeColor")}
          <input
            type="color"
            value={props.edgeColor}
            onChange={(event) => props.onEdgeColor(event.target.value)}
          />
        </label>
      </section>
      <section className={styles.disabled}>
        <h2>{t("catalog.placedObjects")}</h2>
        <p>{t("catalog.annotations")}</p>
        <p>{t("catalog.connections")}</p>
      </section>
    </aside>
  );
}

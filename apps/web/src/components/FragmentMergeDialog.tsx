import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { FragmentTranslation } from "@tessera/formats";
import type { PreparedFragmentMerge } from "../fragment-file-workflow.js";
import styles from "./WorkflowDialog.module.css";

interface Props {
  prepared: PreparedFragmentMerge;
  busy: boolean;
  errorKey: string | null;
  onTranslate(translation: FragmentTranslation): void;
  onConfirm(): void;
  onCancel(): void;
}

export function FragmentMergeDialog({
  prepared,
  busy,
  errorKey,
  onTranslate,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  const [first, setFirst] = useState(0);
  const [second, setSecond] = useState(0);
  const square = prepared.target.grid.type === "square";
  const plan = prepared.plan;
  const preview = "preview" in plan ? plan.preview : null;
  const translationFixable =
    plan.status === "requires-translation" ||
    (plan.status === "blocked" &&
      plan.code.startsWith("fragment-translation-"));
  const translate = () => {
    onTranslate(
      square
        ? { kind: "square", deltaRow: first, deltaColumn: second }
        : { kind: "hex-pointy", deltaQ: first, deltaR: second },
    );
  };

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) onCancel();
      }}
    >
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fragment-merge-title"
      >
        <h2 id="fragment-merge-title">{t("fragmentMerge.title")}</h2>
        <p>
          {t("fragmentMerge.description", { id: prepared.fragment.fragmentId })}
        </p>
        {preview !== null && (
          <p className={styles.muted}>
            {t("fragmentMerge.preview", {
              cells: preview.objectCounts.cells,
              edges: preview.objectCounts.edges,
              overlays: preview.objectCounts.overlays,
              connections: preview.objectCounts.connections,
            })}
          </p>
        )}
        {translationFixable && (
          <>
            {plan.status === "requires-translation" && (
              <p className={styles.error}>
                {t("fragmentMerge.translationRequired")}
              </p>
            )}
            <div className={styles.rect}>
              <label className={styles.field}>
                {t(square ? "fragmentMerge.deltaRow" : "fragmentMerge.deltaQ")}
                <input
                  autoFocus
                  type="number"
                  step="1"
                  value={first}
                  onChange={(event) => setFirst(Number(event.target.value))}
                />
              </label>
              <label className={styles.field}>
                {t(
                  square ? "fragmentMerge.deltaColumn" : "fragmentMerge.deltaR",
                )}
                <input
                  type="number"
                  step="1"
                  value={second}
                  onChange={(event) => setSecond(Number(event.target.value))}
                />
              </label>
            </div>
          </>
        )}
        {plan.status === "blocked" && (
          <p role="alert" className={styles.error}>
            {t("fragmentMerge.blocked", { code: plan.code })}
          </p>
        )}
        {errorKey !== null && (
          <p role="alert" className={styles.error}>
            {t(errorKey)}
          </p>
        )}
        <div className={styles.actions}>
          <button type="button" disabled={busy} onClick={onCancel}>
            {t("action.cancel")}
          </button>
          {translationFixable && (
            <button
              type="button"
              className={styles.primary}
              disabled={busy}
              onClick={translate}
            >
              {t("fragmentMerge.previewTranslation")}
            </button>
          )}
          {plan.status === "ready" && (
            <button
              type="button"
              className={styles.primary}
              autoFocus
              disabled={busy}
              onClick={onConfirm}
            >
              {t(busy ? "fragmentMerge.saving" : "fragmentMerge.confirm")}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

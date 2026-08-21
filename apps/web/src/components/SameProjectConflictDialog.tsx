import { useTranslation } from "react-i18next";
import type {
  SameProjectIdContext,
  SameProjectIdDecision,
} from "../project-file-workflow.js";
import styles from "./WorkflowDialog.module.css";

interface Props {
  context: SameProjectIdContext;
  confirmingReplace: boolean;
  onBeginReplace(): void;
  onDecision(decision: SameProjectIdDecision): void;
}

export function SameProjectConflictDialog({
  context,
  confirmingReplace,
  onBeginReplace,
  onDecision,
}: Props) {
  const { t } = useTranslation();
  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onKeyDown={(event) => {
        if (event.key === "Escape") onDecision("cancel");
      }}
    >
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="same-project-title"
      >
        <h2 id="same-project-title">{t("projectConflict.title")}</h2>
        <p>
          {t("projectConflict.description", {
            name: context.projectName,
            id: context.projectId,
          })}
        </p>
        {confirmingReplace && (
          <p className={styles.error}>{t("projectConflict.replaceWarning")}</p>
        )}
        <div className={styles.actions}>
          <button type="button" onClick={() => onDecision("cancel")}>
            {t("action.cancel")}
          </button>
          {confirmingReplace ? (
            <>
              <button type="button" onClick={onBeginReplace}>
                {t("action.back")}
              </button>
              <button
                type="button"
                className={styles.danger}
                onClick={() => onDecision("replace")}
              >
                {t("projectConflict.confirmReplace")}
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={onBeginReplace}>
                {t("projectConflict.replace")}
              </button>
              <button
                type="button"
                className={styles.primary}
                autoFocus
                onClick={() => onDecision("copy")}
              >
                {t("projectConflict.copy")}
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

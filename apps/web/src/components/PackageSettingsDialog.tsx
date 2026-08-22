import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LocalPackageRegistration } from "@tessera/storage";
import styles from "./PackageSettingsDialog.module.css";

interface Props {
  readonly registrations: readonly {
    readonly registration: LocalPackageRegistration;
    readonly statusKey: string;
    readonly currentDependency: boolean;
    readonly displayName: string;
    readonly sourceDetails: readonly {
      readonly labelKey: string;
      readonly value: string;
    }[];
    readonly reasonKey: string | null;
  }[];
  readonly busy: boolean;
  readonly errorKey: string | null;
  onImport(file: File): void;
  onDelete(registration: LocalPackageRegistration): void;
  onClose(): void;
}

export function PackageSettingsDialog({
  registrations,
  busy,
  errorKey,
  onImport,
  onDelete,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const previousFocus = useRef(
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const close = () => {
    onClose();
    queueMicrotask(() => previousFocus.current?.focus());
  };
  return (
    <div className={styles.backdrop} role="presentation">
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="package-settings-title"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) close();
        }}
      >
        <h2 id="package-settings-title">{t("package.settings.title")}</h2>
        <p>{t("package.settings.description")}</p>
        <label className={styles.importButton}>
          {t("package.action.import")}
          <input
            type="file"
            accept=".tessera-module.zip,.tessera-preset.zip"
            disabled={busy}
            autoFocus
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file !== undefined) onImport(file);
            }}
          />
        </label>
        {errorKey === null ? null : <p role="alert">{t(errorKey)}</p>}
        <div className={styles.list}>
          {registrations.length === 0 ? (
            <p>{t("package.settings.empty")}</p>
          ) : (
            registrations.map((item) => {
              const registration = item.registration;
              const identityKey =
                registration.identity.kind +
                ":" +
                registration.identity.artifactId +
                "@" +
                registration.identity.version;
              return (
                <article key={identityKey}>
                  <span>
                    <strong>{item.displayName}</strong>
                    <small>
                      {registration.identity.artifactId} ·{" "}
                      {registration.identity.version} ·{" "}
                      {t("package.source." + registration.sourceKind)}
                    </small>
                    {item.sourceDetails.map((detail) => (
                      <small key={detail.labelKey}>
                        {t(detail.labelKey)}：{detail.value}
                      </small>
                    ))}
                  </span>
                  <span>
                    {t(item.statusKey)}
                    {item.reasonKey === null ? null : (
                      <small>{t(item.reasonKey)}</small>
                    )}
                    {item.currentDependency &&
                    confirmingDelete === identityKey ? (
                      <small>{t("package.settings.deleteDependency")}</small>
                    ) : null}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (
                          item.currentDependency &&
                          confirmingDelete !== identityKey
                        ) {
                          setConfirmingDelete(identityKey);
                          return;
                        }
                        setConfirmingDelete(null);
                        onDelete(registration);
                      }}
                    >
                      {t(
                        item.currentDependency &&
                          confirmingDelete === identityKey
                          ? "package.action.confirmDelete"
                          : "package.action.delete",
                      )}
                    </button>
                  </span>
                </article>
              );
            })
          )}
        </div>
        <footer>
          <button type="button" disabled={busy} onClick={close}>
            {t("action.close")}
          </button>
        </footer>
      </section>
    </div>
  );
}

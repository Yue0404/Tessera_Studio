import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LocalPackageRegistration } from "@tessera/storage";
import type { ExtractorRelease } from "../extractor-release-catalog.js";
import styles from "./PackageSettingsDialog.module.css";

export interface Civ6PackageCardModel {
  readonly statusKey: string;
  readonly installedVersions: readonly string[];
  readonly catalogStatus: "loading" | "ready" | "error";
  readonly release: ExtractorRelease | null;
}

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
  readonly civ6: Civ6PackageCardModel;
  onImport(file: File): void;
  onDelete(registration: LocalPackageRegistration): void;
  onClose(): void;
}

export function PackageSettingsDialog({
  registrations,
  busy,
  errorKey,
  civ6,
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
  const packageInput = useRef<HTMLInputElement | null>(null);
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
            ref={packageInput}
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
        <article className={styles.civ6Card}>
          <header>
            <span>
              <strong>{t("package.civ6.name")}</strong>
              <small>{t("package.civ6.optional")}</small>
            </span>
            <strong>
              {t(civ6.statusKey, {
                versions: civ6.installedVersions.join(", "),
              })}
            </strong>
          </header>
          <p>{t("package.civ6.description")}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => packageInput.current?.click()}
          >
            {t("package.civ6.importExisting")}
          </button>
          {civ6.catalogStatus === "loading" ? (
            <p role="status">{t("package.civ6.catalogLoading")}</p>
          ) : civ6.catalogStatus === "error" ? (
            <p role="alert">{t("package.civ6.catalogFailed")}</p>
          ) : civ6.release === null ? (
            <p>{t("package.civ6.releaseUnavailable")}</p>
          ) : (
            <section className={styles.releaseDetails}>
              <strong>{t("package.civ6.releaseAvailable")}</strong>
              <small>
                {t("package.civ6.extractorVersion", {
                  version: civ6.release.version,
                })}
              </small>
              <small>{t("package.civ6.platform.windowsX64")}</small>
              <small>
                {t("package.civ6.minOsBuild", {
                  build: civ6.release.minOsBuild,
                })}
              </small>
              <small>
                {t("package.civ6.releaseBytes", {
                  bytes: civ6.release.bytes.toLocaleString("zh-CN"),
                })}
              </small>
              <small className={styles.hash}>
                {t("package.civ6.releaseSha256", {
                  sha256: civ6.release.sha256,
                })}
              </small>
              <small>{t("package.civ6.unsignedWarning")}</small>
              <a
                href={civ6.release.assetUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("package.civ6.downloadExtractor")}
              </a>
            </section>
          )}
        </article>
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

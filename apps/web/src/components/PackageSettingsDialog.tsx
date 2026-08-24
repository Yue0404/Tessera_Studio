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
    readonly projectEnabled: boolean;
    readonly canToggleProjectModule: boolean;
    readonly canDeleteLocalPackage: boolean;
    readonly referenceCount: number;
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
  onEnableModule(registration: LocalPackageRegistration): void;
  onDisableModule(registration: LocalPackageRegistration): void;
  onDelete(registration: LocalPackageRegistration): void;
  onClose(): void;
}

export function PackageSettingsDialog({
  registrations,
  busy,
  errorKey,
  civ6,
  onImport,
  onEnableModule,
  onDisableModule,
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
  const [blockedDisable, setBlockedDisable] = useState<string | null>(null);
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
            className={styles.actionButton}
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
                    {registration.identity.kind === "module" ? (
                      <small>
                        {t(
                          registration.identity.artifactId === "tessera.basic"
                            ? "package.status.alwaysEnabled"
                            : item.projectEnabled
                              ? "package.project.enabled"
                              : "package.project.disabled",
                        )}
                      </small>
                    ) : null}
                    {item.reasonKey === null ? null : (
                      <small>{t(item.reasonKey)}</small>
                    )}
                    {item.projectEnabled && confirmingDelete === identityKey ? (
                      <small>
                        {t("package.settings.deleteDependency", {
                          count: item.referenceCount,
                        })}
                      </small>
                    ) : null}
                    {blockedDisable === identityKey ? (
                      <small>
                        {t("package.settings.disableBlocked", {
                          count: item.referenceCount,
                        })}
                      </small>
                    ) : null}
                    {registration.identity.kind === "module" &&
                    registration.identity.artifactId !== "tessera.basic" ? (
                      <button
                        type="button"
                        disabled={busy || !item.canToggleProjectModule}
                        onClick={() => {
                          setConfirmingDelete(null);
                          if (item.projectEnabled && item.referenceCount > 0) {
                            setBlockedDisable(identityKey);
                            return;
                          }
                          setBlockedDisable(null);
                          if (item.projectEnabled) {
                            onDisableModule(registration);
                          } else {
                            onEnableModule(registration);
                          }
                        }}
                      >
                        {t(
                          item.projectEnabled
                            ? "package.action.disableForProject"
                            : "package.action.enableForProject",
                        )}
                      </button>
                    ) : null}
                    {blockedDisable === identityKey ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setBlockedDisable(null)}
                      >
                        {t("action.cancel")}
                      </button>
                    ) : null}
                    {item.canDeleteLocalPackage ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          if (
                            item.projectEnabled &&
                            confirmingDelete !== identityKey
                          ) {
                            setBlockedDisable(null);
                            setConfirmingDelete(identityKey);
                            return;
                          }
                          setConfirmingDelete(null);
                          onDelete(registration);
                        }}
                      >
                        {t(
                          item.projectEnabled &&
                            confirmingDelete === identityKey
                            ? "package.action.confirmDelete"
                            : "package.action.delete",
                        )}
                      </button>
                    ) : null}
                    {item.canDeleteLocalPackage &&
                    item.projectEnabled &&
                    confirmingDelete === identityKey ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setConfirmingDelete(null)}
                      >
                        {t("action.cancel")}
                      </button>
                    ) : null}
                  </span>
                </article>
              );
            })
          )}
        </div>
        <footer>
          <button
            className={styles.actionButton}
            type="button"
            disabled={busy}
            onClick={close}
          >
            {t("action.close")}
          </button>
        </footer>
      </section>
    </div>
  );
}

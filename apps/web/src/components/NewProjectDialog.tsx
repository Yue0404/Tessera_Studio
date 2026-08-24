import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  BASIC_MODULE,
  OPTIONAL_PACKAGE_PLACEHOLDERS,
  packageSupportsGrid,
  type PackageChoice,
} from "@tessera/module-runtime";
import { createProject, type GridType, type ProjectState } from "@tessera/core";
import type { InstalledPresetAvailability } from "../package-project-runtime.js";
import { ProjectGridPreview } from "./ProjectGridPreview.js";
import styles from "./NewProjectDialog.module.css";

interface Props {
  onCreate(
    project: ProjectState,
    packageSelection?: {
      readonly presetIdentity?: string;
      readonly moduleIdentities: readonly string[];
    },
  ): void;
  onCancel?: (() => void) | undefined;
  onOpenFile?: ((file: File) => Promise<void>) | undefined;
  externalErrorKey?: string | null | undefined;
  onDismissExternalError?: (() => void) | undefined;
  optionalPackages?: readonly PackageChoice[] | undefined;
  installedPresets?:
    | readonly {
        readonly identity: string;
        readonly label: string;
        readonly statusKey?: string;
        readonly supportedGrids: readonly GridType[];
        readonly availabilityByGrid?: Readonly<
          Partial<Record<GridType, InstalledPresetAvailability>>
        >;
      }[]
    | undefined;
  installedModules?:
    | readonly {
        readonly identity: string;
        readonly label: string;
        readonly statusKey: string;
        readonly supportedGrids: readonly GridType[];
      }[]
    | undefined;
  onOpenPackageSettings?: (() => void) | undefined;
  busy?: boolean | undefined;
}

function withAlpha(color: string): string {
  return `${color.toUpperCase()}FF`;
}

export function NewProjectDialog({
  onCreate,
  onCancel,
  onOpenFile,
  externalErrorKey = null,
  onDismissExternalError,
  optionalPackages = OPTIONAL_PACKAGE_PLACEHOLDERS,
  installedPresets = [],
  installedModules = [],
  onOpenPackageSettings,
  busy = false,
}: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [gridType, setGridType] = useState<GridType>("hex-pointy");
  const [width, setWidth] = useState("30");
  const [height, setHeight] = useState("20");
  const [cellSize, setCellSize] = useState("36");
  const [background, setBackground] = useState("#0D2635");
  const [cellColor, setCellColor] = useState("#14232D");
  const [gridColor, setGridColor] = useState("#59656A");
  const [gridOpacity, setGridOpacity] = useState("0.7");
  const [gridWidth, setGridWidth] = useState("1");
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [packageSetup, setPackageSetup] = useState<string | null>(null);
  const [selectedPreset, setSelectedPreset] = useState("");
  const [selectedInstalledModules, setSelectedInstalledModules] = useState<
    ReadonlySet<string>
  >(new Set());
  const selectedPresetEntry = installedPresets.find(
    (item) => item.identity === selectedPreset,
  );
  const selectedPresetAvailable =
    selectedPreset === "" ||
    (selectedPresetEntry?.supportedGrids.includes(gridType) === true &&
      (selectedPresetEntry.availabilityByGrid?.[gridType] ?? "available") ===
        "available");

  useEffect(() => {
    if (
      selectedPreset !== "" &&
      !installedPresets
        .find((item) => item.identity === selectedPreset)
        ?.supportedGrids.includes(gridType)
    ) {
      setSelectedPreset("");
    }
    setSelectedInstalledModules((current) => {
      const retained = [...current].filter((identity) =>
        installedModules
          .find((item) => item.identity === identity)
          ?.supportedGrids.includes(gridType),
      );
      if (
        retained.length === current.size &&
        retained.every((identity) => current.has(identity))
      ) {
        return current;
      }
      return new Set(retained);
    });
  }, [gridType, installedModules, installedPresets, selectedPreset]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedPresetAvailable) {
      setErrorKey("package.error.presetUnavailable");
      return;
    }
    const parsedWidth = Number(width);
    const parsedHeight = Number(height);
    const parsedCellSize = Number(cellSize);
    const parsedGridOpacity = Number(gridOpacity);
    const parsedGridWidth = Number(gridWidth);
    if (name.trim().length === 0) {
      setErrorKey("error.requiredName");
      return;
    }
    if (
      ![parsedWidth, parsedHeight].every(
        (value) => Number.isInteger(value) && value >= 1 && value <= 40000,
      )
    ) {
      setErrorKey("error.invalidSize");
      return;
    }
    if (
      !Number.isInteger(parsedCellSize) ||
      parsedCellSize < 12 ||
      parsedCellSize > 96
    ) {
      setErrorKey("error.invalidCellSize");
      return;
    }
    if (
      !Number.isFinite(parsedGridOpacity) ||
      parsedGridOpacity < 0.1 ||
      parsedGridOpacity > 1
    ) {
      setErrorKey("error.invalidGridOpacity");
      return;
    }
    if (
      !Number.isFinite(parsedGridWidth) ||
      parsedGridWidth < 0.5 ||
      parsedGridWidth > 8
    ) {
      setErrorKey("error.invalidGridWidth");
      return;
    }
    setErrorKey(null);
    onCreate(
      createProject({
        name: name.trim(),
        grid: {
          type: gridType,
          width: parsedWidth,
          height: parsedHeight,
          cellSize: parsedCellSize,
        },
        style: {
          canvasBackground: withAlpha(background),
          defaultCellColor: withAlpha(cellColor),
          gridColor: withAlpha(gridColor),
          gridOpacity: parsedGridOpacity,
          gridWidth: parsedGridWidth,
          defaultEdgeColor: withAlpha(gridColor),
        },
      }),
      {
        ...(selectedPreset === "" ? {} : { presetIdentity: selectedPreset }),
        moduleIdentities: [...selectedInstalledModules].sort(),
      },
    );
  };

  return (
    <main className={styles.page}>
      <form className={styles.dialog} onSubmit={submit} noValidate>
        <header>
          <span className={styles.eyebrow}>{t("app.englishName")}</span>
          <h1>{t("new.title")}</h1>
          <p>{t("new.subtitle")}</p>
        </header>
        <div className={styles.content}>
          <div className={styles.projectColumn}>
            <div className={styles.grid}>
              <label className={`${styles.field} ${styles.nameField}`}>
                {t("field.projectName")}
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoFocus
                />
              </label>
              <fieldset className={styles.fieldset}>
                <legend>{t("field.gridType")}</legend>
                <div className={styles.segmented}>
                  <label data-selected={gridType === "hex-pointy"}>
                    <input
                      type="radio"
                      name="grid"
                      value="hex-pointy"
                      checked={gridType === "hex-pointy"}
                      onChange={() => setGridType("hex-pointy")}
                    />
                    {t("grid.hexPointy")}
                  </label>
                  <label data-selected={gridType === "square"}>
                    <input
                      type="radio"
                      name="grid"
                      value="square"
                      checked={gridType === "square"}
                      onChange={() => setGridType("square")}
                    />
                    {t("grid.square")}
                  </label>
                </div>
              </fieldset>
              <div className={styles.dimensions}>
                <label className={styles.field}>
                  {t("field.width")}
                  <input
                    type="number"
                    min="1"
                    max="40000"
                    step="1"
                    value={width}
                    onChange={(event) => setWidth(event.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  {t("field.height")}
                  <input
                    type="number"
                    min="1"
                    max="40000"
                    step="1"
                    value={height}
                    onChange={(event) => setHeight(event.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  {t("field.cellSize")}
                  <input
                    type="number"
                    min="12"
                    max="96"
                    step="1"
                    value={cellSize}
                    onChange={(event) => setCellSize(event.target.value)}
                  />
                </label>
              </div>
              <p className={styles.hint}>{t("new.sizeHint")}</p>
            </div>
            <section className={styles.styleSection}>
              <h2>{t("new.baseStyle")}</h2>
              <div className={styles.styleGrid}>
                <label>
                  <span>{t("field.background")}</span>
                  <input
                    type="color"
                    value={background}
                    onChange={(event) => setBackground(event.target.value)}
                  />
                </label>
                <label>
                  <span>{t("field.cellColor")}</span>
                  <input
                    type="color"
                    value={cellColor}
                    onChange={(event) => setCellColor(event.target.value)}
                  />
                </label>
                <label>
                  <span>{t("field.gridColor")}</span>
                  <input
                    type="color"
                    value={gridColor}
                    onChange={(event) => setGridColor(event.target.value)}
                  />
                </label>
                <label>
                  <span>{t("field.gridWidth")}</span>
                  <input
                    type="number"
                    min="0.5"
                    max="8"
                    step="0.5"
                    value={gridWidth}
                    onChange={(event) => setGridWidth(event.target.value)}
                  />
                </label>
                <label className={styles.rangeField}>
                  <span>{t("field.gridOpacity")}</span>
                  <input
                    type="range"
                    min="0.1"
                    max="1"
                    step="0.1"
                    value={gridOpacity}
                    onChange={(event) => setGridOpacity(event.target.value)}
                  />
                  <output>{Math.round(Number(gridOpacity) * 100)}%</output>
                </label>
              </div>
            </section>
            <ProjectGridPreview
              gridType={gridType}
              width={Number(width) || 1}
              height={Number(height) || 1}
              cellSize={Number(cellSize) || 36}
              background={background}
              cellColor={cellColor}
              gridColor={gridColor}
              gridOpacity={Number(gridOpacity) || 0.7}
              gridWidth={Number(gridWidth) || 1}
            />
          </div>
          <section className={styles.packages}>
            <h2>{t("new.packages")}</h2>
            {installedPresets.length > 0 ? (
              <label className={styles.field}>
                {t("package.preset.select")}
                <select
                  value={selectedPreset}
                  onChange={(event) => {
                    setSelectedPreset(event.target.value);
                    if (event.target.value !== "") {
                      setSelectedInstalledModules(new Set());
                    }
                  }}
                >
                  <option value="">{t("package.preset.none")}</option>
                  {installedPresets.map((preset) => {
                    const supported = preset.supportedGrids.includes(gridType);
                    const availability =
                      preset.availabilityByGrid?.[gridType] ?? "available";
                    const available = supported && availability === "available";
                    const statusKey = !supported
                      ? "package.status.gridUnsupported"
                      : availability === "required-unavailable"
                        ? "package.preset.requiredUnavailable"
                        : availability === "version-conflict"
                          ? "package.preset.versionConflict"
                          : availability === "incompatible"
                            ? "package.status.incompatible"
                            : (preset.statusKey ?? "package.status.ready");
                    return (
                      <option
                        key={preset.identity}
                        value={preset.identity}
                        disabled={!available}
                      >
                        {preset.label} · {t(statusKey)}
                      </option>
                    );
                  })}
                </select>
              </label>
            ) : null}
            {onOpenPackageSettings === undefined ? null : (
              <button type="button" onClick={onOpenPackageSettings}>
                {t("package.settings.open")}
              </button>
            )}
            {installedModules.map((module) => {
              const supported = module.supportedGrids.includes(gridType);
              return (
                <label
                  className={styles.packageRow}
                  key={module.identity}
                  data-disabled={!supported || selectedPreset !== ""}
                >
                  <span>
                    <input
                      type="checkbox"
                      aria-label={module.label}
                      checked={selectedInstalledModules.has(module.identity)}
                      disabled={!supported || selectedPreset !== ""}
                      onChange={(event) =>
                        setSelectedInstalledModules((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(module.identity);
                          else next.delete(module.identity);
                          return next;
                        })
                      }
                    />
                    <strong>{module.label}</strong>
                  </span>
                  <span className={styles.status}>
                    {t(
                      supported
                        ? module.statusKey
                        : "package.status.gridUnsupported",
                    )}
                  </span>
                </label>
              );
            })}
            {[
              BASIC_MODULE,
              ...optionalPackages.filter(
                (choice) =>
                  !installedModules.some((module) =>
                    module.identity.startsWith(`module:${choice.moduleId}@`),
                  ),
              ),
            ].map((choice) => {
              const supported = packageSupportsGrid(choice, gridType);
              const statusKey = supported
                ? choice.statusKey
                : "package.status.gridUnsupported";
              return (
                <div
                  className={styles.packageRow}
                  key={choice.moduleId}
                  data-disabled={!supported || choice.status !== "enabled"}
                >
                  <span>
                    <strong>{t(choice.nameKey)}</strong>
                    <small>
                      {choice.moduleId} · {choice.version}
                    </small>
                  </span>
                  <span className={styles.packageAction}>
                    <span className={styles.status}>{t(statusKey)}</span>
                    {choice.status === "missing" && supported && (
                      <button
                        type="button"
                        onClick={() => setPackageSetup(choice.moduleId)}
                      >
                        {t("package.action.configure")}
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
            {packageSetup !== null && (
              <div
                className={styles.setup}
                role="region"
                aria-label={t("package.setup.title")}
              >
                <strong>{t("package.setup.title")}</strong>
                <p>{t("package.setup.description")}</p>
                <button type="button" onClick={() => setPackageSetup(null)}>
                  {t("package.action.back")}
                </button>
              </div>
            )}
          </section>
        </div>
        <div className={styles.bottomBar}>
          <div className={styles.validationArea}>
            {(externalErrorKey ?? errorKey) === null ? (
              <span className={styles.validStatus}>{t("new.ready")}</span>
            ) : (
              <p
                role="alert"
                className={styles.error}
                onClick={() => {
                  setErrorKey(null);
                  onDismissExternalError?.();
                }}
              >
                {t(externalErrorKey ?? errorKey ?? "error.invalidProject")}
              </p>
            )}
          </div>
          <footer>
            {onOpenFile !== undefined && (
              <label className={styles.openButton}>
                {t("action.open")}
                <input
                  type="file"
                  accept=".tessera-project.json"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (file !== undefined)
                      void onOpenFile(file).catch(() =>
                        setErrorKey("error.invalidProject"),
                      );
                  }}
                />
              </label>
            )}
            <button
              type="button"
              disabled={onCancel === undefined}
              title={
                onCancel === undefined ? t("new.cancelUnavailable") : undefined
              }
              onClick={onCancel}
            >
              {t("action.cancel")}
            </button>
            <button
              className={styles.primary}
              type="submit"
              disabled={busy || !selectedPresetAvailable}
            >
              {t("action.create")}
            </button>
          </footer>
        </div>
      </form>
    </main>
  );
}

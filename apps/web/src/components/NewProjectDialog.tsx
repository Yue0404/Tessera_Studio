import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  BASIC_MODULE,
  OPTIONAL_PACKAGE_PLACEHOLDERS,
  packageSupportsGrid,
  type PackageChoice,
} from "@tessera/module-runtime";
import { createProject, type GridType, type ProjectState } from "@tessera/core";
import styles from "./NewProjectDialog.module.css";

interface Props {
  onCreate(project: ProjectState): void;
  onCancel?: (() => void) | undefined;
  onOpenFile?: ((file: File) => Promise<void>) | undefined;
  optionalPackages?: readonly PackageChoice[] | undefined;
}

function withAlpha(color: string): string {
  return `${color.toUpperCase()}FF`;
}

export function NewProjectDialog({
  onCreate,
  onCancel,
  onOpenFile,
  optionalPackages = OPTIONAL_PACKAGE_PLACEHOLDERS,
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
  const [selectedPackages, setSelectedPackages] = useState<ReadonlySet<string>>(
    new Set(),
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
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
          </div>
          <section className={styles.packages}>
            <h2>{t("new.packages")}</h2>
            {[BASIC_MODULE, ...optionalPackages].map((choice) => {
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
                    {choice.required || choice.status !== "available" ? null : (
                      <input
                        type="checkbox"
                        aria-label={t(choice.nameKey)}
                        checked={selectedPackages.has(choice.moduleId)}
                        disabled={!supported}
                        onChange={(event) =>
                          setSelectedPackages((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(choice.moduleId);
                            else next.delete(choice.moduleId);
                            return next;
                          })
                        }
                      />
                    )}
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
            {errorKey === null ? (
              <span className={styles.validStatus}>{t("new.ready")}</span>
            ) : (
              <p role="alert" className={styles.error}>
                {t(errorKey)}
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
                    const file = event.target.files?.[0];
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
            <button className={styles.primary} type="submit">
              {t("action.create")}
            </button>
          </footer>
        </div>
      </form>
    </main>
  );
}

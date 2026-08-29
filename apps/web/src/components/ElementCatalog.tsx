import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  normalizeRotationDegrees,
  projectTextContentValid,
  type EditorTool,
} from "@tessera/core";
import type {
  BrushMode,
  ConnectionPlacement,
  OverlayPlacement,
} from "@tessera/renderer";
import styles from "./ElementCatalog.module.css";

const BRUSH_MODES = ["paint", "erase", "fill"] as const;
const MARKER_SHAPES = ["circle", "diamond", "pin"] as const;
const OVERLAY_ANCHORS = ["cell", "edge", "map-point"] as const;
const CONNECTION_KINDS = ["line", "arrow"] as const;
const CONNECTION_ENDPOINTS = [
  "cell-center",
  "edge-midpoint",
  "map-point",
] as const;
const ARROW_MODES = ["end", "both"] as const;
const FONT_WEIGHTS = ["normal", "bold"] as const;
const TEXT_ALIGNMENTS = ["left", "center", "right"] as const;

const TOOL_KEYS: Record<EditorTool, string> = {
  select: "tool.select",
  pan: "tool.pan",
  brush: "tool.brush",
  edge: "tool.edge",
  marker: "tool.marker",
  connection: "tool.connection",
  "box-select": "tool.boxSelect",
  eraser: "tool.eraser",
  object: "tool.object",
};

export interface TextPlacementOptions {
  text: string;
  fontSize: number;
  color: string;
  fontWeight: "normal" | "bold";
  align: "left" | "center" | "right";
  rotation: number;
}

export interface ElementCatalogEntry {
  readonly moduleId: string;
  readonly moduleVersion: string;
  readonly moduleDisplayName?: string;
  readonly categoryId?: string;
  readonly categoryDisplayName?: string;
  readonly category: "cell" | "edge" | "object" | "overlay" | "connection";
  readonly primitive?:
    | "cell-style"
    | "edge-style"
    | "marker"
    | "text"
    | "connection"
    | "domain-object";
  readonly elementId: string;
  readonly displayName: string;
  readonly disabledReason?: string | null;
  readonly objectColorStyleKey?: "fillColor" | "strokeColor" | "color" | null;
}

function catalogCategoryId(entry: ElementCatalogEntry): string {
  // 领域物体统一进入“物体”，不让模块内部 categoryId 把同类物体拆散。
  return entry.category === "object" || entry.primitive === "domain-object"
    ? "object"
    : (entry.categoryId ?? entry.category);
}

interface Props {
  collapsed: boolean;
  onToggle(): void;
  activeElementId: string | null;
  activeTool: EditorTool;
  brushColor: string;
  brushMode: BrushMode;
  edgeColor: string;
  objectColor?: string;
  markerLabel: string;
  overlay: OverlayPlacement;
  textOptions: TextPlacementOptions;
  connection: ConnectionPlacement;
  elements?: readonly ElementCatalogEntry[];
  onBrushColor(color: string): void;
  onBrushMode(mode: BrushMode): void;
  onEdgeColor(color: string): void;
  onObjectColor?(color: string): void;
  onMarkerLabel(label: string): void;
  onOverlay(value: OverlayPlacement): void;
  onTextOptions(value: TextPlacementOptions): void;
  validateText?(value: string): boolean;
  onTextInvalid?(): void;
  onConnection(value: ConnectionPlacement): void;
  onElementSelect?(elementId: string): void;
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange(value: T): void;
}) {
  return (
    <label>
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ElementCatalog(props: Props) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLElement>(null);
  const [query, setQuery] = useState("");
  const [moduleId, setModuleId] = useState("tessera.basic");
  const [category, setCategory] = useState("all");
  const [directoryView, setDirectoryView] = useState<"top" | "objects">("top");
  const categoryBeforeObjects = useRef("all");
  const basicElements = useMemo<readonly ElementCatalogEntry[]>(
    () => [
      {
        moduleId: "tessera.basic",
        moduleVersion: "1.0.0",
        category: "object",
        primitive: "domain-object",
        elementId: "tessera.basic:object",
        displayName: t("element.objectCircle"),
        objectColorStyleKey: "fillColor",
      },
      {
        moduleId: "tessera.basic",
        moduleVersion: "1.0.0",
        category: "object",
        primitive: "domain-object",
        elementId: "tessera.basic:object.square",
        displayName: t("element.objectSquare"),
        objectColorStyleKey: "fillColor",
      },
      {
        moduleId: "tessera.basic",
        moduleVersion: "1.0.0",
        category: "object",
        primitive: "domain-object",
        elementId: "tessera.basic:object.hex-cluster",
        displayName: t("element.objectHexCluster"),
        objectColorStyleKey: "fillColor",
      },
      {
        moduleId: "tessera.basic",
        moduleVersion: "1.0.0",
        category: "cell",
        elementId: "tessera.basic:cell.color",
        displayName: t("element.cellColor"),
      },
      {
        moduleId: "tessera.basic",
        moduleVersion: "1.0.0",
        category: "edge",
        elementId: "tessera.basic:edge.style",
        displayName: t("element.edgeStyle"),
      },
      {
        moduleId: "tessera.basic",
        moduleVersion: "1.0.0",
        category: "overlay",
        elementId: "tessera.basic:marker",
        displayName: t("element.marker"),
      },
      {
        moduleId: "tessera.basic",
        moduleVersion: "1.0.0",
        category: "overlay",
        elementId: "tessera.basic:text",
        displayName: t("element.text"),
      },
      {
        moduleId: "tessera.basic",
        moduleVersion: "1.0.0",
        category: "connection",
        elementId: "tessera.basic:connection.line",
        displayName: t("element.connectionLine"),
      },
      {
        moduleId: "tessera.basic",
        moduleVersion: "1.0.0",
        category: "connection",
        elementId: "tessera.basic:connection.arrow",
        displayName: t("element.connectionArrow"),
      },
    ],
    [t],
  );
  const elements = useMemo(() => {
    const byId = new Map(
      basicElements.map((entry) => [entry.elementId, entry] as const),
    );
    const basicObjectIds = new Set([
      "tessera.basic:object",
      "tessera.basic:object.square",
      "tessera.basic:object.hex-cluster",
    ]);
    for (const entry of props.elements ?? []) {
      // 初始模块的专用工具由内置目录掌管；物体则采用会话结果以保留网格禁用原因。
      if (
        !entry.elementId.startsWith("tessera.basic:") ||
        basicObjectIds.has(entry.elementId)
      ) {
        byId.set(entry.elementId, entry);
      }
    }
    return [...byId.values()];
  }, [basicElements, props.elements]);
  const modules = [
    ...new Map(
      elements.map((entry) => [
        entry.moduleId,
        {
          moduleId: entry.moduleId,
          moduleVersion: entry.moduleVersion,
          moduleDisplayName: entry.moduleDisplayName ?? entry.moduleId,
        },
      ]),
    ).values(),
  ];
  const selectedModule =
    modules.find((module) => module.moduleId === moduleId) ?? modules[0];
  const selectedModuleId = selectedModule?.moduleId ?? "tessera.basic";
  const categories = [
    ...new Map(
      elements
        .filter((entry) => entry.moduleId === selectedModuleId)
        .map((entry) => {
          const categoryId = catalogCategoryId(entry);
          return [
            categoryId,
            {
              categoryId,
              label:
                categoryId === "object"
                  ? t("catalog.category.object")
                  : (entry.categoryDisplayName ??
                    t(`catalog.category.${entry.category}`)),
            },
          ];
        }),
    ).values(),
  ];
  const selectedCategory =
    category === "all" ||
    categories.some((item) => item.categoryId === category)
      ? category
      : "all";
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredElements = elements.filter(
    (entry) =>
      entry.moduleId === selectedModuleId &&
      (selectedCategory === "all" ||
        catalogCategoryId(entry) === selectedCategory) &&
      (normalizedQuery === "" ||
        entry.displayName.toLocaleLowerCase().includes(normalizedQuery)),
  );
  const objectPresetEntries = filteredElements.filter(
    (entry) =>
      entry.primitive === "domain-object" || entry.category === "object",
  );
  const topLevelEntries = filteredElements.filter(
    (entry) =>
      entry.primitive !== "domain-object" && entry.category !== "object",
  );
  const selectedModuleObjects = elements.filter(
    (entry) =>
      entry.moduleId === selectedModuleId &&
      (entry.primitive === "domain-object" || entry.category === "object"),
  );
  const objectGroupMatchesQuery =
    normalizedQuery === "" ||
    t("catalog.category.object")
      .toLocaleLowerCase()
      .includes(normalizedQuery) ||
    selectedModuleObjects.some((entry) =>
      entry.displayName.toLocaleLowerCase().includes(normalizedQuery),
    );
  const showObjectGroup =
    directoryView === "top" &&
    (selectedCategory === "all" || selectedCategory === "object") &&
    selectedModuleObjects.length > 0 &&
    objectGroupMatchesQuery;
  const visibleEntries =
    directoryView === "objects" ? objectPresetEntries : topLevelEntries;
  const activeEntry = elements.find(
    (entry) => entry.elementId === props.activeElementId,
  );
  const usesModuleDefaultStyle =
    activeEntry !== undefined && activeEntry.moduleId !== "tessera.basic";
  const activeSettings =
    props.activeElementId === "tessera.basic:cell.color"
      ? "cell"
      : props.activeElementId === "tessera.basic:edge.style"
        ? "edge"
        : props.activeElementId === "tessera.basic:object"
          ? "object"
          : props.activeElementId === "tessera.basic:marker"
            ? "marker"
            : props.activeElementId === "tessera.basic:text"
              ? "text"
              : props.activeElementId === "tessera.basic:connection.line" ||
                  props.activeElementId === "tessera.basic:connection.arrow"
                ? "connection"
                : activeEntry?.primitive === "cell-style"
                  ? "cell"
                  : activeEntry?.primitive === "edge-style"
                    ? "edge"
                    : activeEntry?.primitive === "domain-object"
                      ? "object"
                      : activeEntry?.primitive === "marker" ||
                          activeEntry?.primitive === "text" ||
                          activeEntry?.primitive === "connection"
                        ? activeEntry.primitive
                        : null;
  if (props.collapsed)
    return (
      <button
        className={styles.restore}
        data-canvas-obstruction="left"
        type="button"
        onClick={props.onToggle}
        aria-label={t("catalog.expand")}
        title={t("catalog.expand")}
      >
        <ChevronRight size={19} />
      </button>
    );
  return (
    <aside
      ref={panelRef}
      className={styles.panel}
      data-canvas-obstruction="left"
      data-testid="element-catalog-panel"
    >
      <header>
        <div>
          <strong>
            {selectedModuleId === "tessera.basic"
              ? t("package.basic.name")
              : selectedModule?.moduleDisplayName}
          </strong>
          <small>
            {selectedModuleId} · {selectedModule?.moduleVersion}
          </small>
        </div>
        <button
          type="button"
          onClick={props.onToggle}
          aria-label={t("catalog.collapse")}
          title={t("catalog.collapse")}
        >
          <ChevronLeft size={18} />
        </button>
      </header>
      {props.activeElementId !== null ? (
        <section
          className={styles.activeSettings}
          role="region"
          aria-label={t("catalog.activeSettings")}
          data-active-element={props.activeElementId}
          data-active-tool={props.activeTool}
        >
          <div className={styles.activeHeading}>
            <h2>
              {activeSettings === "cell"
                ? t("catalog.cellSettings")
                : activeSettings === "edge"
                  ? t("catalog.edgeSettings")
                  : activeSettings === "object"
                    ? t("catalog.objectSettings")
                    : activeSettings === "marker"
                      ? t("catalog.markerSettings")
                      : activeSettings === "text"
                        ? t("catalog.textSettings")
                        : activeSettings === "connection"
                          ? t("catalog.connectionSettings")
                          : t("catalog.activeSettings")}
            </h2>
            <small>
              {t("catalog.activeTool", {
                tool: t(TOOL_KEYS[props.activeTool]),
              })}
            </small>
          </div>
          {activeEntry !== undefined ? (
            <p className={styles.activeElementName}>
              {activeEntry.displayName}
            </p>
          ) : null}
          {activeSettings === "cell" ? (
            usesModuleDefaultStyle ? (
              <p>{t("catalog.moduleDefaultStyle")}</p>
            ) : (
              <div className={styles.stack}>
                <Choice
                  label={t("catalog.brushMode")}
                  value={props.brushMode}
                  options={BRUSH_MODES.map((value) => ({
                    value,
                    label: t(`brushMode.${value}`),
                  }))}
                  onChange={props.onBrushMode}
                />
                <label>
                  <span>{t("inspector.fillColor")}</span>
                  <input
                    type="color"
                    value={props.brushColor}
                    disabled={props.brushMode === "erase"}
                    onChange={(event) => props.onBrushColor(event.target.value)}
                  />
                </label>
              </div>
            )
          ) : activeSettings === "edge" ? (
            usesModuleDefaultStyle ? (
              <p>{t("catalog.moduleDefaultStyle")}</p>
            ) : (
              <label>
                <span>{t("inspector.edgeColor")}</span>
                <input
                  type="color"
                  value={props.edgeColor}
                  onChange={(event) => props.onEdgeColor(event.target.value)}
                />
              </label>
            )
          ) : activeSettings === "object" ? (
            <div className={styles.stack}>
              {usesModuleDefaultStyle ? (
                <p>{t("catalog.moduleDefaultStyle")}</p>
              ) : null}
              {activeEntry?.objectColorStyleKey !== null &&
              activeEntry?.objectColorStyleKey !== undefined ? (
                <label>
                  <span>{t("inspector.objectColor")}</span>
                  <input
                    type="color"
                    value={props.objectColor ?? "#D9B866"}
                    onChange={(event) =>
                      props.onObjectColor?.(event.target.value)
                    }
                  />
                </label>
              ) : null}
              <p>{t("catalog.objectPlacementHint")}</p>
            </div>
          ) : activeSettings === "marker" ? (
            <div className={styles.stack}>
              {usesModuleDefaultStyle ? null : (
                <>
                  <Choice
                    label={t("inspector.markerShape")}
                    value={props.overlay.markerShape}
                    options={MARKER_SHAPES.map((value) => ({
                      value,
                      label: t(`markerShape.${value}`),
                    }))}
                    onChange={(markerShape) =>
                      props.onOverlay({ ...props.overlay, markerShape })
                    }
                  />
                  <label>
                    <span>{t("inspector.markerColor")}</span>
                    <input
                      type="color"
                      value={props.brushColor}
                      onChange={(event) =>
                        props.onBrushColor(event.target.value)
                      }
                    />
                  </label>
                  <label>
                    <span>{t("inspector.markerLabel")}</span>
                    <input
                      type="text"
                      maxLength={64}
                      value={props.markerLabel}
                      onChange={(event) =>
                        props.onMarkerLabel(event.currentTarget.value)
                      }
                    />
                  </label>
                </>
              )}
              <Choice
                label={t("catalog.anchor")}
                value={props.overlay.anchor}
                options={OVERLAY_ANCHORS.map((value) => ({
                  value,
                  label: t(`anchor.${value}`),
                }))}
                onChange={(anchor) =>
                  props.onOverlay({ ...props.overlay, anchor })
                }
              />
            </div>
          ) : activeSettings === "text" ? (
            <div className={styles.stack}>
              <Choice
                label={t("catalog.anchor")}
                value={props.overlay.anchor}
                options={OVERLAY_ANCHORS.map((value) => ({
                  value,
                  label: t(`anchor.${value}`),
                }))}
                onChange={(anchor) =>
                  props.onOverlay({ ...props.overlay, anchor })
                }
              />
              <label>
                <span>{t("inspector.text")}</span>
                <textarea
                  value={props.textOptions.text}
                  onChange={(event) => {
                    const text = event.target.value;
                    if (
                      !projectTextContentValid(text) ||
                      props.validateText?.(text) === false
                    ) {
                      props.onTextInvalid?.();
                      return;
                    }
                    props.onTextOptions({ ...props.textOptions, text });
                  }}
                />
              </label>
              {usesModuleDefaultStyle ? null : (
                <>
                  <label>
                    <span>{t("inspector.fontSize")}</span>
                    <input
                      type="number"
                      min="8"
                      max="256"
                      value={props.textOptions.fontSize}
                      onChange={(event) =>
                        props.onTextOptions({
                          ...props.textOptions,
                          fontSize: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>{t("inspector.textColor")}</span>
                    <input
                      type="color"
                      value={props.textOptions.color}
                      onChange={(event) =>
                        props.onTextOptions({
                          ...props.textOptions,
                          color: event.target.value,
                        })
                      }
                    />
                  </label>
                  <Choice
                    label={t("inspector.fontWeight")}
                    value={props.textOptions.fontWeight}
                    options={FONT_WEIGHTS.map((value) => ({
                      value,
                      label: t(`fontWeight.${value}`),
                    }))}
                    onChange={(fontWeight) =>
                      props.onTextOptions({ ...props.textOptions, fontWeight })
                    }
                  />
                  <Choice
                    label={t("inspector.align")}
                    value={props.textOptions.align}
                    options={TEXT_ALIGNMENTS.map((value) => ({
                      value,
                      label: t(`align.${value}`),
                    }))}
                    onChange={(align) =>
                      props.onTextOptions({ ...props.textOptions, align })
                    }
                  />
                  <label>
                    <span>{t("inspector.rotation")}</span>
                    <input
                      type="number"
                      min="-360"
                      max="360"
                      value={props.textOptions.rotation}
                      onChange={(event) => {
                        const rotation = Number(event.target.value);
                        if (!Number.isFinite(rotation)) return;
                        props.onTextOptions({
                          ...props.textOptions,
                          rotation: normalizeRotationDegrees(rotation),
                        });
                      }}
                    />
                  </label>
                </>
              )}
            </div>
          ) : activeSettings === "connection" ? (
            <div className={styles.stack}>
              {usesModuleDefaultStyle ? null : (
                <Choice
                  label={t("catalog.connectionType")}
                  value={props.connection.kind}
                  options={CONNECTION_KINDS.map((value) => ({
                    value,
                    label: t(`connectionType.${value}`),
                  }))}
                  onChange={(kind) =>
                    props.onConnection({ ...props.connection, kind })
                  }
                />
              )}
              <Choice
                label={t("catalog.endpoint")}
                value={props.connection.endpoint}
                options={CONNECTION_ENDPOINTS.map((value) => ({
                  value,
                  label: t(`endpoint.${value}`),
                }))}
                onChange={(endpoint) =>
                  props.onConnection({ ...props.connection, endpoint })
                }
              />
              {!usesModuleDefaultStyle && props.connection.kind === "arrow" ? (
                <Choice
                  label={t("catalog.arrowMode")}
                  value={props.connection.arrowMode}
                  options={ARROW_MODES.map((value) => ({
                    value,
                    label: t(`arrowMode.${value}`),
                  }))}
                  onChange={(arrowMode) =>
                    props.onConnection({ ...props.connection, arrowMode })
                  }
                />
              ) : null}
              <label>
                <span>{t("inspector.shortLabel")}</span>
                <input
                  type="text"
                  maxLength={64}
                  value={props.connection.label}
                  onChange={(event) =>
                    props.onConnection({
                      ...props.connection,
                      label: event.target.value,
                    })
                  }
                />
              </label>
            </div>
          ) : (
            <p>
              {usesModuleDefaultStyle
                ? t("catalog.moduleDefaultStyle")
                : t("catalog.noActiveSettings")}
            </p>
          )}
        </section>
      ) : null}
      <section className={styles.directory}>
        <div className={styles.directoryHeading}>
          {directoryView === "objects" ? (
            <button
              className={styles.directoryBack}
              type="button"
              onClick={() => {
                setDirectoryView("top");
                setCategory(categoryBeforeObjects.current);
              }}
              aria-label={t("catalog.backToDirectory")}
            >
              <ChevronLeft size={15} />
              <span>{t("action.back")}</span>
            </button>
          ) : null}
          <h2>
            {directoryView === "objects"
              ? t("catalog.objectPresetDirectory")
              : t("catalog.directory")}
          </h2>
        </div>
        <label>
          <span>{t("catalog.search")}</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <Choice
          label={t("catalog.module")}
          value={selectedModuleId}
          options={modules.map((module) => ({
            value: module.moduleId,
            label: `${module.moduleDisplayName} · ${module.moduleVersion}`,
          }))}
          onChange={(value) => {
            setModuleId(value);
            setCategory(directoryView === "objects" ? "object" : "all");
          }}
        />
        <Choice
          label={t("catalog.category")}
          value={selectedCategory}
          options={[
            { value: "all", label: t("catalog.category.all") },
            ...categories.map((item) => ({
              value: item.categoryId,
              label: item.label,
            })),
          ]}
          onChange={(value) => {
            setCategory(value);
            if (directoryView === "objects" && value !== "object")
              setDirectoryView("top");
          }}
        />
        {visibleEntries.length === 0 && !showObjectGroup ? (
          <p>{t("catalog.noResults")}</p>
        ) : (
          <ul aria-label={t("catalog.results")}>
            {showObjectGroup ? (
              <li>
                <button
                  type="button"
                  aria-label={t("catalog.openObjectPresets")}
                  onClick={() => {
                    categoryBeforeObjects.current = selectedCategory;
                    setCategory("object");
                    setQuery("");
                    setDirectoryView("objects");
                    if (panelRef.current !== null)
                      panelRef.current.scrollTop = 0;
                  }}
                >
                  <span>{t("catalog.category.object")}</span>
                  <small>
                    {t("catalog.objectPresetCount", {
                      count: selectedModuleObjects.length,
                    })}
                  </small>
                </button>
              </li>
            ) : null}
            {visibleEntries.map((entry) => (
              <li key={entry.elementId}>
                {props.onElementSelect === undefined ? (
                  <div>
                    <span>{entry.displayName}</span>
                    <small>{entry.elementId}</small>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={
                      entry.disabledReason !== null &&
                      entry.disabledReason !== undefined
                    }
                    aria-label={t("catalog.activateElement", {
                      id: entry.elementId,
                    })}
                    title={
                      entry.disabledReason === null ||
                      entry.disabledReason === undefined
                        ? undefined
                        : t(`catalog.disabledReason.${entry.disabledReason}`)
                    }
                    data-disabled-reason={entry.disabledReason ?? undefined}
                    onClick={() => {
                      props.onElementSelect?.(entry.elementId);
                      // 激活目录项后回到设置区顶部，让当前主要选项无需额外滚动即可操作。
                      if (panelRef.current !== null)
                        panelRef.current.scrollTop = 0;
                    }}
                  >
                    <span>{entry.displayName}</span>
                    <small>{entry.elementId}</small>
                    {entry.disabledReason !== null &&
                      entry.disabledReason !== undefined && (
                        <small>
                          {t(`catalog.disabledReason.${entry.disabledReason}`)}
                        </small>
                      )}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}

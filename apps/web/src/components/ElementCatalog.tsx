import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { normalizeRotationDegrees } from "@tessera/core";
import type {
  BrushMode,
  ConnectionPlacement,
  OverlayPlacement,
} from "@tessera/renderer";
import styles from "./ElementCatalog.module.css";

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
  readonly category: "cell" | "edge" | "overlay" | "connection";
  readonly elementId: string;
  readonly displayName: string;
}

interface Props {
  collapsed: boolean;
  onToggle(): void;
  brushColor: string;
  brushMode: BrushMode;
  edgeColor: string;
  overlay: OverlayPlacement;
  textOptions: TextPlacementOptions;
  connection: ConnectionPlacement;
  elements?: readonly ElementCatalogEntry[];
  onBrushColor(color: string): void;
  onBrushMode(mode: BrushMode): void;
  onEdgeColor(color: string): void;
  onOverlay(value: OverlayPlacement): void;
  onTextOptions(value: TextPlacementOptions): void;
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
  const [query, setQuery] = useState("");
  const [moduleId, setModuleId] = useState("tessera.basic");
  const [category, setCategory] = useState("all");
  const basicElements = useMemo<readonly ElementCatalogEntry[]>(
    () => [
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
  const elements = props.elements ?? basicElements;
  const modules = [
    ...new Map(
      elements.map((entry) => [
        entry.moduleId,
        { moduleId: entry.moduleId, moduleVersion: entry.moduleVersion },
      ]),
    ).values(),
  ];
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredElements = elements.filter(
    (entry) =>
      entry.moduleId === moduleId &&
      (category === "all" || entry.category === category) &&
      (normalizedQuery === "" ||
        entry.displayName.toLocaleLowerCase().includes(normalizedQuery)),
  );
  if (props.collapsed)
    return (
      <button
        className={styles.restore}
        type="button"
        onClick={props.onToggle}
        aria-label={t("catalog.expand")}
        title={t("catalog.expand")}
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
          aria-label={t("catalog.collapse")}
          title={t("catalog.collapse")}
        >
          <ChevronLeft size={18} />
        </button>
      </header>
      <section className={styles.directory}>
        <h2>{t("catalog.directory")}</h2>
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
          value={moduleId}
          options={modules.map((module) => ({
            value: module.moduleId,
            label: `${module.moduleId} · ${module.moduleVersion}`,
          }))}
          onChange={setModuleId}
        />
        <Choice
          label={t("catalog.category")}
          value={category}
          options={(
            ["all", "cell", "edge", "overlay", "connection"] as const
          ).map((value) => ({
            value,
            label: t(`catalog.category.${value}`),
          }))}
          onChange={setCategory}
        />
        {filteredElements.length === 0 ? (
          <p>{t("catalog.noResults")}</p>
        ) : (
          <ul aria-label={t("catalog.results")}>
            {filteredElements.map((entry) => (
              <li key={entry.elementId}>
                <button
                  type="button"
                  onClick={() => props.onElementSelect?.(entry.elementId)}
                >
                  <span>{entry.displayName}</span>
                  <small>{entry.elementId}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2>{t("catalog.cellColors")}</h2>
        <Choice
          label={t("catalog.brushMode")}
          value={props.brushMode}
          options={(["paint", "erase", "fill"] as const).map((value) => ({
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
      </section>
      <section>
        <h2>{t("catalog.edgeStyles")}</h2>
        <label>
          <span>{t("inspector.edgeColor")}</span>
          <input
            type="color"
            value={props.edgeColor}
            onChange={(event) => props.onEdgeColor(event.target.value)}
          />
        </label>
      </section>
      <section>
        <h2>{t("catalog.annotations")}</h2>
        <Choice
          label={t("catalog.overlayType")}
          value={props.overlay.type}
          options={(["marker", "text"] as const).map((value) => ({
            value,
            label: t(`overlayType.${value}`),
          }))}
          onChange={(type) => props.onOverlay({ ...props.overlay, type })}
        />
        {props.overlay.type === "marker" && (
          <Choice
            label={t("inspector.markerShape")}
            value={props.overlay.markerShape}
            options={(["circle", "diamond", "pin"] as const).map((value) => ({
              value,
              label: t(`markerShape.${value}`),
            }))}
            onChange={(markerShape) =>
              props.onOverlay({ ...props.overlay, markerShape })
            }
          />
        )}
        <Choice
          label={t("catalog.anchor")}
          value={props.overlay.anchor}
          options={(["cell", "edge", "map-point"] as const).map((value) => ({
            value,
            label: t(`anchor.${value}`),
          }))}
          onChange={(anchor) => props.onOverlay({ ...props.overlay, anchor })}
        />
        {props.overlay.type === "text" && (
          <div className={styles.stack}>
            <label>
              <span>{t("inspector.text")}</span>
              <textarea
                value={props.textOptions.text}
                maxLength={2048}
                onChange={(event) =>
                  props.onTextOptions({
                    ...props.textOptions,
                    text: event.target.value,
                  })
                }
              />
            </label>
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
              options={(["normal", "bold"] as const).map((value) => ({
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
              options={(["left", "center", "right"] as const).map((value) => ({
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
          </div>
        )}
      </section>
      <section>
        <h2>{t("catalog.connections")}</h2>
        <Choice
          label={t("catalog.connectionType")}
          value={props.connection.kind}
          options={(["line", "arrow"] as const).map((value) => ({
            value,
            label: t(`connectionType.${value}`),
          }))}
          onChange={(kind) => props.onConnection({ ...props.connection, kind })}
        />
        <Choice
          label={t("catalog.endpoint")}
          value={props.connection.endpoint}
          options={(["cell-center", "edge-midpoint", "map-point"] as const).map(
            (value) => ({ value, label: t(`endpoint.${value}`) }),
          )}
          onChange={(endpoint) =>
            props.onConnection({ ...props.connection, endpoint })
          }
        />
        {props.connection.kind === "arrow" && (
          <Choice
            label={t("catalog.arrowMode")}
            value={props.connection.arrowMode}
            options={(["end", "both"] as const).map((value) => ({
              value,
              label: t(`arrowMode.${value}`),
            }))}
            onChange={(arrowMode) =>
              props.onConnection({ ...props.connection, arrowMode })
            }
          />
        )}
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
      </section>
    </aside>
  );
}

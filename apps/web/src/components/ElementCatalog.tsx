import { ChevronLeft, ChevronRight } from "lucide-react";
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

interface Props {
  collapsed: boolean;
  onToggle(): void;
  brushColor: string;
  brushMode: BrushMode;
  edgeColor: string;
  overlay: OverlayPlacement;
  textOptions: TextPlacementOptions;
  connection: ConnectionPlacement;
  onBrushColor(color: string): void;
  onBrushMode(mode: BrushMode): void;
  onEdgeColor(color: string): void;
  onOverlay(value: OverlayPlacement): void;
  onTextOptions(value: TextPlacementOptions): void;
  onConnection(value: ConnectionPlacement): void;
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

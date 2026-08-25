import {
  BoxSelect,
  Brush,
  Eraser,
  Hand,
  Layers3,
  Map,
  MapPin,
  MousePointer2,
  Package,
  PanelRight,
  PenLine,
  Type,
  Waypoints,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EditorTool } from "@tessera/core";
import { ToolButton } from "./ToolButton.js";
import styles from "./CanvasToolRail.module.css";

interface Props {
  tool: EditorTool;
  catalogCollapsed: boolean;
  overlayType: "marker" | "text";
  markerLabel?: string;
  onTool(tool: EditorTool): void;
  onOverlayType(type: "marker" | "text"): void;
  onMarkerLabel?(label: string): void;
  onContext(panel: "properties" | "layers" | "modules" | "map"): void;
}

export function CanvasToolRail(props: Props) {
  const { t } = useTranslation();
  const [markerMenuOpen, setMarkerMenuOpen] = useState(false);
  const markerEntry = useRef<HTMLDivElement>(null);
  const markerButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!markerMenuOpen) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!markerEntry.current?.contains(event.target as Node)) {
        setMarkerMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [markerMenuOpen]);

  const chooseOverlayType = (type: "marker" | "text") => {
    props.onOverlayType(type);
    setMarkerMenuOpen(false);
    markerButton.current?.focus();
  };

  return (
    <>
      <div
        className={styles.toolRail}
        data-collapsed={props.catalogCollapsed}
        data-testid="canvas-tool-rail"
        role="toolbar"
        aria-label={t("toolbar.canvasTools")}
      >
        <ToolButton
          label={t("tool.select")}
          active={props.tool === "select"}
          onClick={() => props.onTool("select")}
        >
          <MousePointer2 size={19} />
        </ToolButton>
        <ToolButton
          label={t("tool.pan")}
          active={props.tool === "pan"}
          onClick={() => props.onTool("pan")}
        >
          <Hand size={19} />
        </ToolButton>
        <ToolButton
          label={t("tool.brush")}
          active={props.tool === "brush"}
          onClick={() => props.onTool("brush")}
        >
          <Brush size={19} />
        </ToolButton>
        <ToolButton
          label={t("tool.eraser")}
          active={props.tool === "eraser"}
          onClick={() => props.onTool("eraser")}
        >
          <Eraser size={19} />
        </ToolButton>
        <ToolButton
          label={t("tool.edge")}
          active={props.tool === "edge"}
          onClick={() => props.onTool("edge")}
        >
          <PenLine size={19} />
        </ToolButton>
        <div className={styles.markerQuickEntry} ref={markerEntry}>
          <ToolButton
            buttonRef={markerButton}
            label={t("tool.marker")}
            active={props.tool === "marker"}
            onClick={() => setMarkerMenuOpen((open) => !open)}
          >
            {props.overlayType === "text" ? (
              <Type size={19} />
            ) : (
              <MapPin size={19} />
            )}
          </ToolButton>
          {markerMenuOpen && (
            <div
              className={styles.markerPopover}
              data-popover-side="right"
              role="dialog"
              aria-label={t("markerQuick.title")}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.stopPropagation();
                setMarkerMenuOpen(false);
                markerButton.current?.focus();
              }}
            >
              <strong>{t("markerQuick.title")}</strong>
              <div className={styles.markerChoices} role="radiogroup">
                <button
                  type="button"
                  role="radio"
                  aria-checked={props.overlayType === "marker"}
                  onClick={() => chooseOverlayType("marker")}
                >
                  <MapPin size={16} />
                  {t("markerQuick.marker")}
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={props.overlayType === "text"}
                  onClick={() => chooseOverlayType("text")}
                >
                  <Type size={16} />
                  {t("markerQuick.text")}
                </button>
              </div>
              {props.onMarkerLabel !== undefined && (
                <label>
                  <span>{t("markerQuick.label")}</span>
                  <input
                    type="text"
                    value={props.markerLabel ?? ""}
                    maxLength={64}
                    onChange={(event) =>
                      props.onMarkerLabel?.(event.currentTarget.value)
                    }
                  />
                </label>
              )}
            </div>
          )}
        </div>
        <ToolButton
          label={t("tool.connection")}
          active={props.tool === "connection"}
          onClick={() => props.onTool("connection")}
        >
          <Waypoints size={19} />
        </ToolButton>
        <ToolButton
          label={t("tool.boxSelect")}
          active={props.tool === "box-select"}
          onClick={() => props.onTool("box-select")}
        >
          <BoxSelect size={19} />
        </ToolButton>
      </div>
      <div
        className={styles.contextRail}
        role="toolbar"
        aria-label={t("toolbar.contextPanels")}
      >
        <ToolButton
          label={t("tool.properties")}
          onClick={() => props.onContext("properties")}
        >
          <PanelRight size={19} />
        </ToolButton>
        <ToolButton
          label={t("tool.layers")}
          onClick={() => props.onContext("layers")}
        >
          <Layers3 size={19} />
        </ToolButton>
        <ToolButton
          label={t("tool.modules")}
          onClick={() => props.onContext("modules")}
        >
          <Package size={19} />
        </ToolButton>
        <ToolButton
          label={t("tool.mapSettings")}
          onClick={() => props.onContext("map")}
        >
          <Map size={19} />
        </ToolButton>
      </div>
    </>
  );
}

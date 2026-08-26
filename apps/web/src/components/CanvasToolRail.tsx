import {
  BoxSelect,
  Brush,
  Eraser,
  Hand,
  Layers3,
  Map,
  MapPin,
  MousePointerClick,
  MousePointer2,
  MoveHorizontal,
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
  eraserMode: "click" | "drag";
  onTool(tool: EditorTool): void;
  onOverlayType(type: "marker" | "text"): void;
  onEraserMode(mode: "click" | "drag"): void;
  onContext(panel: "properties" | "layers" | "modules" | "map"): void;
}

export function CanvasToolRail(props: Props) {
  const { t } = useTranslation();
  const [openMenu, setOpenMenu] = useState<"marker" | "eraser" | null>(null);
  const markerEntry = useRef<HTMLDivElement>(null);
  const markerButton = useRef<HTMLButtonElement>(null);
  const eraserEntry = useRef<HTMLDivElement>(null);
  const eraserButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (openMenu === null) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const entry = openMenu === "marker" ? markerEntry : eraserEntry;
      if (!entry.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [openMenu]);

  const chooseOverlayType = (type: "marker" | "text") => {
    props.onOverlayType(type);
    setOpenMenu(null);
    markerButton.current?.focus();
  };

  const chooseEraserMode = (mode: "click" | "drag") => {
    props.onEraserMode(mode);
    setOpenMenu(null);
    eraserButton.current?.focus();
  };

  return (
    <>
      <div
        className={styles.toolRail}
        data-collapsed={props.catalogCollapsed}
        data-canvas-obstruction="left"
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
        <div
          className={`${styles.quickEntry} ${styles.eraserEntry}`}
          ref={eraserEntry}
          data-eraser-mode={props.eraserMode}
        >
          <ToolButton
            buttonRef={eraserButton}
            label={`${t("tool.eraser")} · ${t(`eraserMode.${props.eraserMode}`)}`}
            active={props.tool === "eraser"}
            expandable
            onClick={() =>
              setOpenMenu((current) => (current === "eraser" ? null : "eraser"))
            }
          >
            <span className={styles.eraserCurrentMode}>
              <Eraser size={17} />
              <small>
                {props.eraserMode === "click"
                  ? t("eraserMode.clickShort")
                  : t("eraserMode.dragShort")}
              </small>
            </span>
          </ToolButton>
          {openMenu === "eraser" ? (
            <div
              className={styles.quickPopover}
              data-popover-side="right"
              role="dialog"
              aria-label={t("eraserQuick.title")}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.stopPropagation();
                setOpenMenu(null);
                eraserButton.current?.focus();
              }}
            >
              <strong>{t("eraserQuick.title")}</strong>
              <div className={styles.quickChoices} role="radiogroup">
                {(["click", "drag"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={props.eraserMode === mode}
                    data-quick-choice-layout="single-line"
                    onClick={() => chooseEraserMode(mode)}
                  >
                    {mode === "click" ? (
                      <MousePointerClick
                        size={15}
                        data-quick-choice-icon="click"
                      />
                    ) : (
                      <MoveHorizontal size={15} data-quick-choice-icon="drag" />
                    )}
                    <span>{t(`eraserMode.${mode}`)}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <ToolButton
          label={t("tool.edge")}
          active={props.tool === "edge"}
          onClick={() => props.onTool("edge")}
        >
          <PenLine size={19} />
        </ToolButton>
        <div className={styles.quickEntry} ref={markerEntry}>
          <ToolButton
            buttonRef={markerButton}
            label={t("tool.marker")}
            active={props.tool === "marker"}
            expandable
            onClick={() =>
              setOpenMenu((current) => (current === "marker" ? null : "marker"))
            }
          >
            {props.overlayType === "text" ? (
              <Type size={19} />
            ) : (
              <MapPin size={19} />
            )}
          </ToolButton>
          {openMenu === "marker" && (
            <div
              className={styles.quickPopover}
              data-popover-side="right"
              role="dialog"
              aria-label={t("markerQuick.title")}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.stopPropagation();
                setOpenMenu(null);
                markerButton.current?.focus();
              }}
            >
              <strong>{t("markerQuick.title")}</strong>
              <div className={styles.quickChoices} role="radiogroup">
                <button
                  type="button"
                  role="radio"
                  aria-checked={props.overlayType === "marker"}
                  data-quick-choice-layout="single-line"
                  onClick={() => chooseOverlayType("marker")}
                >
                  <MapPin size={16} />
                  <span>{t("markerQuick.marker")}</span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={props.overlayType === "text"}
                  data-quick-choice-layout="single-line"
                  onClick={() => chooseOverlayType("text")}
                >
                  <Type size={16} />
                  <span>{t("markerQuick.text")}</span>
                </button>
              </div>
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
        data-canvas-obstruction="right"
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

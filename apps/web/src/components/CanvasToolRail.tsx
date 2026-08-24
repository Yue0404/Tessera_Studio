import {
  BoxSelect,
  Brush,
  Hand,
  Layers3,
  Map,
  MapPin,
  MousePointer2,
  Package,
  PanelRight,
  PenLine,
  Waypoints,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EditorTool } from "@tessera/core";
import { ToolButton } from "./ToolButton.js";
import styles from "./CanvasToolRail.module.css";

interface Props {
  tool: EditorTool;
  catalogCollapsed: boolean;
  onTool(tool: EditorTool): void;
  onContext(panel: "properties" | "layers" | "modules" | "map"): void;
}

export function CanvasToolRail(props: Props) {
  const { t } = useTranslation();
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
          label={t("tool.edge")}
          active={props.tool === "edge"}
          onClick={() => props.onTool("edge")}
        >
          <PenLine size={19} />
        </ToolButton>
        <ToolButton
          label={t("tool.marker")}
          active={props.tool === "marker"}
          onClick={() => props.onTool("marker")}
        >
          <MapPin size={19} />
        </ToolButton>
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

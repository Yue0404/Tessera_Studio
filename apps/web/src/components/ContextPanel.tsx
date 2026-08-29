import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  sortLayers,
  type ConnectionData,
  type EdgeStyle,
  type FixedLayerState,
  type ProjectState,
  type OverlayData,
  type SelectedObject,
} from "@tessera/core";
import styles from "./ContextPanel.module.css";
import { SelectionInspector } from "./SelectionInspector.js";
import type { ConnectionRebindTarget } from "@tessera/renderer";
import type { ProjectRuleHint } from "../module-rule-evaluator.js";
import { MapSettingsForm } from "./MapSettingsForm.js";

interface Props {
  panel: "properties" | "layers" | "modules" | "map";
  state: Readonly<ProjectState>;
  selection: readonly SelectedObject[];
  onSelectionColor(color: string): void;
  onEdgeStyle(edgeId: string, style: EdgeStyle): void;
  onOverlay(overlayId: string, overlay: OverlayData): void;
  onConnection(connectionId: string, connection: ConnectionData): void;
  onModuleInstance?: Parameters<
    typeof SelectionInspector
  >[0]["onModuleInstance"];
  onDomainGroupMembers?: Parameters<
    typeof SelectionInspector
  >[0]["onDomainGroupMembers"];
  moduleRuleHints?: readonly ProjectRuleHint[];
  moduleInstanceColor?: Parameters<
    typeof SelectionInspector
  >[0]["moduleInstanceColor"];
  connectionRebind: ConnectionRebindTarget | null;
  onReverseConnection(connectionId: string): void;
  onBeginConnectionRebind(target: ConnectionRebindTarget): void;
  onCancelConnectionRebind(): void;
  onDeleteSelection(): void;
  onDeleteObject?(selected: SelectedObject): void;
  onSelectionHover?(selected: SelectedObject | null): void;
  onMapSettingsSubmit?(grid: ProjectState["grid"]): void;
  mapSettingsError?: string | null;
  onLayerState(
    layerId: string,
    patch: Partial<Pick<FixedLayerState, "visible" | "locked" | "opacity">>,
  ): void;
  onClose(): void;
}

export function ContextPanel({
  panel,
  state,
  selection,
  onSelectionColor,
  onEdgeStyle,
  onOverlay,
  onConnection,
  onModuleInstance,
  onDomainGroupMembers,
  moduleRuleHints,
  moduleInstanceColor,
  connectionRebind,
  onReverseConnection,
  onBeginConnectionRebind,
  onCancelConnectionRebind,
  onDeleteSelection,
  onDeleteObject,
  onSelectionHover,
  onMapSettingsSubmit,
  mapSettingsError,
  onLayerState,
  onClose,
}: Props) {
  const { t, i18n } = useTranslation();
  const titleKey =
    panel === "properties"
      ? "tool.properties"
      : panel === "layers"
        ? "tool.layers"
        : panel === "modules"
          ? "tool.modules"
          : "tool.mapSettings";
  return (
    <aside className={styles.panel} data-canvas-obstruction="right">
      <header>
        <h2>{t(titleKey)}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("action.close")}
          title={t("action.close")}
        >
          <X size={18} />
        </button>
      </header>
      {panel === "properties" && (
        <SelectionInspector
          state={state}
          selection={selection}
          onSelectionColor={onSelectionColor}
          onEdgeStyle={onEdgeStyle}
          onOverlay={onOverlay}
          onConnection={onConnection}
          {...(onModuleInstance === undefined ? {} : { onModuleInstance })}
          {...(onDomainGroupMembers === undefined
            ? {}
            : { onDomainGroupMembers })}
          {...(moduleRuleHints === undefined ? {} : { moduleRuleHints })}
          {...(moduleInstanceColor === undefined
            ? {}
            : { moduleInstanceColor })}
          connectionRebind={connectionRebind}
          onReverseConnection={onReverseConnection}
          onBeginConnectionRebind={onBeginConnectionRebind}
          onCancelConnectionRebind={onCancelConnectionRebind}
          onDelete={onDeleteSelection}
          {...(onDeleteObject === undefined ? {} : { onDeleteObject })}
          {...(onSelectionHover === undefined ? {} : { onSelectionHover })}
        />
      )}
      {panel === "layers" && (
        <ul>
          {sortLayers(state.layers.values()).map((layer) => (
            <li key={layer.layerId}>
              <span>
                {i18n.exists(`layer.${layer.layerId}`)
                  ? t(`layer.${layer.layerId}`)
                  : layer.layerId}
              </span>
              <small>
                {layer.layerId} · {layer.zIndex}
              </small>
              {layer.runtimeStatus === "missing" ? (
                <small>{t("layer.moduleMissing")}</small>
              ) : null}
              <div className={styles.layerControls}>
                <label>
                  <input
                    type="checkbox"
                    checked={layer.visible}
                    onChange={(event) =>
                      onLayerState(layer.layerId, {
                        visible: event.target.checked,
                      })
                    }
                  />
                  {t("layer.visible")}
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={layer.locked}
                    disabled={
                      layer.layerId === "tessera.system.grid" ||
                      layer.runtimeStatus === "missing"
                    }
                    onChange={(event) =>
                      onLayerState(layer.layerId, {
                        locked: event.target.checked,
                      })
                    }
                  />
                  {t("layer.locked")}
                </label>
                <label>
                  {t("layer.opacity")}
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={layer.opacity}
                    onChange={(event) =>
                      onLayerState(layer.layerId, {
                        opacity: Number(event.target.value),
                      })
                    }
                  />
                </label>
              </div>
            </li>
          ))}
        </ul>
      )}
      {panel === "modules" && (
        <div className={styles.module}>
          <strong>{t("package.basic.name")}</strong>
          <span>tessera.basic · 1.0.0</span>
          <small>{t("package.status.alwaysEnabled")}</small>
        </div>
      )}
      {panel === "map" && (
        <MapSettingsForm
          value={state.grid}
          disabled={onMapSettingsSubmit === undefined}
          {...(mapSettingsError === undefined
            ? {}
            : { externalError: mapSettingsError })}
          onSubmit={(grid) => onMapSettingsSubmit?.(grid)}
        />
      )}
    </aside>
  );
}

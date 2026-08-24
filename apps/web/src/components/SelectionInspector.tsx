import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  normalizeRotationDegrees,
  projectTextContentValid,
} from "@tessera/core";
import type {
  ConnectionData,
  EdgeStyle,
  OverlayData,
  ProjectState,
  SelectedObject,
} from "@tessera/core";
import styles from "./ContextPanel.module.css";
import type { ConnectionRebindTarget } from "@tessera/renderer";
import type { JsonValue } from "@tessera/module-runtime";
import type { ProjectRuleHint } from "../module-rule-evaluator.js";

interface Props {
  state: Readonly<ProjectState>;
  selection: readonly SelectedObject[];
  onSelectionColor(color: string): void;
  onEdgeStyle(edgeId: string, style: EdgeStyle): void;
  onOverlay(overlayId: string, overlay: OverlayData): void;
  onConnection(connectionId: string, connection: ConnectionData): void;
  onModuleInstance?(
    instanceId: string,
    patch: {
      attributes?: Readonly<Record<string, JsonValue>>;
      styleOverrides?: Readonly<Record<string, unknown>>;
      label?: string | null;
    },
  ): void;
  onDomainGroupMembers?(
    instanceId: string,
    memberCellIds: readonly string[],
  ): void;
  moduleRuleHints?: readonly ProjectRuleHint[];
  connectionRebind: ConnectionRebindTarget | null;
  onReverseConnection(connectionId: string): void;
  onBeginConnectionRebind(target: ConnectionRebindTarget): void;
  onCancelConnectionRebind(): void;
  onDelete(): void;
}

function colorWithoutAlpha(color: string): string {
  return color.slice(0, 7);
}

export function SelectionInspector(props: Props) {
  const { t } = useTranslation();
  const selected = props.selection[0];
  const [moduleError, setModuleError] = useState(false);
  const [basicTextError, setBasicTextError] = useState(false);
  useEffect(() => {
    setModuleError(false);
    setBasicTextError(false);
  }, [selected?.id, selected?.kind]);
  if (selected === undefined) return <p>{t("inspector.emptySelection")}</p>;
  const edge =
    selected.kind === "edge" ? props.state.edges.get(selected.id) : undefined;
  const overlay =
    selected.kind === "overlay"
      ? props.state.overlays.get(selected.id)
      : undefined;
  const connection =
    selected.kind === "connection"
      ? props.state.connections.get(selected.id)
      : undefined;
  const moduleInstance =
    selected.kind === "module-instance"
      ? props.state.moduleInstances.get(selected.id)
      : undefined;
  const moduleReadonly = moduleInstance?.runtimeStatus === "missing";
  const selectedMemberCellIds = props.selection
    .filter((candidate) => candidate.kind === "cell")
    .map((candidate) => candidate.id);
  const commitModulePatch = (
    patch: Parameters<NonNullable<Props["onModuleInstance"]>>[1],
  ): boolean => {
    if (moduleInstance === undefined || moduleReadonly) return false;
    try {
      props.onModuleInstance?.(moduleInstance.instanceId, patch);
      setModuleError(false);
      return true;
    } catch {
      // 模块契约拒绝时保持运行时事实不变，并在面板内提供可见反馈。
      setModuleError(true);
      return false;
    }
  };
  const commitModuleJson = (
    key: "attributes" | "styleOverrides",
    value: string,
  ): boolean => {
    if (moduleInstance === undefined || moduleReadonly) return false;
    try {
      const parsed = JSON.parse(value) as unknown;
      if (
        parsed === null ||
        Array.isArray(parsed) ||
        typeof parsed !== "object"
      ) {
        setModuleError(true);
        return false;
      }
      return commitModulePatch({
        [key]: parsed as Readonly<Record<string, JsonValue>>,
      });
    } catch {
      // 非法 JSON 不产生历史或部分写入，并恢复已提交的实例事实。
      setModuleError(true);
      return false;
    }
  };
  const updateEdge = (patch: Partial<EdgeStyle>) => {
    if (edge === undefined) return;
    props.onEdgeStyle(edge.edgeId, {
      strokeColor: edge.strokeColor,
      strokeWidth: edge.strokeWidth,
      strokeOpacity: edge.strokeOpacity,
      lineStyle: edge.lineStyle,
      ...patch,
    });
  };
  const updateOverlay = (patch: Partial<OverlayData["style"]>) => {
    if (overlay === undefined) return;
    props.onOverlay(overlay.overlayId, {
      ...overlay,
      style: { ...overlay.style, ...patch },
    } as OverlayData);
  };
  const updateConnection = (patch: Partial<ConnectionData["style"]>) => {
    if (connection === undefined) return;
    props.onConnection(connection.connectionId, {
      ...connection,
      style: { ...connection.style, ...patch },
    });
  };
  return (
    <section className={styles.properties}>
      <p>{t("inspector.selectionCount", { count: props.selection.length })}</p>
      {moduleInstance === undefined && (
        <label>
          <span>{t("inspector.commonColor")}</span>
          <input
            type="color"
            defaultValue="#e3614d"
            onChange={(event) => props.onSelectionColor(event.target.value)}
          />
        </label>
      )}
      {moduleInstance !== undefined && (
        <div className={styles.fieldGrid}>
          <p>{moduleInstance.elementId}</p>
          <small>{moduleInstance.layerId}</small>
          {moduleReadonly && (
            <p role="status">{t("inspector.moduleMissingReadonly")}</p>
          )}
          {moduleError && (
            <p role="alert">{t("inspector.moduleUpdateInvalid")}</p>
          )}
          {moduleInstance.kind === "domain-group" && (
            <section>
              <p>
                {t("inspector.domainGroupMemberCount", {
                  count: moduleInstance.memberCellIds.length,
                })}
              </p>
              <button
                type="button"
                disabled={
                  moduleReadonly ||
                  selectedMemberCellIds.length < 2 ||
                  props.onDomainGroupMembers === undefined
                }
                onClick={() => {
                  try {
                    props.onDomainGroupMembers?.(
                      moduleInstance.instanceId,
                      selectedMemberCellIds,
                    );
                    setModuleError(false);
                  } catch {
                    // 领域成员约束失败时保留原实例，并沿用模块面板的非破坏性错误提示。
                    setModuleError(true);
                  }
                }}
              >
                {t("inspector.replaceDomainGroupMembers")}
              </button>
            </section>
          )}
          {(props.moduleRuleHints?.length ?? 0) > 0 && (
            <section aria-label={t("ruleHints.title")}>
              <strong>{t("ruleHints.title")}</strong>
              <ul>
                {props.moduleRuleHints?.map((hint) => (
                  <li
                    key={`${hint.kind}:${hint.constraintId ?? hint.slotId}`}
                    data-severity={hint.severity}
                  >
                    <strong>{t(`ruleHints.severity.${hint.severity}`)}</strong>{" "}
                    {hint.kind === "occupancy"
                      ? t("ruleHints.occupancy", {
                          slotId: hint.slotId,
                          count: hint.count,
                        })
                      : hint.message}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <label>
            <span>{t("inspector.moduleAttributes")}</span>
            <textarea
              key={`${moduleInstance.instanceId}:attributes:${JSON.stringify(moduleInstance.attributes)}`}
              defaultValue={JSON.stringify(moduleInstance.attributes, null, 2)}
              disabled={moduleReadonly}
              onBlur={(event) => {
                if (
                  !commitModuleJson("attributes", event.currentTarget.value)
                ) {
                  event.currentTarget.value = JSON.stringify(
                    moduleInstance.attributes,
                    null,
                    2,
                  );
                }
              }}
            />
          </label>
          <label>
            <span>{t("inspector.moduleStyleOverrides")}</span>
            <textarea
              key={`${moduleInstance.instanceId}:style:${JSON.stringify(moduleInstance.styleOverrides)}`}
              defaultValue={JSON.stringify(
                moduleInstance.styleOverrides,
                null,
                2,
              )}
              disabled={moduleReadonly}
              onBlur={(event) => {
                if (
                  !commitModuleJson("styleOverrides", event.currentTarget.value)
                ) {
                  event.currentTarget.value = JSON.stringify(
                    moduleInstance.styleOverrides,
                    null,
                    2,
                  );
                }
              }}
            />
          </label>
          {moduleInstance.kind === "connection" && (
            <label>
              <span>{t("inspector.shortLabel")}</span>
              <input
                type="text"
                key={`${moduleInstance.instanceId}:label:${moduleInstance.label ?? ""}`}
                defaultValue={moduleInstance.label ?? ""}
                disabled={moduleReadonly}
                onBlur={(event) => {
                  if (
                    !commitModulePatch({
                      label: event.currentTarget.value || null,
                    })
                  ) {
                    event.currentTarget.value = moduleInstance.label ?? "";
                  }
                }}
              />
            </label>
          )}
        </div>
      )}
      {edge !== undefined && (
        <div className={styles.fieldGrid}>
          <label>
            <span>{t("inspector.edgeColor")}</span>
            <input
              type="color"
              value={colorWithoutAlpha(edge.strokeColor)}
              onChange={(event) =>
                updateEdge({ strokeColor: `${event.target.value}FF` })
              }
            />
          </label>
          <label>
            <span>{t("inspector.strokeWidth")}</span>
            <input
              type="number"
              min="0.5"
              max="64"
              step="0.5"
              value={edge.strokeWidth}
              onChange={(event) =>
                updateEdge({ strokeWidth: Number(event.target.value) })
              }
            />
          </label>
          <label>
            <span>{t("inspector.opacity")}</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={edge.strokeOpacity}
              onChange={(event) =>
                updateEdge({ strokeOpacity: Number(event.target.value) })
              }
            />
          </label>
          <label>
            <span>{t("inspector.lineStyle")}</span>
            <select
              value={edge.lineStyle}
              onChange={(event) =>
                updateEdge({
                  lineStyle: event.target.value as "solid" | "dashed",
                })
              }
            >
              <option value="solid">{t("lineStyle.solid")}</option>
              <option value="dashed">{t("lineStyle.dashed")}</option>
            </select>
          </label>
        </div>
      )}
      {overlay?.overlayType === "text" && (
        <div className={styles.fieldGrid}>
          {basicTextError && <p role="alert">{t("error.moduleTextInvalid")}</p>}
          <label>
            <span>{t("inspector.text")}</span>
            <textarea
              value={overlay.text}
              onChange={(event) => {
                const text = event.target.value;
                if (!projectTextContentValid(text)) {
                  setBasicTextError(true);
                  return;
                }
                setBasicTextError(false);
                props.onOverlay(overlay.overlayId, {
                  ...overlay,
                  text,
                });
              }}
            />
          </label>
          <label>
            <span>{t("inspector.fontSize")}</span>
            <input
              type="number"
              min="8"
              max="256"
              value={overlay.style.fontSize}
              onChange={(event) =>
                updateOverlay({ fontSize: Number(event.target.value) })
              }
            />
          </label>
          <label>
            <span>{t("inspector.textColor")}</span>
            <input
              type="color"
              value={colorWithoutAlpha(overlay.style.color)}
              onChange={(event) =>
                updateOverlay({ color: `${event.target.value}FF` })
              }
            />
          </label>
          <label>
            <span>{t("inspector.fontWeight")}</span>
            <select
              value={overlay.style.fontWeight}
              onChange={(event) =>
                updateOverlay({
                  fontWeight: event.target.value as "normal" | "bold",
                })
              }
            >
              <option value="normal">{t("fontWeight.normal")}</option>
              <option value="bold">{t("fontWeight.bold")}</option>
            </select>
          </label>
          <label>
            <span>{t("inspector.align")}</span>
            <select
              value={overlay.style.align}
              onChange={(event) =>
                updateOverlay({
                  align: event.target.value as "left" | "center" | "right",
                })
              }
            >
              <option value="left">{t("align.left")}</option>
              <option value="center">{t("align.center")}</option>
              <option value="right">{t("align.right")}</option>
            </select>
          </label>
          <label>
            <span>{t("inspector.rotation")}</span>
            <input
              type="number"
              min="-360"
              max="360"
              step="1"
              value={overlay.style.rotation}
              onChange={(event) => {
                const rotation = Number(event.target.value);
                if (!Number.isFinite(rotation)) return;
                updateOverlay({ rotation: normalizeRotationDegrees(rotation) });
              }}
            />
          </label>
        </div>
      )}
      {overlay?.overlayType === "marker" && (
        <div className={styles.fieldGrid}>
          <label>
            <span>{t("inspector.markerShape")}</span>
            <select
              value={overlay.style.markerShape}
              onChange={(event) =>
                updateOverlay({
                  markerShape: event.target.value as
                    "circle" | "diamond" | "pin",
                })
              }
            >
              {(["circle", "diamond", "pin"] as const).map((shape) => (
                <option key={shape} value={shape}>
                  {t(`markerShape.${shape}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t("inspector.markerSize")}</span>
            <input
              type="number"
              min="8"
              max="256"
              value={overlay.style.size}
              onChange={(event) =>
                updateOverlay({ size: Number(event.target.value) })
              }
            />
          </label>
          <label>
            <span>{t("inspector.rotation")}</span>
            <input
              type="number"
              min="-360"
              max="360"
              value={overlay.style.rotation}
              onChange={(event) =>
                updateOverlay({
                  rotation: normalizeRotationDegrees(
                    Number(event.target.value),
                  ),
                })
              }
            />
          </label>
          <label>
            <span>{t("inspector.opacity")}</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={overlay.style.opacity}
              onChange={(event) =>
                updateOverlay({ opacity: Number(event.target.value) })
              }
            />
          </label>
          <label>
            <span>{t("inspector.markerColor")}</span>
            <input
              type="color"
              value={colorWithoutAlpha(overlay.style.color)}
              onChange={(event) =>
                updateOverlay({ color: `${event.target.value}FF` })
              }
            />
          </label>
        </div>
      )}
      {connection !== undefined && (
        <div className={styles.fieldGrid}>
          <label>
            <span>{t("inspector.connectionColor")}</span>
            <input
              type="color"
              value={colorWithoutAlpha(connection.style.strokeColor)}
              onChange={(event) =>
                updateConnection({ strokeColor: `${event.target.value}FF` })
              }
            />
          </label>
          <label>
            <span>{t("inspector.shortLabel")}</span>
            <input
              type="text"
              value={connection.label ?? ""}
              maxLength={64}
              onChange={(event) =>
                props.onConnection(connection.connectionId, {
                  ...connection,
                  label: event.target.value || null,
                })
              }
            />
          </label>
          <label>
            <span>{t("inspector.strokeWidth")}</span>
            <input
              type="number"
              min="0.5"
              max="64"
              step="0.5"
              value={connection.style.strokeWidth}
              onChange={(event) =>
                updateConnection({ strokeWidth: Number(event.target.value) })
              }
            />
          </label>
          <label>
            <span>{t("inspector.opacity")}</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={connection.style.strokeOpacity}
              onChange={(event) =>
                updateConnection({
                  strokeOpacity: Number(event.target.value),
                })
              }
            />
          </label>
          <label>
            <span>{t("inspector.lineStyle")}</span>
            <select
              value={connection.style.lineStyle}
              onChange={(event) =>
                updateConnection({
                  lineStyle: event.target.value as "solid" | "dashed",
                })
              }
            >
              <option value="solid">{t("lineStyle.solid")}</option>
              <option value="dashed">{t("lineStyle.dashed")}</option>
            </select>
          </label>
          {connection.kind === "arrow" && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={connection.arrowStart}
                  onChange={(event) =>
                    props.onConnection(connection.connectionId, {
                      ...connection,
                      arrowStart: event.target.checked,
                    })
                  }
                />
                {t("inspector.arrowBoth")}
              </label>
              <button
                type="button"
                onClick={() =>
                  props.onReverseConnection(connection.connectionId)
                }
              >
                {t("inspector.reverseConnection")}
              </button>
            </>
          )}
          <button
            type="button"
            aria-pressed={
              props.connectionRebind?.connectionId ===
                connection.connectionId &&
              props.connectionRebind.endpoint === "start"
            }
            onClick={() =>
              props.onBeginConnectionRebind({
                connectionId: connection.connectionId,
                endpoint: "start",
              })
            }
          >
            {t("inspector.rebindStart")}
          </button>
          <button
            type="button"
            aria-pressed={
              props.connectionRebind?.connectionId ===
                connection.connectionId &&
              props.connectionRebind.endpoint === "end"
            }
            onClick={() =>
              props.onBeginConnectionRebind({
                connectionId: connection.connectionId,
                endpoint: "end",
              })
            }
          >
            {t("inspector.rebindEnd")}
          </button>
          {props.connectionRebind?.connectionId === connection.connectionId && (
            <div className={styles.rebindStatus} role="status">
              <span>
                {t(
                  props.connectionRebind.endpoint === "start"
                    ? "inspector.rebindingStart"
                    : "inspector.rebindingEnd",
                )}
              </span>
              <button type="button" onClick={props.onCancelConnectionRebind}>
                {t("action.cancel")}
              </button>
            </div>
          )}
        </div>
      )}
      <ul>
        {props.selection.map((item) => (
          <li key={`${item.kind}:${item.id}`}>
            <span>{t(`object.${item.kind}`)}</span>
            <small>{item.id}</small>
          </li>
        ))}
      </ul>
      <button
        className={styles.danger}
        type="button"
        disabled={moduleReadonly}
        onClick={props.onDelete}
      >
        {t("action.delete")}
      </button>
    </section>
  );
}

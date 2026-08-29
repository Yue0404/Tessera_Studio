import type { TFunction } from "i18next";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  normalizeRotationDegrees,
  parseCellId,
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
  moduleInstanceColor?: {
    readonly instanceId: string;
    readonly key: "fillColor" | "strokeColor" | "color";
    readonly value: string;
  };
  connectionRebind: ConnectionRebindTarget | null;
  onReverseConnection(connectionId: string): void;
  onBeginConnectionRebind(target: ConnectionRebindTarget): void;
  onCancelConnectionRebind(): void;
  onDelete(): void;
  onDeleteObject?(selected: SelectedObject): void;
  onSelectionHover?(selected: SelectedObject | null): void;
}

function colorWithoutAlpha(color: string): string {
  return color.slice(0, 7);
}

function compactNumber(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/u, "").replace(/\.$/u, "");
}

function cellCoordinate(t: TFunction, id: string): string {
  try {
    const coordinate = parseCellId(id);
    return t("inspector.coordinate.cell", {
      row: coordinate.row,
      column: coordinate.column,
    });
  } catch {
    return id;
  }
}

function pointCoordinate(
  t: TFunction,
  point: { x: number; y: number },
): string {
  return t("inspector.coordinate.point", {
    x: compactNumber(point.x),
    y: compactNumber(point.y),
  });
}

function endpointCoordinate(
  t: TFunction,
  endpoint:
    | ConnectionData["start"]
    | {
        readonly kind: "cell-center";
        readonly cellId: string;
      }
    | {
        readonly kind: "edge-midpoint";
        readonly edgeId: string;
      }
    | {
        readonly kind: "map-point";
        readonly point: { readonly x: number; readonly y: number };
      },
): string {
  if (endpoint.kind === "cell-center")
    return cellCoordinate(t, endpoint.cellId);
  if (endpoint.kind === "edge-midpoint") return endpoint.edgeId;
  return pointCoordinate(t, endpoint.point);
}

function selectionSummary(
  t: TFunction,
  state: Readonly<ProjectState>,
  selected: SelectedObject,
): { coordinate: string; description: string } {
  if (selected.kind === "cell") {
    return {
      coordinate: cellCoordinate(t, selected.id),
      description: t("inspector.summary.cell"),
    };
  }
  if (selected.kind === "edge") {
    const edge = state.edges.get(selected.id);
    return {
      coordinate:
        edge === undefined
          ? selected.id
          : edge.adjacentCellIds.map((id) => cellCoordinate(t, id)).join(" ↔ "),
      description: t("inspector.summary.edge"),
    };
  }
  if (selected.kind === "overlay") {
    const overlay = state.overlays.get(selected.id);
    if (overlay === undefined)
      return { coordinate: selected.id, description: selected.id };
    const coordinate =
      overlay.kind === "free-overlay"
        ? pointCoordinate(t, overlay.point)
        : overlay.anchor.kind === "cell"
          ? cellCoordinate(t, overlay.anchor.cellId)
          : overlay.anchor.edgeId;
    return {
      coordinate,
      description:
        overlay.overlayType === "text"
          ? overlay.text.slice(0, 32) || t("inspector.summary.text")
          : overlay.label?.slice(0, 32) ||
            t("inspector.summary.marker", {
              shape: t(`markerShape.${overlay.style.markerShape}`),
            }),
    };
  }
  if (selected.kind === "connection") {
    const connection = state.connections.get(selected.id);
    return connection === undefined
      ? { coordinate: selected.id, description: selected.id }
      : {
          coordinate: `${endpointCoordinate(t, connection.start)} → ${endpointCoordinate(t, connection.end)}`,
          description:
            connection.label ??
            t(
              connection.kind === "arrow"
                ? "inspector.summary.arrow"
                : "inspector.summary.connection",
            ),
        };
  }
  const instance = state.moduleInstances.get(selected.id);
  if (instance === undefined)
    return { coordinate: selected.id, description: selected.id };
  let coordinate = selected.id;
  if (instance.kind === "cell") coordinate = cellCoordinate(t, instance.cellId);
  else if (instance.kind === "edge") coordinate = instance.edgeId;
  else if (instance.kind === "overlay") {
    coordinate =
      instance.objectKind === "free-overlay" && instance.point !== undefined
        ? pointCoordinate(t, instance.point)
        : instance.anchor?.kind === "cell"
          ? cellCoordinate(t, instance.anchor.cellId)
          : (instance.anchor?.edgeId ?? selected.id);
  } else if (instance.kind === "connection") {
    coordinate = `${endpointCoordinate(t, instance.start)} → ${endpointCoordinate(t, instance.end)}`;
  } else if (instance.memberCellIds[0] !== undefined) {
    coordinate = t("inspector.coordinate.group", {
      anchor: cellCoordinate(t, instance.memberCellIds[0]),
      count: instance.memberCellIds.length,
    });
  }
  return { coordinate, description: instance.elementId };
}

export function SelectionInspector(props: Props) {
  const { t } = useTranslation();
  const { onSelectionHover } = props;
  const [focusedSelectionKey, setFocusedSelectionKey] = useState<string | null>(
    null,
  );
  const summaryList = useRef<HTMLUListElement>(null);
  const summaryScrollTop = useRef(0);
  const selected =
    props.selection.length > 1 && focusedSelectionKey !== null
      ? props.selection.find(
          (candidate) =>
            `${candidate.kind}:${candidate.id}` === focusedSelectionKey,
        )
      : props.selection.length === 1
        ? props.selection[0]
        : undefined;
  const [moduleError, setModuleError] = useState(false);
  const [basicTextError, setBasicTextError] = useState(false);
  useEffect(() => {
    setModuleError(false);
    setBasicTextError(false);
  }, [selected?.id, selected?.kind]);
  useEffect(() => {
    if (
      focusedSelectionKey !== null &&
      !props.selection.some(
        (candidate) =>
          `${candidate.kind}:${candidate.id}` === focusedSelectionKey,
      )
    ) {
      setFocusedSelectionKey(null);
    }
  }, [focusedSelectionKey, props.selection]);
  useEffect(
    () => () => {
      onSelectionHover?.(null);
    },
    [onSelectionHover],
  );
  useLayoutEffect(() => {
    if (focusedSelectionKey === null && summaryList.current !== null) {
      summaryList.current.scrollTop = summaryScrollTop.current;
    }
  }, [focusedSelectionKey]);

  if (props.selection.length > 1 && selected === undefined) {
    return (
      <section className={styles.properties}>
        <div className={styles.inspectorTopActions}>
          <p>
            {t("inspector.selectionCount", { count: props.selection.length })}
          </p>
          <button
            className={styles.danger}
            type="button"
            onClick={props.onDelete}
          >
            {t("action.deleteSelection", { count: props.selection.length })}
          </button>
        </div>
        <ul
          ref={summaryList}
          className={styles.selectionList}
          aria-label={t("inspector.selectionSummary")}
        >
          {props.selection.map((item) => {
            const summary = selectionSummary(t, props.state, item);
            const key = `${item.kind}:${item.id}`;
            return (
              <li key={key}>
                <button
                  type="button"
                  data-selection-key={key}
                  onMouseEnter={() => props.onSelectionHover?.(item)}
                  onMouseLeave={() => props.onSelectionHover?.(null)}
                  onFocus={() => props.onSelectionHover?.(item)}
                  onBlur={() => props.onSelectionHover?.(null)}
                  onClick={() => {
                    summaryScrollTop.current =
                      summaryList.current?.scrollTop ?? 0;
                    props.onSelectionHover?.(null);
                    setFocusedSelectionKey(key);
                  }}
                >
                  <strong>{t(`object.${item.kind}`)}</strong>
                  <span>{summary.coordinate}</span>
                  <small>{summary.description}</small>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }
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
  const detailSummary = selectionSummary(t, props.state, selected);
  return (
    <section className={styles.properties}>
      <div className={styles.inspectorTopActions}>
        {props.selection.length > 1 && (
          <button
            type="button"
            className={styles.backButton}
            onClick={() => {
              props.onSelectionHover?.(null);
              setFocusedSelectionKey(null);
            }}
          >
            {t("action.back")}
          </button>
        )}
        <p>
          {t("inspector.selectionCount", { count: props.selection.length })}
        </p>
        <button
          className={styles.danger}
          type="button"
          disabled={
            moduleReadonly ||
            (props.selection.length > 1 && props.onDeleteObject === undefined)
          }
          onClick={() => {
            if (props.selection.length > 1) props.onDeleteObject?.(selected);
            else props.onDelete();
            setFocusedSelectionKey(null);
          }}
        >
          {props.selection.length > 1
            ? t("action.deleteObject")
            : t("action.delete")}
        </button>
      </div>
      <div className={styles.detailIdentity}>
        <strong>{t(`object.${selected.kind}`)}</strong>
        <span>{detailSummary.coordinate}</span>
        <small>{detailSummary.description}</small>
      </div>
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
            </section>
          )}
          {moduleInstance.kind === "domain-group" &&
          props.moduleInstanceColor?.instanceId ===
            moduleInstance.instanceId ? (
            <label>
              <span>{t("inspector.objectColor")}</span>
              <input
                type="color"
                value={colorWithoutAlpha(props.moduleInstanceColor.value)}
                disabled={moduleReadonly}
                onChange={(event) => {
                  const alpha =
                    props.moduleInstanceColor?.value.length === 9
                      ? props.moduleInstanceColor.value.slice(7, 9)
                      : "FF";
                  commitModulePatch({
                    styleOverrides: {
                      ...moduleInstance.styleOverrides,
                      [props.moduleInstanceColor?.key ?? "fillColor"]:
                        `${event.target.value}${alpha}`,
                    },
                  });
                }}
              />
            </label>
          ) : null}
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
            <span>{t("markerQuick.label")}</span>
            <input
              type="text"
              value={overlay.label ?? ""}
              maxLength={64}
              onChange={(event) =>
                props.onOverlay(overlay.overlayId, {
                  ...overlay,
                  label: event.currentTarget.value || null,
                })
              }
            />
          </label>
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
    </section>
  );
}

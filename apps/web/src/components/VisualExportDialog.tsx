import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProjectState } from "@tessera/core";
import type { VisualExportCaptureOptions } from "@tessera/renderer/visual-export";
import type {
  InteractionRangeSnapshot,
  VisualExportRangeSource,
} from "../visual-export-range.js";
import type {
  VisualExportErrorPresentation,
  VisualExportWorkflowRequest,
  VisualExportWorkflowSession,
  downloadVisualExportResult,
  startVisualExportWorkflow,
  visualExportErrorPresentation,
} from "../visual-export-workflow.js";
import styles from "./WorkflowDialog.module.css";

interface VisualExportWorkflowModule {
  readonly startVisualExportWorkflow: typeof startVisualExportWorkflow;
  readonly downloadVisualExportResult: typeof downloadVisualExportResult;
  readonly visualExportErrorPresentation: typeof visualExportErrorPresentation;
}

type VisualExportWorkflowLoader = () => Promise<VisualExportWorkflowModule>;

const loadVisualExportWorkflow: VisualExportWorkflowLoader = () =>
  import("../visual-export-workflow.js");

interface Props {
  state: Readonly<ProjectState>;
  interaction: InteractionRangeSnapshot;
  initialCustomBounds: NonNullable<InteractionRangeSnapshot["viewportBounds"]>;
  workflowLoader?: VisualExportWorkflowLoader;
  captureOptions?: VisualExportCaptureOptions;
  onClose(): void;
}

type RangeKind = VisualExportRangeSource["kind"];

export function VisualExportDialog({
  state,
  interaction,
  initialCustomBounds,
  workflowLoader = loadVisualExportWorkflow,
  captureOptions,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [workflow, setWorkflow] = useState<VisualExportWorkflowModule | null>(
    null,
  );
  const [format, setFormat] = useState<"png" | "svg">("png");
  const [rangeKind, setRangeKind] = useState<RangeKind>("viewport");
  const [custom, setCustom] = useState({ ...initialCustomBounds });
  const [scale, setScale] = useState<1 | 2 | 4>(1);
  const [backgroundKind, setBackgroundKind] = useState<"transparent" | "color">(
    "transparent",
  );
  const [backgroundColor, setBackgroundColor] = useState(
    state.style.canvasBackground,
  );
  const [showGrid, setShowGrid] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<VisualExportErrorPresentation | null>(
    null,
  );
  const taskRef = useRef<VisualExportWorkflowSession | null>(null);
  const preparationAbortRef = useRef<AbortController | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const runIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    let active = true;
    void workflowLoader()
      .then((module) => {
        if (active) setWorkflow(module);
      })
      .catch(() => {
        if (!active) return;
        setError({
          messageKey: "error.visualExportFailed",
          actionKey: "visualExport.action.reduceRange",
          action: "reduce-range",
          cancelled: false,
        });
      });
    return () => {
      active = false;
    };
  }, [workflowLoader]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runIdRef.current += 1;
      unsubscribeRef.current?.();
      preparationAbortRef.current?.abort();
      taskRef.current?.cancel();
    };
  }, []);

  const rangeSource = (): VisualExportRangeSource =>
    rangeKind === "viewport"
      ? { kind: "viewport" }
      : rangeKind === "selection"
        ? { kind: "selection" }
        : rangeKind === "custom"
          ? { kind: "custom", bounds: { ...custom } }
          : rangeKind === "content-bounds"
            ? { kind: "content-bounds" }
            : { kind: "full-map" };

  const stopSubscriptions = () => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    taskRef.current = null;
  };

  const start = async () => {
    if (workflow === null || running) return;
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    setRunning(true);
    setProgress(null);
    setError(null);
    setSummary(null);
    const preparationAbort = new AbortController();
    preparationAbortRef.current = preparationAbort;
    let session: VisualExportWorkflowSession;
    try {
      const request: VisualExportWorkflowRequest = {
        format,
        range: rangeSource(),
        interaction,
        background:
          backgroundKind === "transparent"
            ? { kind: "transparent" }
            : { kind: "color", color: backgroundColor },
        showGrid,
        scale,
        signal: preparationAbort.signal,
        ...(captureOptions === undefined ? {} : { captureOptions }),
      };
      session = await workflow.startVisualExportWorkflow(state, request);
      preparationAbortRef.current = null;
      taskRef.current = session;
      const workerReady =
        session.capabilities.worker &&
        session.capabilities.offscreenCanvas2d &&
        session.capabilities.offscreenConvertToBlob;
      setSummary(
        t("visualExport.summary", {
          width: session.plan.pixelWidth,
          height: session.plan.pixelHeight,
          mode:
            format === "svg"
              ? t("visualExport.mode.svg")
              : workerReady
                ? t("visualExport.mode.worker")
                : t("visualExport.mode.fallback"),
        }),
      );
      unsubscribeRef.current = session.subscribeProgress((event) => {
        if (
          mountedRef.current &&
          runIdRef.current === runId &&
          event.taskId === session.taskId
        ) {
          setProgress(event.progress);
        }
      });
    } catch (caught) {
      preparationAbortRef.current = null;
      if (mountedRef.current && runIdRef.current === runId) {
        setError(workflow.visualExportErrorPresentation(caught));
        setRunning(false);
      }
      return;
    }
    try {
      const result = await session.result;
      if (!mountedRef.current || runIdRef.current !== runId) return;
      workflow.downloadVisualExportResult(result, state.name);
      stopSubscriptions();
      onClose();
    } catch (caught) {
      if (!mountedRef.current || runIdRef.current !== runId) return;
      setError(workflow.visualExportErrorPresentation(caught));
      stopSubscriptions();
      setRunning(false);
    }
  };

  const close = () => {
    runIdRef.current += 1;
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    preparationAbortRef.current?.abort();
    preparationAbortRef.current = null;
    taskRef.current?.cancel();
    taskRef.current = null;
    onClose();
  };

  const applyErrorAction = () => {
    if (error?.action === "reduce-scale") {
      setScale(1);
    } else if (error?.action === "reset-background") {
      setBackgroundKind("transparent");
      setBackgroundColor(state.style.canvasBackground);
    } else if (error?.action === "switch-svg") {
      setFormat("svg");
    } else {
      setRangeKind("viewport");
    }
    setError(null);
  };

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onKeyDown={(event) => {
        if (event.key === "Escape") close();
      }}
    >
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="visual-export-title"
      >
        <h2 id="visual-export-title">{t("visualExport.title")}</h2>
        <fieldset className={styles.option} disabled={running}>
          <legend>{t("visualExport.format")}</legend>
          <label>
            <input
              autoFocus
              type="radio"
              name="visual-export-format"
              checked={format === "png"}
              onChange={() => setFormat("png")}
            />
            {t("visualExport.format.png")}
          </label>
          <label>
            <input
              type="radio"
              name="visual-export-format"
              checked={format === "svg"}
              onChange={() => setFormat("svg")}
            />
            {t("visualExport.format.svg")}
          </label>
        </fieldset>
        <label className={styles.field}>
          {t("visualExport.range")}
          <select
            value={rangeKind}
            disabled={running}
            onChange={(event) => setRangeKind(event.target.value as RangeKind)}
          >
            <option value="viewport">{t("visualExport.range.viewport")}</option>
            <option
              value="selection"
              disabled={interaction.selectionBounds === null}
            >
              {t("visualExport.range.selection")}
            </option>
            <option value="custom">{t("visualExport.range.custom")}</option>
            <option value="content-bounds">
              {t("visualExport.range.content")}
            </option>
            <option value="full-map">{t("visualExport.range.full")}</option>
          </select>
        </label>
        {rangeKind === "custom" && (
          <div className={styles.rect}>
            {(["minX", "minY", "maxX", "maxY"] as const).map((key) => (
              <label className={styles.field} key={key}>
                {t(`dataExport.bounds.${key}`)}
                <input
                  type="number"
                  disabled={running}
                  value={custom[key]}
                  onChange={(event) =>
                    setCustom((current) => ({
                      ...current,
                      [key]: Number(event.target.value),
                    }))
                  }
                />
              </label>
            ))}
          </div>
        )}
        {format === "png" && (
          <fieldset className={styles.option} disabled={running}>
            <legend>{t("visualExport.scale")}</legend>
            {([1, 2, 4] as const).map((value) => (
              <label key={value}>
                <input
                  type="radio"
                  name="visual-export-scale"
                  checked={scale === value}
                  onChange={() => setScale(value)}
                />
                {t("visualExport.scale.option", { value })}
              </label>
            ))}
          </fieldset>
        )}
        <fieldset className={styles.option} disabled={running}>
          <legend>{t("visualExport.background")}</legend>
          <label>
            <input
              type="radio"
              name="visual-export-background"
              checked={backgroundKind === "transparent"}
              onChange={() => setBackgroundKind("transparent")}
            />
            {t("visualExport.background.transparent")}
          </label>
          <label>
            <input
              type="radio"
              name="visual-export-background"
              checked={backgroundKind === "color"}
              onChange={() => setBackgroundKind("color")}
            />
            {t("visualExport.background.color")}
          </label>
          {backgroundKind === "color" && (
            <input
              aria-label={t("visualExport.background.rgba")}
              type="text"
              value={backgroundColor}
              onChange={(event) => setBackgroundColor(event.target.value)}
            />
          )}
        </fieldset>
        <label className={styles.option}>
          <span>
            <input
              type="checkbox"
              checked={showGrid}
              disabled={running}
              onChange={(event) => setShowGrid(event.target.checked)}
            />{" "}
            {t("visualExport.showGrid")}
          </span>
        </label>
        {summary !== null && <p className={styles.muted}>{summary}</p>}
        {progress !== null && (
          <label className={styles.field}>
            {t("visualExport.progress", {
              progress: Math.round(progress * 100),
            })}
            <progress max={1} value={progress} />
          </label>
        )}
        {error !== null && (
          <div role="alert" className={styles.error}>
            <p>{t(error.messageKey)}</p>
            {!error.cancelled && (
              <button type="button" onClick={applyErrorAction}>
                {t(error.actionKey)}
              </button>
            )}
          </div>
        )}
        <div className={styles.actions}>
          <button type="button" onClick={close}>
            {t("action.close")}
          </button>
          {running ? (
            <button
              type="button"
              className={styles.danger}
              onClick={() => {
                preparationAbortRef.current?.abort();
                taskRef.current?.cancel();
              }}
            >
              {t("visualExport.cancel")}
            </button>
          ) : (
            <button
              type="button"
              className={styles.primary}
              disabled={workflow === null}
              onClick={() => void start()}
            >
              {t(
                workflow === null
                  ? "visualExport.loading"
                  : "visualExport.start",
              )}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

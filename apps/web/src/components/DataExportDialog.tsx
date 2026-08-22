import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProjectState } from "@tessera/core";
import type {
  DataExportBounds,
  DataExportRequest,
} from "../data-export-workflow.js";
import styles from "./WorkflowDialog.module.css";

interface Props {
  state: Readonly<ProjectState>;
  selectionBounds: DataExportBounds | null;
  initialCustomBounds: DataExportBounds;
  onClose(): void;
}

type Kind = DataExportRequest["kind"];
type RangeKind = "selection" | "custom";

export function DataExportDialog({
  state,
  selectionBounds,
  initialCustomBounds,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<Kind>("full-project");
  const [rangeKind, setRangeKind] = useState<RangeKind>(
    selectionBounds === null ? "custom" : "selection",
  );
  const [custom, setCustom] = useState(initialCustomBounds);
  const allLayers = useMemo(
    () =>
      [...state.layers.values()].filter(
        (layer) => layer.layerId !== "tessera.system.grid",
      ),
    [state.layers],
  );
  const [layerIds, setLayerIds] = useState(
    () => new Set(allLayers.map((layer) => layer.layerId)),
  );
  const [fragmentId, setFragmentId] = useState<string>(() =>
    crypto.randomUUID(),
  );
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErrorKey(null);
    setBusy(true);
    try {
      const workflow = await import("../data-export-workflow.js");
      let request: DataExportRequest;
      if (kind === "full-project") {
        request = { kind };
      } else {
        const bounds = rangeKind === "selection" ? selectionBounds : custom;
        if (bounds === null) {
          setErrorKey("error.dataExportSelectionMissing");
          return;
        }
        const includedLayerIds = [...layerIds];
        request =
          kind === "partial-project"
            ? { kind, bounds, includedLayerIds }
            : { kind, bounds, includedLayerIds, fragmentId };
      }
      const artifact = workflow.createDataExportArtifact(state, request);
      workflow.downloadDataExportArtifact(artifact);
      onClose();
    } catch (error) {
      const workflow = await import("../data-export-workflow.js");
      setErrorKey(workflow.dataExportErrorTranslationKey(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) onClose();
      }}
    >
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="data-export-title"
      >
        <h2 id="data-export-title">{t("dataExport.title")}</h2>
        <div className={styles.option}>
          {(["full-project", "partial-project", "fragment"] as const).map(
            (value, index) => (
              <label key={value}>
                <input
                  type="radio"
                  name="data-export-kind"
                  value={value}
                  checked={kind === value}
                  autoFocus={index === 0}
                  onChange={() => setKind(value)}
                />
                {t(`dataExport.kind.${value}`)}
              </label>
            ),
          )}
        </div>
        {kind !== "full-project" && (
          <>
            <fieldset className={styles.option}>
              <legend>{t("dataExport.range")}</legend>
              <label>
                <input
                  type="radio"
                  name="data-export-range"
                  checked={rangeKind === "selection"}
                  disabled={selectionBounds === null}
                  onChange={() => setRangeKind("selection")}
                />
                {t("dataExport.range.selection")}
              </label>
              <label>
                <input
                  type="radio"
                  name="data-export-range"
                  checked={rangeKind === "custom"}
                  onChange={() => setRangeKind("custom")}
                />
                {t("dataExport.range.custom")}
              </label>
              {selectionBounds === null && (
                <span className={styles.muted}>
                  {t("dataExport.selectionUnavailable")}
                </span>
              )}
            </fieldset>
            {rangeKind === "custom" && (
              <div className={styles.rect}>
                {(["minX", "minY", "maxX", "maxY"] as const).map((key) => (
                  <label className={styles.field} key={key}>
                    {t(`dataExport.bounds.${key}`)}
                    <input
                      type="number"
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
            <fieldset className={styles.layers}>
              <legend>{t("dataExport.layers")}</legend>
              {allLayers.map((layer) => (
                <label key={layer.layerId}>
                  <input
                    type="checkbox"
                    checked={layerIds.has(layer.layerId)}
                    onChange={(event) => {
                      const next = new Set(layerIds);
                      if (event.target.checked) next.add(layer.layerId);
                      else next.delete(layer.layerId);
                      setLayerIds(next);
                    }}
                  />
                  {t(`layer.${layer.layerId}`)}
                </label>
              ))}
            </fieldset>
          </>
        )}
        {kind === "fragment" && (
          <label className={styles.field}>
            {t("dataExport.fragmentId")}
            <input
              type="text"
              value={fragmentId}
              onChange={(event) => setFragmentId(event.target.value)}
            />
          </label>
        )}
        {kind === "full-project" && (
          <p className={styles.muted}>{t("dataExport.fullHint")}</p>
        )}
        {errorKey !== null && (
          <p role="alert" className={styles.error}>
            {t(errorKey)}
          </p>
        )}
        <div className={styles.actions}>
          <button type="button" disabled={busy} onClick={onClose}>
            {t("action.cancel")}
          </button>
          <button
            type="button"
            className={styles.primary}
            disabled={busy}
            onClick={() => void submit()}
          >
            {t(busy ? "dataExport.preparing" : "dataExport.download")}
          </button>
        </div>
      </section>
    </div>
  );
}

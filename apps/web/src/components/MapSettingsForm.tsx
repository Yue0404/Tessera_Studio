import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProjectGrid } from "@tessera/core";
import styles from "./ContextPanel.module.css";

interface Props {
  value: Readonly<ProjectGrid>;
  disabled?: boolean;
  externalError?: string | null;
  onSubmit(value: ProjectGrid): void;
}

interface Draft {
  width: string;
  height: string;
  cellSize: string;
}

function draftFromGrid(value: Readonly<ProjectGrid>): Draft {
  return {
    width: String(value.width),
    height: String(value.height),
    cellSize: String(value.cellSize),
  };
}

export function MapSettingsForm({
  value,
  disabled = false,
  externalError = null,
  onSubmit,
}: Props) {
  const { t } = useTranslation();
  const { type, width, height, cellSize } = value;
  const [draft, setDraft] = useState(() => draftFromGrid(value));
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setDraft({
      width: String(width),
      height: String(height),
      cellSize: String(cellSize),
    });
    setLocalError(null);
  }, [cellSize, height, width]);

  const updateDraft = (key: keyof Draft, next: string) => {
    setDraft((current) => ({ ...current, [key]: next }));
    setLocalError(null);
  };

  return (
    <form
      className={styles.mapSettingsForm}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const width = Number(draft.width);
        const height = Number(draft.height);
        const cellSize = Number(draft.cellSize);
        if (
          !Number.isInteger(width) ||
          !Number.isInteger(height) ||
          width < 1 ||
          width > 40_000 ||
          height < 1 ||
          height > 40_000
        ) {
          setLocalError(t("mapSettings.error.size"));
          return;
        }
        if (!Number.isInteger(cellSize) || cellSize < 12 || cellSize > 96) {
          setLocalError(t("mapSettings.error.cellSize"));
          return;
        }
        try {
          onSubmit({ type, width, height, cellSize });
        } catch {
          // 未知调用方异常不得让表单失去响应；Store 的标准拒绝码由 EditorView 单独翻译。
          setLocalError(t("mapSettings.error.rejected"));
        }
      }}
    >
      <label>
        <span>{t("field.width")}</span>
        <input
          type="number"
          min="1"
          max="40000"
          step="1"
          value={draft.width}
          disabled={disabled}
          onChange={(event) => updateDraft("width", event.currentTarget.value)}
        />
      </label>
      <label>
        <span>{t("field.height")}</span>
        <input
          type="number"
          min="1"
          max="40000"
          step="1"
          value={draft.height}
          disabled={disabled}
          onChange={(event) => updateDraft("height", event.currentTarget.value)}
        />
      </label>
      <label>
        <span>{t("field.cellSize")}</span>
        <input
          type="number"
          min="12"
          max="96"
          step="1"
          value={draft.cellSize}
          disabled={disabled}
          onChange={(event) =>
            updateDraft("cellSize", event.currentTarget.value)
          }
        />
      </label>
      {(localError ?? externalError) !== null && (
        <p role="alert">{localError ?? externalError}</p>
      )}
      <button type="submit" disabled={disabled}>
        {t("mapSettings.apply")}
      </button>
      {disabled && <small>{t("mapSettings.pendingApi")}</small>}
    </form>
  );
}

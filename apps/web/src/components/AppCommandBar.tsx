import {
  Download,
  FileInput,
  FileUp,
  FolderOpen,
  Redo2,
  Save,
  Settings,
  Trash2,
  Undo2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { ToolButton } from "./ToolButton.js";
import styles from "./AppCommandBar.module.css";

interface Props {
  projectName: string;
  saveStatusKey: string;
  canUndo: boolean;
  canRedo: boolean;
  canClear: boolean;
  onNew(): void;
  onOpen(): void;
  onImportFragment(): void;
  onSave(): void;
  onExport(): void;
  onPackageSettings(): void;
  onUndo(): void;
  onRedo(): void;
  onClear(): void;
}

export function AppCommandBar(props: Props) {
  const { t } = useTranslation();
  const toolButton = { tooltipSide: "bottom" as const };
  return (
    <div
      className={styles.wrap}
      role="toolbar"
      aria-label={t("toolbar.project")}
    >
      <div className={styles.brand}>
        <span>{t("app.name")}</span>
        <small>{t("app.englishName")}</small>
      </div>
      <div className={styles.group}>
        <ToolButton
          {...toolButton}
          label={t("action.new")}
          onClick={props.onNew}
        >
          <FileUp size={18} />
        </ToolButton>
        <ToolButton
          {...toolButton}
          label={t("action.open")}
          onClick={props.onOpen}
        >
          <FolderOpen size={18} />
        </ToolButton>
        <ToolButton
          {...toolButton}
          label={t("action.importFragment")}
          onClick={props.onImportFragment}
        >
          <FileInput size={18} />
        </ToolButton>
        <ToolButton
          {...toolButton}
          label={t("action.save")}
          onClick={props.onSave}
        >
          <Save size={18} />
        </ToolButton>
        <ToolButton
          {...toolButton}
          label={t("action.export")}
          onClick={props.onExport}
        >
          <Download size={18} />
        </ToolButton>
        <ToolButton
          {...toolButton}
          label={t("package.settings.open")}
          onClick={props.onPackageSettings}
        >
          <Settings size={18} />
        </ToolButton>
        <ToolButton
          {...toolButton}
          label={t("action.clearCanvas")}
          disabled={!props.canClear}
          onClick={() => {
            if (window.confirm(t("action.clearCanvasConfirm"))) props.onClear();
          }}
        >
          <Trash2 size={18} />
        </ToolButton>
      </div>
      <div className={styles.group}>
        <ToolButton
          {...toolButton}
          label={t("action.undo")}
          disabled={!props.canUndo}
          onClick={props.onUndo}
        >
          <Undo2 size={18} />
        </ToolButton>
        <ToolButton
          {...toolButton}
          label={t("action.redo")}
          disabled={!props.canRedo}
          onClick={props.onRedo}
        >
          <Redo2 size={18} />
        </ToolButton>
      </div>
      <div className={styles.project}>
        <strong>{props.projectName}</strong>
        <span data-testid="save-status">{t(props.saveStatusKey)}</span>
      </div>
    </div>
  );
}

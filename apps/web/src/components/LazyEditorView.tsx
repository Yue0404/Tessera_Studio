import { Suspense, lazy, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import type { EditorViewProps } from "./EditorView.js";
import { LazyLoadBoundary } from "./LazyLoadBoundary.js";

interface EditorViewModule {
  readonly EditorView: ComponentType<EditorViewProps>;
}

export type EditorViewLoader = () => Promise<EditorViewModule>;

const loadEditorViewDefault: EditorViewLoader = () => import("./EditorView.js");
const DefaultLazyEditor = lazy(async () => {
  const module = await loadEditorViewDefault();
  return { default: module.EditorView };
});

export interface LazyEditorViewProps extends EditorViewProps {
  readonly component?: ComponentType<EditorViewProps>;
  readonly onReload?: () => void;
}

export function LazyEditorView({
  component: EditorComponent = DefaultLazyEditor,
  onReload = () => window.location.reload(),
  ...editorProps
}: LazyEditorViewProps) {
  const { t } = useTranslation();
  return (
    <LazyLoadBoundary
      fallback={
        <div role="alert">
          <p>{t("editor.loadFailed")}</p>
          <button type="button" onClick={onReload}>
            {t("action.retry")}
          </button>
        </div>
      }
    >
      <Suspense fallback={<div role="status">{t("editor.loading")}</div>}>
        <EditorComponent {...editorProps} />
      </Suspense>
    </LazyLoadBoundary>
  );
}

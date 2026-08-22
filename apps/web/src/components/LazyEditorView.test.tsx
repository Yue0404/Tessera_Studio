import { I18nextProvider } from "react-i18next";
import { fireEvent, render, screen } from "@testing-library/react";
import { EditorStore, createProject } from "@tessera/core";
import { lazy, type ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";
import i18n from "../i18n.js";
import type { EditorViewProps } from "./EditorView.js";
import { LazyEditorView } from "./LazyEditorView.js";

let resolveDeferredEditor!: (module: {
  readonly default: ComponentType<EditorViewProps>;
}) => void;
const deferredEditor = new Promise<{
  readonly default: ComponentType<EditorViewProps>;
}>((resolve) => {
  resolveDeferredEditor = resolve;
});
const DeferredEditor = lazy(() => deferredEditor);

function FailingEditor(): never {
  throw new Error("chunk-load-failed");
}

function editorProps() {
  const store = new EditorStore(
    createProject({
      name: "懒加载测试",
      grid: { type: "square", width: 4, height: 4, cellSize: 24 },
      style: {
        canvasBackground: "#09141DFF",
        defaultCellColor: "#14232DFF",
        gridColor: "#59656AFF",
        gridOpacity: 0.7,
        gridWidth: 1,
        defaultEdgeColor: "#59656AFF",
      },
    }),
  );
  return {
    store,
    repository: { save: vi.fn(async () => undefined) },
    onNew: vi.fn(),
    onOpenFile: vi.fn(async () => undefined),
    onOpenFragmentFile: vi.fn(async () => undefined),
  };
}

describe("LazyEditorView", () => {
  it("模块完成前显示 key 化 loading，完成后渲染编辑器", async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <LazyEditorView {...editorProps()} component={DeferredEditor} />
      </I18nextProvider>,
    );
    expect(screen.getByRole("status").textContent).toBe(
      i18n.t("editor.loading"),
    );
    resolveDeferredEditor({ default: () => <div>editor-ready</div> });
    await screen.findByText("editor-ready");
  });

  it("动态模块失败不会白屏，重试行动可靠触发页面重新载入", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const onReload = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <LazyEditorView
          {...editorProps()}
          component={FailingEditor}
          onReload={onReload}
        />
      </I18nextProvider>,
    );
    await screen.findByText(i18n.t("editor.loadFailed"));
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("action.retry") }),
    );
    expect(onReload).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});

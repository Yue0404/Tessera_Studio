import { render, screen } from "@testing-library/react";
import { createProject, EditorStore } from "@tessera/core";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n.js";
import { EditorView } from "./EditorView.js";

const rendererMocks = vi.hoisted(() => ({
  destroy: vi.fn(),
  initialize: vi.fn<() => Promise<void>>(),
}));

vi.mock("@tessera/renderer", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    TesseraRenderer: class {
      initialize(): Promise<void> {
        return rendererMocks.initialize();
      }

      destroy(): void {
        rendererMocks.destroy();
      }
    },
  };
});

function project() {
  return createProject({
    name: "渲染初始化测试",
    grid: { type: "square", width: 4, height: 4, cellSize: 24 },
    style: {
      canvasBackground: "#09141DFF",
      defaultCellColor: "#14232DFF",
      gridColor: "#59656AFF",
      gridOpacity: 0.7,
      gridWidth: 1,
      defaultEdgeColor: "#59656AFF",
    },
  });
}

describe("EditorView renderer initialization", () => {
  beforeEach(() => {
    rendererMocks.destroy.mockReset();
    rendererMocks.initialize.mockReset();
  });

  it("初始化失败时显示可理解状态、保留原始诊断且只销毁一次", async () => {
    const failure = new Error("webgl-init-rejected");
    rendererMocks.initialize.mockRejectedValue(failure);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const store = new EditorStore(project());

    const view = render(
      <I18nextProvider i18n={i18n}>
        <EditorView
          store={store}
          repository={{ save: vi.fn(async () => undefined) }}
          onNew={vi.fn()}
          onOpenFile={vi.fn(async () => undefined)}
          onOpenFragmentFile={vi.fn(async () => undefined)}
        />
      </I18nextProvider>,
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "地图画布初始化失败，工程数据未受影响。请重新载入页面后重试。",
    );
    expect(consoleError).toHaveBeenCalledWith("地图渲染器初始化失败", failure);
    expect(rendererMocks.destroy).toHaveBeenCalledOnce();

    view.unmount();
    expect(rendererMocks.destroy).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });
});

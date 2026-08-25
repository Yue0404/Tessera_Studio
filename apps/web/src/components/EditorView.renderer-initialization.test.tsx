import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createProject, EditorStore, type SelectedObject } from "@tessera/core";
import type { RendererInteraction } from "@tessera/renderer";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n.js";
import { EditorView } from "./EditorView.js";

const rendererMocks = vi.hoisted(() => ({
  destroy: vi.fn(),
  initialize: vi.fn<() => Promise<void>>(),
  interaction: undefined as RendererInteraction | undefined,
}));

vi.mock("@tessera/renderer", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    TesseraRenderer: class {
      constructor(
        _host: HTMLElement,
        _state: unknown,
        interaction: RendererInteraction,
      ) {
        rendererMocks.interaction = interaction;
      }

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
    rendererMocks.interaction = undefined;
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

  it("渲染器命中对象后立即打开属性面板", async () => {
    rendererMocks.initialize.mockResolvedValue();
    const store = new EditorStore(project());
    const overlayId = store.placeMarker({ x: 36, y: 36 });
    render(
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
    const selection: SelectedObject[] = [{ kind: "overlay", id: overlayId }];
    await act(async () => rendererMocks.interaction?.select(selection, false));
    expect(screen.getByRole("heading", { name: "属性" })).toBeDefined();
    expect(screen.getByText("已选择 1 个对象")).toBeDefined();
    const inspector = screen
      .getByRole("heading", { name: "属性" })
      .closest("aside");
    if (inspector === null) throw new Error("属性面板缺失");
    expect(within(inspector).getByLabelText("标记形状")).toBeDefined();
  });

  it("目录中的标记和文字分别激活专属设置并共用标记工具", async () => {
    rendererMocks.initialize.mockResolvedValue();
    const store = new EditorStore(project());
    render(
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

    fireEvent.click(
      screen.getByRole("button", {
        name: "使用目录元素 tessera.basic:marker",
      }),
    );
    let settings = screen.getByRole("region", { name: "当前元素设置" });
    expect(
      within(settings).getByRole("heading", { name: "标记设置" }),
    ).toBeDefined();
    expect(within(settings).getByLabelText("标记形状")).toBeDefined();
    expect(within(settings).queryByLabelText("文字内容")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: /^标记$/u })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent.click(
      screen.getByRole("button", {
        name: "使用目录元素 tessera.basic:text",
      }),
    );
    settings = screen.getByRole("region", { name: "当前元素设置" });
    expect(
      within(settings).getByRole("heading", { name: "文字设置" }),
    ).toBeDefined();
    expect(within(settings).getByLabelText("文字内容")).toBeDefined();
    expect(within(settings).queryByLabelText("标记形状")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: /^标记$/u })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });
});

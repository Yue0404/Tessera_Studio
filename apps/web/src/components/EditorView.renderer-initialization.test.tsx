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
  render: vi.fn(),
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

      render(): void {
        rendererMocks.render();
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

function deferredSave() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("EditorView renderer initialization", () => {
  beforeEach(() => {
    rendererMocks.destroy.mockReset();
    rendererMocks.initialize.mockReset();
    rendererMocks.render.mockReset();
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

  it.each(["选择", "框选", "平移"])(
    "点击%s会关闭当前元素设置，目录保持可用",
    (toolName) => {
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
      fireEvent.click(screen.getByRole("button", { name: "画刷" }));
      expect(
        screen.getByRole("region", { name: "当前元素设置" }),
      ).toBeDefined();
      fireEvent.click(screen.getByRole("button", { name: toolName }));
      expect(screen.queryByRole("region", { name: "当前元素设置" })).toBeNull();
      expect(screen.getByRole("heading", { name: "元素目录" })).toBeDefined();
    },
  );

  it("瞬时指针预览不自动保存，持久化事务仅保存一次", async () => {
    vi.useFakeTimers();
    rendererMocks.initialize.mockResolvedValue();
    const store = new EditorStore(project());
    const save = vi.fn(async () => undefined);
    render(
      <I18nextProvider i18n={i18n}>
        <EditorView
          store={store}
          repository={{ save }}
          onNew={vi.fn()}
          onOpenFile={vi.fn(async () => undefined)}
          onOpenFragmentFile={vi.fn(async () => undefined)}
        />
      </I18nextProvider>,
    );

    act(() => {
      store.pointerMove({ x: 1, y: 1 });
      store.setTool("box-select");
      store.pointerDown({ x: 1, y: 1 }, null);
      store.pointerMove({ x: 2, y: 2 });
      vi.advanceTimersByTime(500);
    });
    expect(save).not.toHaveBeenCalled();

    act(() => store.paintCell(0, 0, "#FFFFFFFF"));
    await act(async () => vi.advanceTimersByTime(350));
    expect(save).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("载入高 revision 工程和替换 store 首挂载均不自动保存", () => {
    vi.useFakeTimers();
    rendererMocks.initialize.mockResolvedValue();
    const firstProject = project();
    firstProject.revision = 7;
    const firstStore = new EditorStore(firstProject);
    const save = vi.fn(async () => undefined);
    const view = render(
      <I18nextProvider i18n={i18n}>
        <EditorView
          store={firstStore}
          repository={{ save }}
          onNew={vi.fn()}
          onOpenFile={vi.fn(async () => undefined)}
          onOpenFragmentFile={vi.fn(async () => undefined)}
        />
      </I18nextProvider>,
    );
    act(() => vi.advanceTimersByTime(500));
    expect(save).not.toHaveBeenCalled();

    const secondProject = project();
    secondProject.revision = 9;
    const secondStore = new EditorStore(secondProject);
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <EditorView
          store={secondStore}
          repository={{ save }}
          onNew={vi.fn()}
          onOpenFile={vi.fn(async () => undefined)}
          onOpenFragmentFile={vi.fn(async () => undefined)}
        />
      </I18nextProvider>,
    );
    act(() => vi.advanceTimersByTime(500));
    expect(save).not.toHaveBeenCalled();

    act(() => secondStore.paintCell(0, 0, "#FFFFFFFF"));
    act(() => vi.advanceTimersByTime(350));
    expect(save).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("旧工程未保存状态在切换 store 后立即重置且不保存新工程", () => {
    vi.useFakeTimers();
    rendererMocks.initialize.mockResolvedValue();
    const save = vi.fn(async () => undefined);
    const repository = { save };
    const firstStore = new EditorStore(project());
    const view = render(
      <I18nextProvider i18n={i18n}>
        <EditorView
          store={firstStore}
          repository={repository}
          onNew={vi.fn()}
          onOpenFile={vi.fn(async () => undefined)}
          onOpenFragmentFile={vi.fn(async () => undefined)}
        />
      </I18nextProvider>,
    );
    act(() => firstStore.paintCell(0, 0, "#FFFFFFFF"));
    expect(screen.getByTestId("save-status").textContent).toBe("有未保存修改");

    const nextProject = project();
    nextProject.revision = 8;
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <EditorView
          store={new EditorStore(nextProject)}
          repository={repository}
          onNew={vi.fn()}
          onOpenFile={vi.fn(async () => undefined)}
          onOpenFragmentFile={vi.fn(async () => undefined)}
        />
      </I18nextProvider>,
    );
    expect(screen.getByTestId("save-status").textContent).toBe("已保存");
    act(() => vi.advanceTimersByTime(500));
    expect(save).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it.each(["resolve", "reject"] as const)(
    "旧工程自动保存晚 %s 不污染新 store",
    async (settle) => {
      vi.useFakeTimers();
      rendererMocks.initialize.mockResolvedValue();
      const deferred = deferredSave();
      const repository = { save: vi.fn(() => deferred.promise) };
      const firstStore = new EditorStore(project());
      const view = render(
        <I18nextProvider i18n={i18n}>
          <EditorView
            store={firstStore}
            repository={repository}
            onNew={vi.fn()}
            onOpenFile={vi.fn(async () => undefined)}
            onOpenFragmentFile={vi.fn(async () => undefined)}
          />
        </I18nextProvider>,
      );
      act(() => firstStore.paintCell(0, 0, "#FFFFFFFF"));
      act(() => vi.advanceTimersByTime(350));
      expect(repository.save).toHaveBeenCalledOnce();

      const nextProject = project();
      nextProject.revision = 4;
      view.rerender(
        <I18nextProvider i18n={i18n}>
          <EditorView
            store={new EditorStore(nextProject)}
            repository={repository}
            onNew={vi.fn()}
            onOpenFile={vi.fn(async () => undefined)}
            onOpenFragmentFile={vi.fn(async () => undefined)}
          />
        </I18nextProvider>,
      );
      expect(screen.getByTestId("save-status").textContent).toBe("已保存");
      await act(async () => {
        if (settle === "resolve") deferred.resolve();
        else deferred.reject(new DOMException("quota", "QuotaExceededError"));
        await Promise.resolve();
      });
      expect(screen.getByTestId("save-status").textContent).toBe("已保存");
      expect(screen.queryByTestId("save-recovery")).toBeNull();
      vi.useRealTimers();
    },
  );

  it("旧工程手动保存晚失败不污染新 store", async () => {
    rendererMocks.initialize.mockResolvedValue();
    const deferred = deferredSave();
    const repository = { save: vi.fn(() => deferred.promise) };
    const firstStore = new EditorStore(project());
    const view = render(
      <I18nextProvider i18n={i18n}>
        <EditorView
          store={firstStore}
          repository={repository}
          onNew={vi.fn()}
          onOpenFile={vi.fn(async () => undefined)}
          onOpenFragmentFile={vi.fn(async () => undefined)}
        />
      </I18nextProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(repository.save).toHaveBeenCalledOnce();

    const nextProject = project();
    nextProject.revision = 3;
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <EditorView
          store={new EditorStore(nextProject)}
          repository={repository}
          onNew={vi.fn()}
          onOpenFile={vi.fn(async () => undefined)}
          onOpenFragmentFile={vi.fn(async () => undefined)}
        />
      </I18nextProvider>,
    );
    await act(async () => {
      deferred.reject(new DOMException("quota", "QuotaExceededError"));
      await Promise.resolve();
    });
    expect(screen.getByTestId("save-status").textContent).toBe("已保存");
    expect(screen.queryByTestId("save-recovery")).toBeNull();
  });

  it("连接拒绝使用非阻塞状态提示，合法操作会清除旧提示", () => {
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
    act(() =>
      rendererMocks.interaction?.operationRejected("connection-commit-failed"),
    );
    expect(
      screen.getByTestId("connection-notice").getAttribute("aria-live"),
    ).toBe("polite");
    act(() =>
      rendererMocks.interaction?.pointerDown({ x: 1, y: 1 }, "cell:square:0:0"),
    );
    expect(screen.queryByTestId("connection-notice")).toBeNull();
  });

  it("重复的同类连接错误会重新计算自动消退时间", () => {
    vi.useFakeTimers();
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
    act(() =>
      rendererMocks.interaction?.operationRejected("connection-commit-failed"),
    );
    const firstNotice = screen.getByTestId("connection-notice");
    act(() => vi.advanceTimersByTime(3_000));
    act(() =>
      rendererMocks.interaction?.operationRejected("connection-commit-failed"),
    );
    expect(screen.getByTestId("connection-notice")).not.toBe(firstNotice);
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByTestId("connection-notice")).toBeDefined();
    act(() => vi.advanceTimersByTime(2_901));
    expect(screen.queryByTestId("connection-notice")).toBeNull();
    vi.useRealTimers();
  });
});

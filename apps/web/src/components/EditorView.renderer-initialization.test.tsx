import { act, fireEvent, render, screen, within } from "@testing-library/react";
import {
  createProject,
  edgeIdentity,
  EditorStore,
  type GridType,
  type SelectedObject,
} from "@tessera/core";
import type { RendererInteraction } from "@tessera/renderer";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n.js";
import { EditorView } from "./EditorView.js";

const rendererMocks = vi.hoisted(() => ({
  destroy: vi.fn(),
  initialize: vi.fn<() => Promise<void>>(),
  render: vi.fn(),
  transientHighlight: vi.fn(),
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

      setTransientHighlight(selected: SelectedObject | null): void {
        rendererMocks.transientHighlight(selected);
      }

      destroy(): void {
        rendererMocks.destroy();
      }
    },
  };
});

function project(type: GridType = "square") {
  return createProject({
    name: "渲染初始化测试",
    grid: { type, width: 4, height: 4, cellSize: 24 },
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
    rendererMocks.transientHighlight.mockReset();
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

  it("把橡皮擦候选栈交给 Store 删除最顶层可编辑对象", () => {
    rendererMocks.initialize.mockResolvedValue();
    const store = new EditorStore(project());
    const overlayId = store.placeMarker({ x: 36, y: 36 });
    const eraseFirstEditable = vi.spyOn(store, "eraseFirstEditable");
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
    const candidates: SelectedObject[] = [{ kind: "overlay", id: overlayId }];

    let erased: SelectedObject | null | undefined;
    act(() => {
      erased = rendererMocks.interaction?.eraseCandidates?.(candidates);
    });

    expect(eraseFirstEditable).toHaveBeenCalledWith(candidates);
    expect(erased).toEqual(candidates[0]);
    expect(store.state.overlays.get(overlayId)).toBeUndefined();
  });

  it("多选下钻删除被引用的显式边后，降级 carrier 并返回剩余摘要", () => {
    rendererMocks.initialize.mockResolvedValue();
    const store = new EditorStore(project());
    const identity = edgeIdentity(store.state.grid, { row: 1, column: 1 }, 1);
    store.paintEdge(identity.edgeId, identity.adjacentCellIds, "#FFFFFFFF");
    const explicitEdge = store.state.edges.get(identity.edgeId);
    if (explicitEdge === undefined) throw new Error("edge-missing");
    const markerId = store.placeEdgeMarker(explicitEdge);
    store.paintCell(2, 2, "#FFFFFFFF");
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
      rendererMocks.interaction?.select(
        [
          { kind: "edge", id: identity.edgeId },
          { kind: "overlay", id: markerId },
          { kind: "cell", id: "cell:square:2:2" },
        ],
        false,
      ),
    );

    const summary = screen.getByRole("list", { name: "所选对象摘要" });
    fireEvent.click(within(summary).getByRole("button", { name: /^共享边/u }));
    fireEvent.click(screen.getByRole("button", { name: "删除此对象" }));

    expect(store.state.edges.get(identity.edgeId)?.persistence).toBe(
      "reference-only",
    );
    expect(store.state.overlays.get(markerId)).toBeDefined();
    expect(store.selection).toEqual([
      { kind: "overlay", id: markerId },
      { kind: "cell", id: "cell:square:2:2" },
    ]);
    const remaining = screen.getByRole("list", { name: "所选对象摘要" });
    expect(
      within(remaining).queryByRole("button", { name: /^共享边/u }),
    ).toBeNull();
    expect(within(remaining).getAllByRole("button")).toHaveLength(2);
  });

  it.each(["square", "hex-pointy"] as const)(
    "%s 地图设置可扩大、合法缩小、更新格子尺寸并随撤销重做回填",
    (gridType) => {
      rendererMocks.initialize.mockResolvedValue();
      const store = new EditorStore(project(gridType));
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

      fireEvent.click(screen.getByRole("button", { name: "地图设置" }));
      const width = screen.getByLabelText("宽度");
      const height = screen.getByLabelText("高度");
      const cellSize = screen.getByLabelText("单元格尺寸");
      const apply = screen.getByRole("button", { name: "应用地图设置" });
      const initialRevision = store.state.revision;

      fireEvent.change(width, { target: { value: "6" } });
      fireEvent.change(height, { target: { value: "5" } });
      fireEvent.change(cellSize, { target: { value: "40" } });
      fireEvent.click(apply);
      expect(store.state.grid).toEqual({
        type: gridType,
        width: 6,
        height: 5,
        cellSize: 40,
      });
      expect(store.state.revision).toBe(initialRevision + 1);

      fireEvent.click(screen.getByRole("button", { name: "撤销" }));
      expect((width as HTMLInputElement).value).toBe("4");
      expect((height as HTMLInputElement).value).toBe("4");
      expect((cellSize as HTMLInputElement).value).toBe("24");
      fireEvent.click(screen.getByRole("button", { name: "重做" }));
      expect((width as HTMLInputElement).value).toBe("6");
      expect((height as HTMLInputElement).value).toBe("5");
      expect((cellSize as HTMLInputElement).value).toBe("40");

      fireEvent.change(width, { target: { value: "5" } });
      fireEvent.change(height, { target: { value: "4" } });
      fireEvent.click(apply);
      expect(store.state.grid).toMatchObject({ width: 5, height: 4 });

      store.placeMarker({
        kind: "cell",
        cellId: `cell:${gridType}:3:3`,
      });
      const revisionBeforeRejection = store.state.revision;
      const overlayCountBeforeRejection = store.state.overlays.size;
      fireEvent.change(width, { target: { value: "3" } });
      fireEvent.change(height, { target: { value: "3" } });
      fireEvent.click(apply);

      expect(screen.getByRole("alert").textContent).toContain(
        "地图中存在超出新边界的内容；尺寸未修改。",
      );
      expect(store.state.grid).toMatchObject({ width: 5, height: 4 });
      expect(store.state.revision).toBe(revisionBeforeRejection);
      expect(store.state.overlays.size).toBe(overlayCountBeforeRejection);

      fireEvent.change(width, { target: { value: "5" } });
      fireEvent.change(height, { target: { value: "4" } });
      fireEvent.click(apply);
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

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

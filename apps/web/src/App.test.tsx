import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { StrictMode } from "react";
import { createProject, EditorStore, type ProjectState } from "@tessera/core";
import {
  createFragmentFromStateV1,
  restoreProjectV1,
  stringifyFragmentV1,
  stringifyProjectDocumentV1,
  stringifyProjectV1,
  toProjectV1,
} from "@tessera/formats";
import { describe, expect, it, vi } from "vitest";
import i18n from "./i18n.js";
import { App } from "./App.js";

const resourceRuntimeInstances = vi.hoisted(
  () =>
    [] as {
      readonly packages: readonly unknown[];
      readonly dispose: ReturnType<typeof vi.fn>;
    }[],
);

vi.mock("./project-module-resource-runtime.js", () => ({
  ProjectModuleResourceRuntime: class {
    readonly dispose = vi.fn();

    constructor(readonly packages: readonly unknown[]) {
      resourceRuntimeInstances.push(this);
    }
  },
}));

vi.mock("./components/EditorView.js", () => ({
  EditorView: ({
    store,
    repository,
    externalErrorKey,
    onOpenFile,
    onOpenFragmentFile,
    onOpenPackageSettings,
    onNew,
  }: {
    store: EditorStore;
    repository: { save(state: Readonly<ProjectState>): Promise<unknown> };
    externalErrorKey?: string | null;
    onOpenFile(file: File): Promise<void>;
    onOpenFragmentFile(file: File): Promise<void>;
    onOpenPackageSettings?(): void;
    onNew(): void;
  }) => (
    <div>
      <span data-testid="editor-project">{store.state.name}</span>
      <span data-testid="editor-cells">
        {[...store.state.cells.values()].length}
      </span>
      <button
        type="button"
        onClick={() => {
          store.paintCell(0, 0, "#336699FF");
        }}
      >
        测试编辑工程
      </button>
      <button
        type="button"
        onClick={() => {
          void repository.save(store.state);
        }}
      >
        测试保存当前工程
      </button>
      <button type="button" onClick={onOpenPackageSettings}>
        测试打开包设置
      </button>
      <button type="button" onClick={onNew}>
        测试新建工程
      </button>
      <input
        aria-label="编辑器打开工程"
        type="file"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file !== undefined) void onOpenFile(file);
        }}
      />
      <input
        aria-label="编辑器导入片段"
        type="file"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file !== undefined) void onOpenFragmentFile(file);
        }}
      />
      {externalErrorKey ? (
        <span data-testid="editor-error">{externalErrorKey}</span>
      ) : null}
    </div>
  ),
}));

function project(name: string) {
  return createProject({
    name,
    grid: { type: "square", width: 2, height: 2, cellSize: 24 },
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

function missingModuleProject(name: string, moduleId: string): ProjectState {
  const document = toProjectV1(project(name));
  document.modules.push({
    moduleId,
    version: "1.0.0",
    packageSourceKind: "user-file",
    extensions: {},
  });
  document.modules.sort((left, right) =>
    left.moduleId.localeCompare(right.moduleId),
  );
  document.layerStates.push({
    layerId: moduleId + ".surface",
    moduleVersion: "1.0.0",
    zIndex: 2500,
    visible: true,
    locked: false,
    opacity: 1,
    extensions: {},
  });
  document.layerStates.sort(
    (left, right) =>
      left.zIndex - right.zIndex || left.layerId.localeCompare(right.layerId),
  );
  return restoreProjectV1(stringifyProjectDocumentV1(document), {
    moduleResolutionMode: "tolerant",
  });
}

describe("App recovery", () => {
  it("恢复失败不静默吞掉，并保留新建与载入入口", async () => {
    const repository = {
      loadLatest: vi.fn(async () => {
        throw new Error("indexeddb-corrupt");
      }),
      save: vi.fn(async () => undefined),
    };
    render(
      <I18nextProvider i18n={i18n}>
        <App repository={repository} />
      </I18nextProvider>,
    );
    expect(screen.getByRole("status").textContent).toContain("正在恢复");
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "本地工程恢复失败",
      ),
    );
    expect(screen.getByRole("button", { name: "创建工程" })).toBeDefined();
    expect(screen.getByText("打开")).toBeDefined();
  });

  it("本地没有工程是正常空状态，不显示恢复错误", async () => {
    const repository = {
      loadLatest: vi.fn(async () => null),
      save: vi.fn(async () => undefined),
    };
    render(
      <I18nextProvider i18n={i18n}>
        <App repository={repository} />
      </I18nextProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "创建工程" })).toBeDefined(),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("只关闭自身创建的 repository，不关闭调用方注入实例", async () => {
    const ownedClose = vi.fn();
    const owned = {
      loadLatest: vi.fn(async () => null),
      save: vi.fn(async () => undefined),
      close: ownedClose,
    };
    const ownedView = render(
      <I18nextProvider i18n={i18n}>
        <App repositoryFactory={() => owned} />
      </I18nextProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "创建工程" })).toBeDefined(),
    );
    ownedView.unmount();
    await waitFor(() => expect(ownedClose).toHaveBeenCalledTimes(1));

    const suppliedClose = vi.fn();
    const supplied = {
      loadLatest: vi.fn(async () => null),
      save: vi.fn(async () => undefined),
      close: suppliedClose,
    };
    const suppliedView = render(
      <I18nextProvider i18n={i18n}>
        <App repository={supplied} />
      </I18nextProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "创建工程" })).toBeDefined(),
    );
    suppliedView.unmount();
    await Promise.resolve();
    expect(suppliedClose).not.toHaveBeenCalled();
  });

  it("卸载时关闭 owned repository，迟到的恢复失败不再更新界面", async () => {
    let rejectRecovery!: (error: unknown) => void;
    const recovery = new Promise<ProjectState | null>((_resolve, reject) => {
      rejectRecovery = reject;
    });
    const close = vi.fn();
    const save = vi.fn(async () => undefined);
    const view = render(
      <I18nextProvider i18n={i18n}>
        <App
          repositoryFactory={() => ({
            loadLatest: () => recovery,
            save,
            close,
          })}
        />
      </I18nextProvider>,
    );
    expect(screen.getByRole("status")).toBeDefined();
    view.unmount();
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    rejectRecovery(new Error("late-recovery-failure"));
    await recovery.catch(() => undefined);
    expect(save).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("StrictMode 模拟 cleanup 不关闭复用实例，真实卸载才关闭", async () => {
    const resourceStart = resourceRuntimeInstances.length;
    const close = vi.fn();
    const owned = {
      loadLatest: vi.fn(async () => null),
      save: vi.fn(async () => undefined),
      close,
    };
    const view = render(
      <StrictMode>
        <I18nextProvider i18n={i18n}>
          <App repositoryFactory={() => owned} />
        </I18nextProvider>
      </StrictMode>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "创建工程" })).toBeDefined(),
    );
    await Promise.resolve();
    expect(close).not.toHaveBeenCalled();
    const resourceRuntimes = resourceRuntimeInstances.slice(resourceStart);
    expect(resourceRuntimes.length).toBeGreaterThan(0);
    expect(
      resourceRuntimes.reduce(
        (count, runtime) => count + runtime.dispose.mock.calls.length,
        0,
      ),
    ).toBe(0);
    view.unmount();
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        resourceRuntimes.reduce(
          (count, runtime) => count + runtime.dispose.mock.calls.length,
          0,
        ),
      ).toBe(1),
    );
    expect(
      resourceRuntimes.every(
        (runtime) => runtime.dispose.mock.calls.length <= 1,
      ),
    ).toBe(true);
  });

  it("初次保存失败被捕获并呈现，不产生未处理 Promise", async () => {
    const repository = {
      loadLatest: vi.fn(async () => null),
      save: vi.fn(async () => {
        throw new Error("initial-save-failed");
      }),
    };
    render(
      <I18nextProvider i18n={i18n}>
        <App repository={repository} />
      </I18nextProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "创建工程" })).toBeDefined(),
    );
    fireEvent.change(screen.getByLabelText("工程名称"), {
      target: { value: "初次保存失败" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建工程" }));
    await waitFor(
      () =>
        expect(screen.getByTestId("editor-error").textContent).toBe(
          "error.projectFileSaveFailed",
        ),
      { timeout: 5_000 },
    );
  });

  it("并发选择按选择顺序串行保存，最晚文件最终保持为 latest", async () => {
    let releaseFirstSave!: () => void;
    const firstSaveGate = new Promise<void>((resolve) => {
      releaseFirstSave = resolve;
    });
    let latest: Readonly<ProjectState> | null = null;
    const save = vi.fn(async (state: Readonly<ProjectState>) => {
      if (save.mock.calls.length === 1) await firstSaveGate;
      latest = state;
    });
    const repository = {
      loadLatest: vi.fn(async () => latest),
      save,
    };
    render(
      <I18nextProvider i18n={i18n}>
        <App repository={repository} />
      </I18nextProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "创建工程" })).toBeDefined(),
    );
    const input = screen.getByLabelText("打开");
    fireEvent.change(input, {
      target: {
        files: [
          new File(
            [stringifyProjectV1(project("先选择但后完成"))],
            "first.tessera-project.json",
          ),
        ],
      },
    });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    fireEvent.change(input, {
      target: {
        files: [
          new File(
            [stringifyProjectV1(project("最后选择"))],
            "second.tessera-project.json",
          ),
        ],
      },
    });
    expect(save).toHaveBeenCalledTimes(1);

    releaseFirstSave();
    await waitFor(() =>
      expect(screen.getByTestId("editor-project").textContent).toBe("最后选择"),
    );
    expect(save).toHaveBeenCalledTimes(2);
    expect((await repository.loadLatest())?.name).toBe("最后选择");
  });

  it("同 ID 完整工程默认可作为副本打开", async () => {
    const current = project("同一工程");
    const save = vi.fn<(state: Readonly<ProjectState>) => Promise<void>>(
      async () => undefined,
    );
    render(
      <I18nextProvider i18n={i18n}>
        <App repository={{ loadLatest: async () => current, save }} />
      </I18nextProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("editor-project")).toBeDefined(),
    );
    fireEvent.change(screen.getByLabelText("编辑器打开工程"), {
      target: {
        files: [
          new File(
            [stringifyProjectV1(current, { mode: "full" })],
            "same.tessera-project.json",
          ),
        ],
      },
    });
    const copy = await screen.findByRole("button", { name: "作为副本打开" });
    fireEvent.click(copy);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect((save.mock.calls[0]?.[0] as ProjectState).projectId).toBe(
      current.projectId,
    );
    expect((save.mock.calls[1]?.[0] as ProjectState).projectId).not.toBe(
      current.projectId,
    );
  });

  it("替换同 ID 工程必须经过二次明确确认，取消不保存", async () => {
    const current = project("同一工程");
    const save = vi.fn<(state: Readonly<ProjectState>) => Promise<void>>(
      async () => undefined,
    );
    const view = render(
      <I18nextProvider i18n={i18n}>
        <App repository={{ loadLatest: async () => current, save }} />
      </I18nextProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("editor-project")).toBeDefined(),
    );
    const open = () =>
      fireEvent.change(screen.getByLabelText("编辑器打开工程"), {
        target: {
          files: [
            new File(
              [stringifyProjectV1(current, { mode: "full" })],
              "same.tessera-project.json",
            ),
          ],
        },
      });
    open();
    fireEvent.click(
      await screen.findByRole("button", { name: "替换本地工程" }),
    );
    expect(
      screen.getByRole("button", { name: "确认替换本地工程" }),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(save).not.toHaveBeenCalled();

    open();
    fireEvent.click(
      await screen.findByRole("button", { name: "替换本地工程" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "确认替换本地工程" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect((save.mock.calls[0]?.[0] as ProjectState).projectId).toBe(
      current.projectId,
    );
    expect((save.mock.calls[1]?.[0] as ProjectState).projectId).toBe(
      current.projectId,
    );
    view.unmount();
  });

  it("同 ID 决策等待期间卸载会清理 Promise 且不会保存", async () => {
    const current = project("卸载清理");
    const save = vi.fn<(state: Readonly<ProjectState>) => Promise<void>>(
      async () => undefined,
    );
    const view = render(
      <I18nextProvider i18n={i18n}>
        <App repository={{ loadLatest: async () => current, save }} />
      </I18nextProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("editor-project")).toBeDefined(),
    );
    fireEvent.change(screen.getByLabelText("编辑器打开工程"), {
      target: {
        files: [
          new File(
            [stringifyProjectV1(current, { mode: "full" })],
            "same.tessera-project.json",
          ),
        ],
      },
    });
    await screen.findByRole("dialog", { name: "本地已有同一工程" });
    view.unmount();
    await Promise.resolve();
    expect(save).not.toHaveBeenCalled();
  });

  it("Fragment 取消不改工程，确认后保存成功才替换编辑态", async () => {
    const current = project("片段目标");
    const source = new EditorStore(project("片段来源"));
    source.paintCell(0, 0, "#AA0000FF");
    const fragment = stringifyFragmentV1(
      createFragmentFromStateV1(source.state, {
        fragmentId: crypto.randomUUID(),
        bounds: { minX: 0, minY: 0, maxX: 24, maxY: 24 },
        includedLayerIds: ["tessera.basic.cell-style"],
      }),
    );
    const save = vi.fn(async () => undefined);
    render(
      <I18nextProvider i18n={i18n}>
        <App repository={{ loadLatest: async () => current, save }} />
      </I18nextProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("editor-cells").textContent).toBe("0"),
    );
    const choose = () =>
      fireEvent.change(screen.getByLabelText("编辑器导入片段"), {
        target: { files: [new File([fragment], "part.tessera-fragment.json")] },
      });
    choose();
    fireEvent.click(await screen.findByRole("button", { name: "取消" }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByTestId("editor-cells").textContent).toBe("0");

    choose();
    fireEvent.click(
      await screen.findByRole("button", { name: "确认合并并保存" }),
    );
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId("editor-cells").textContent).toBe("1"),
    );
  });

  it("Fragment 保存失败保持原工程并显示错误", async () => {
    const current = project("片段目标");
    const source = new EditorStore(project("片段来源"));
    source.paintCell(0, 0, "#AA0000FF");
    const fragment = stringifyFragmentV1(
      createFragmentFromStateV1(source.state, {
        fragmentId: crypto.randomUUID(),
        bounds: { minX: 0, minY: 0, maxX: 24, maxY: 24 },
        includedLayerIds: ["tessera.basic.cell-style"],
      }),
    );
    render(
      <I18nextProvider i18n={i18n}>
        <App
          repository={{
            loadLatest: async () => current,
            save: async () => {
              throw new Error("quota");
            },
          }}
        />
      </I18nextProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("editor-cells").textContent).toBe("0"),
    );
    fireEvent.change(screen.getByLabelText("编辑器导入片段"), {
      target: { files: [new File([fragment], "part.tessera-fragment.json")] },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "确认合并并保存" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("本地保存失败"),
    );
    expect(screen.getByTestId("editor-cells").textContent).toBe("0");
  });

  it("迟到的 Fragment 平移结果在取消后被丢弃，加载失败会受控呈现", async () => {
    const target = project("并发目标");
    const source = new EditorStore(
      createProject({
        name: "越界来源",
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
    source.paintCell(3, 3, "#AA0000FF");
    const fragment = stringifyFragmentV1(
      createFragmentFromStateV1(source.state, {
        fragmentId: crypto.randomUUID(),
        bounds: { minX: 72, minY: 72, maxX: 96, maxY: 96 },
        includedLayerIds: ["tessera.basic.cell-style"],
      }),
    );
    const workflow = await import("./fragment-file-workflow.js");
    let releaseTranslation!: (module: typeof workflow) => void;
    const delayedTranslation = new Promise<typeof workflow>((resolve) => {
      releaseTranslation = resolve;
    });
    let loadCount = 0;
    const delayedLoader = () => {
      loadCount += 1;
      return loadCount === 2 ? delayedTranslation : Promise.resolve(workflow);
    };
    const save = vi.fn(async () => undefined);
    const view = render(
      <I18nextProvider i18n={i18n}>
        <App
          repository={{ loadLatest: async () => target, save }}
          fragmentWorkflowLoader={delayedLoader}
        />
      </I18nextProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("editor-project")).toBeDefined(),
    );
    fireEvent.change(screen.getByLabelText("编辑器导入片段"), {
      target: {
        files: [new File([fragment], "late.tessera-fragment.json")],
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: "检查平移" }));
    expect(loadCount).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    releaseTranslation(workflow);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByTestId("editor-cells").textContent).toBe("0");
    view.unmount();

    loadCount = 0;
    const rejectingLoader = () => {
      loadCount += 1;
      return loadCount === 2
        ? Promise.reject(new Error("chunk-load-failed"))
        : Promise.resolve(workflow);
    };
    render(
      <I18nextProvider i18n={i18n}>
        <App
          repository={{ loadLatest: async () => target, save }}
          fragmentWorkflowLoader={rejectingLoader}
        />
      </I18nextProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("editor-project")).toBeDefined(),
    );
    fireEvent.change(screen.getByLabelText("编辑器导入片段"), {
      target: {
        files: [new File([fragment], "failed.tessera-fragment.json")],
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: "检查平移" }));
    await screen.findByText("片段无法合并，当前工程未改变。");
    expect(screen.getByRole("dialog")).toBeDefined();
    expect(save).not.toHaveBeenCalled();
  });

  it("先恢复本地包并设置 resolver provider，再恢复最近工程", async () => {
    let provider:
      | (() => {
          readonly moduleResolver?: unknown;
          readonly currentAppVersion?: string;
        })
      | undefined;
    const events: string[] = [];
    const repository = {
      setModuleResolutionProvider(next: typeof provider) {
        provider = next;
        events.push("provider");
      },
      async loadLatest() {
        events.push("project");
        expect(provider?.().currentAppVersion).toBe("0.1.0");
        return null;
      },
      async save() {
        return undefined;
      },
    };
    const packageRepository = {
      async recover() {
        events.push("packages");
        return {
          completedCommitIds: [],
          rolledBackCommitIds: [],
          deletedOrphanCommitIds: [],
          issues: [],
        };
      },
      async listRegistrations() {
        return [];
      },
    };
    render(
      <I18nextProvider i18n={i18n}>
        <App
          repository={repository}
          packageRepository={packageRepository as never}
        />
      </I18nextProvider>,
    );
    await screen.findByRole("heading", { name: "新建地图" });
    expect(events).toEqual(["provider", "packages", "project"]);
    expect(provider?.().moduleResolver).toBeDefined();
  });

  it("App 将当前包 resolver 放入 Project 导入 options", async () => {
    const current = project("导入目标");
    const importProjectFile = vi.fn(async (options: unknown) => {
      void options;
      return {
        status: "loaded" as const,
        store: new EditorStore(current),
        identity: "preserved" as const,
      };
    });
    const packageRepository = {
      async recover() {
        return {
          completedCommitIds: [],
          rolledBackCommitIds: [],
          deletedOrphanCommitIds: [],
          issues: [],
        };
      },
      async listRegistrations() {
        return [];
      },
    };
    render(
      <I18nextProvider i18n={i18n}>
        <App
          repository={{
            loadLatest: async () => current,
            save: vi.fn(async () => undefined),
          }}
          packageRepository={packageRepository as never}
          projectWorkflowLoader={async () => ({
            importProjectFile: importProjectFile as never,
            projectFileErrorTranslationKey: () => "error.invalidProject",
          })}
        />
      </I18nextProvider>,
    );
    await screen.findByTestId("editor-project");
    fireEvent.change(screen.getByLabelText("编辑器打开工程"), {
      target: { files: [new File(["{}"], "external.tessera-project.json")] },
    });
    await waitFor(() => expect(importProjectFile).toHaveBeenCalledTimes(1));
    expect(
      (importProjectFile.mock.calls[0]?.[0] as { moduleResolver?: unknown })
        .moduleResolver,
    ).toBeDefined();
  });

  it("新建表单双提交只启动一次保存", async () => {
    let release!: () => void;
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    render(
      <I18nextProvider i18n={i18n}>
        <App repository={{ loadLatest: async () => null, save }} />
      </I18nextProvider>,
    );
    const name = await screen.findByLabelText("工程名称");
    fireEvent.change(name, { target: { value: "单飞工程" } });
    const form = name.closest("form");
    if (form === null) throw new Error("缺少新建表单");
    act(() => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    release();
    await waitFor(() =>
      expect(screen.getByTestId("editor-project")).toBeDefined(),
    );
  });

  it("新建校验模块加载失败时复位 guard 并允许再次创建", async () => {
    const save = vi.fn(async () => undefined);
    const validate = vi.fn();
    const createValidationLoader = vi
      .fn()
      .mockRejectedValueOnce(new Error("chunk-load-failed"))
      .mockResolvedValueOnce({
        validateActiveProjectModuleInstances: validate,
      });
    render(
      <I18nextProvider i18n={i18n}>
        <App
          repository={{ loadLatest: async () => null, save }}
          createValidationLoader={createValidationLoader}
        />
      </I18nextProvider>,
    );
    const name = await screen.findByLabelText("工程名称");
    fireEvent.change(name, { target: { value: "加载恢复" } });
    fireEvent.click(screen.getByRole("button", { name: "创建工程" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "工程创建校验失败",
      ),
    );
    expect(save).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: "创建工程" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "创建工程" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(validate).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("editor-project").textContent).toBe("加载恢复");
  });

  it("新建候选验证失败时不保存、不切换且保留已打开工程", async () => {
    const current = project("已打开工程");
    const save = vi.fn(async () => undefined);
    const validate = vi.fn(() => {
      throw new Error("candidate-invalid");
    });
    render(
      <I18nextProvider i18n={i18n}>
        <App
          repository={{ loadLatest: async () => current, save }}
          createValidationLoader={async () => ({
            validateActiveProjectModuleInstances: validate,
          })}
        />
      </I18nextProvider>,
    );
    await screen.findByTestId("editor-project");
    fireEvent.click(screen.getByRole("button", { name: "测试新建工程" }));
    const name = await screen.findByLabelText("工程名称");
    fireEvent.change(name, { target: { value: "无效候选" } });
    fireEvent.click(screen.getByRole("button", { name: "创建工程" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "工程创建校验失败",
      ),
    );
    expect(validate).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: "创建工程" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByTestId("editor-project").textContent).toBe("已打开工程");
  });

  it("提取器目录只在打开包设置后加载，失败不影响基础新建流程", async () => {
    const extractorCatalogLoader = vi.fn(async () => {
      throw new Error("catalog-offline");
    });
    const packageRepository = {
      async recover() {
        return {
          completedCommitIds: [],
          rolledBackCommitIds: [],
          deletedOrphanCommitIds: [],
          issues: [],
        };
      },
      async listRegistrations() {
        return [];
      },
    };
    render(
      <I18nextProvider i18n={i18n}>
        <App
          repository={{
            loadLatest: async () => null,
            save: vi.fn(async () => undefined),
          }}
          packageRepository={packageRepository as never}
          extractorCatalogLoader={extractorCatalogLoader}
        />
      </I18nextProvider>,
    );
    await screen.findByRole("heading", { name: "新建地图" });
    expect(extractorCatalogLoader).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "管理模块与预设包" }));
    await waitFor(() =>
      expect(extractorCatalogLoader).toHaveBeenCalledTimes(1),
    );
    expect(
      await screen.findByText(/基础网站和本地包导入仍可正常使用/),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.getByRole("button", { name: "创建工程" })).toBeDefined();
  });

  it("动态目录匹配后才在文明6卡片显示外部下载链接", async () => {
    const assetUrl =
      "https://github.com/Yue0404/Tessera_Studio/releases/download/extractor-v0.1.0-preview.1/tessera-civ6-extractor-v0.1.0-preview.1-windows-x64.zip";
    const packageRepository = {
      async recover() {
        return {
          completedCommitIds: [],
          rolledBackCommitIds: [],
          deletedOrphanCommitIds: [],
          issues: [],
        };
      },
      async listRegistrations() {
        return [];
      },
    };
    render(
      <I18nextProvider i18n={i18n}>
        <App
          repository={{
            loadLatest: async () => null,
            save: vi.fn(async () => undefined),
          }}
          packageRepository={packageRepository as never}
          extractorCatalogLoader={async () => ({
            extractorId: "tessera.civ6-extractor",
            version: "0.1.0-preview.1",
            os: "windows",
            arch: "x64",
            minOsBuild: 26100,
            artifactType: "portable-zip",
            entrypoint: "TesseraCiv6Extractor.exe",
            bytes: 51_549_893,
            sha256: "1".repeat(64),
            outputModuleId: "tessera.civ6",
            outputModuleVersion: "1.0.0",
            minAppVersion: "0.1.0",
            assetUrl,
          })}
        />
      </I18nextProvider>,
    );
    await screen.findByRole("heading", { name: "新建地图" });
    fireEvent.click(screen.getByRole("button", { name: "管理模块与预设包" }));
    const link = await screen.findByRole("link", {
      name: "下载匹配版本提取器",
    });
    expect(link.getAttribute("href")).toBe(assetUrl);
  });

  it("旧自动保存与缺包停用串行，重载后模块消失且即时编辑不丢", async () => {
    const moduleId = "example.missing-race";
    let latest = missingModuleProject("保存竞态", moduleId);
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    let saveCount = 0;
    const save = vi.fn(async (state: Readonly<ProjectState>) => {
      const snapshot = stringifyProjectV1(state, { mode: "preserve" });
      saveCount += 1;
      if (saveCount === 1) {
        markFirstStarted();
        await firstGate;
      }
      latest = restoreProjectV1(snapshot, {
        moduleResolutionMode: "tolerant",
      });
    });
    const repository = {
      loadLatest: async () => latest,
      save,
    };
    const packageRepository = {
      async recover() {
        return {
          completedCommitIds: [],
          rolledBackCommitIds: [],
          deletedOrphanCommitIds: [],
          issues: [],
        };
      },
      async listRegistrations() {
        return [];
      },
    };
    const renderApp = () =>
      render(
        <I18nextProvider i18n={i18n}>
          <App
            repository={repository}
            packageRepository={packageRepository as never}
            extractorCatalogLoader={async () => null}
          />
        </I18nextProvider>,
      );
    const view = renderApp();
    await screen.findByTestId("editor-project");
    fireEvent.click(screen.getByRole("button", { name: "测试编辑工程" }));
    fireEvent.click(screen.getByRole("button", { name: "测试打开包设置" }));
    const missingStatus = await screen.findByText("本地包缺失");
    const article = missingStatus.closest("article");
    if (article === null) throw new Error("缺少缺包占位卡片");
    const disable = within(article).getByRole("button", {
      name: "在当前工程停用",
    });
    await waitFor(() => expect(disable.hasAttribute("disabled")).toBe(false));
    fireEvent.click(disable);
    await firstStarted;
    fireEvent.click(screen.getByRole("button", { name: "测试保存当前工程" }));
    expect(save).toHaveBeenCalledTimes(1);

    releaseFirst();
    await waitFor(() => expect(screen.queryByText("本地包缺失")).toBeNull());
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("editor-cells").textContent).toBe("1");
    expect(
      toProjectV1(latest).modules.some(
        (module) => module.moduleId === moduleId,
      ),
    ).toBe(false);
    expect(latest.cells.get("cell:square:0:0")?.fillColor).toBe("#336699FF");

    view.unmount();
    renderApp();
    await waitFor(() =>
      expect(screen.getByTestId("editor-cells").textContent).toBe("1"),
    );
    fireEvent.click(screen.getByRole("button", { name: "测试打开包设置" }));
    await screen.findByRole("dialog", { name: "包设置" });
    expect(screen.queryByText(moduleId, { exact: false })).toBeNull();
  });
});

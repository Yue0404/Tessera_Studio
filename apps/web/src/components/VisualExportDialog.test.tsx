import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createProject } from "@tessera/core";
import {
  captureVisualExportSnapshot,
  planVisualExport,
  VisualExportError,
  type VisualExportProgress,
  type VisualExportResult,
} from "@tessera/renderer/visual-export";
import { describe, expect, it, vi } from "vitest";
import i18n from "../i18n.js";
import {
  visualExportErrorPresentation,
  type VisualExportWorkflowRequest,
  type VisualExportWorkflowSession,
} from "../visual-export-workflow.js";
import { VisualExportDialog } from "./VisualExportDialog.js";

function project() {
  return createProject({
    name: "组件图片导出",
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

describe("VisualExportDialog", () => {
  it("显示真实进度、支持取消，并在卸载时取消活动任务", async () => {
    const state = project();
    const bounds = { minX: 0, minY: 0, maxX: 48, maxY: 48 };
    const capabilities = {
      maxWidth: 8192,
      maxHeight: 8192,
      maxPixels: 67_108_864,
      worker: false,
      offscreenCanvas2d: false,
      offscreenConvertToBlob: false,
    } as const;
    const plan = planVisualExport(
      captureVisualExportSnapshot(state),
      {
        format: "png",
        range: { kind: "viewport", bounds },
        background: { kind: "transparent" },
        showGrid: true,
        scale: 1,
      },
      capabilities,
    );
    const cancellations: ReturnType<typeof vi.fn>[] = [];
    const listeners: (((event: VisualExportProgress) => void) | null)[] = [];
    const startVisualExportWorkflow = vi.fn<
      (
        projectState: Readonly<typeof state>,
        request: VisualExportWorkflowRequest,
      ) => Promise<VisualExportWorkflowSession>
    >(async () => {
      let reject!: (error: unknown) => void;
      const result = new Promise<VisualExportResult>(
        (_resolve, rejectResult) => {
          reject = rejectResult;
        },
      );
      const cancel = vi.fn(() =>
        reject(new VisualExportError("visual-export-cancelled")),
      );
      cancellations.push(cancel);
      const index = listeners.length;
      listeners.push(null);
      const session: VisualExportWorkflowSession = {
        taskId: `task-${index}`,
        plan,
        capabilities,
        subscribeProgress: (listener) => {
          listeners[index] = listener;
          return () => {
            listeners[index] = null;
          };
        },
        cancel,
        result,
      };
      return session;
    });
    const onClose = vi.fn();
    const view = render(
      <I18nextProvider i18n={i18n}>
        <VisualExportDialog
          state={state}
          interaction={{ viewportBounds: bounds, selectionBounds: null }}
          initialCustomBounds={bounds}
          workflowLoader={async () => ({
            startVisualExportWorkflow,
            downloadVisualExportResult: vi.fn(),
            visualExportErrorPresentation,
          })}
          onClose={onClose}
        />
      </I18nextProvider>,
    );
    const start = await screen.findByRole("button", { name: "开始生成" });
    expect(
      screen.getByLabelText(i18n.t("visualExport.format.png")),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(i18n.t("visualExport.format.svg")),
    ).toBeTruthy();
    for (const value of [1, 2, 4]) {
      expect(
        screen.getByLabelText(i18n.t("visualExport.scale.option", { value })),
      ).toBeTruthy();
    }
    fireEvent.click(start);
    await waitFor(() => expect(listeners[0]).not.toBeNull());
    listeners[0]?.({ taskId: "task-0", progress: 0.5 });
    await waitFor(() =>
      expect(screen.getByRole("progressbar").getAttribute("value")).toBe("0.5"),
    );
    fireEvent.click(screen.getByRole("button", { name: "取消生成" }));
    await screen.findByText("已取消图片导出，没有生成文件。");
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
    await waitFor(() => expect(cancellations).toHaveLength(2));
    view.unmount();
    expect(cancellations[1]).toHaveBeenCalledTimes(1);
  });

  it("资源预取尚未建立导出任务时仍可取消", async () => {
    const state = project();
    const bounds = { minX: 0, minY: 0, maxX: 48, maxY: 48 };
    let capturedSignal: AbortSignal | undefined;
    const startVisualExportWorkflow = vi.fn(
      (
        _projectState: Readonly<typeof state>,
        request: VisualExportWorkflowRequest,
      ) => {
        capturedSignal = request.signal;
        return new Promise<VisualExportWorkflowSession>((_resolve, reject) => {
          request.signal?.addEventListener(
            "abort",
            () => reject(new VisualExportError("visual-export-cancelled")),
            { once: true },
          );
        });
      },
    );
    render(
      <I18nextProvider i18n={i18n}>
        <VisualExportDialog
          state={state}
          interaction={{ viewportBounds: bounds, selectionBounds: null }}
          initialCustomBounds={bounds}
          workflowLoader={async () => ({
            startVisualExportWorkflow,
            downloadVisualExportResult: vi.fn(),
            visualExportErrorPresentation,
          })}
          onClose={vi.fn()}
        />
      </I18nextProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "开始生成" }));
    await waitFor(() => expect(capturedSignal).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "取消生成" }));

    await screen.findByText("已取消图片导出，没有生成文件。");
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("非法 RGBA 的行动会恢复合法背景，PNG 环境错误会切换 SVG", async () => {
    const state = project();
    const bounds = { minX: 0, minY: 0, maxX: 48, maxY: 48 };
    const requests: VisualExportWorkflowRequest[] = [];
    let failure = new VisualExportError(
      "visual-export-background-color-invalid",
    );
    const startVisualExportWorkflow = vi.fn(
      (
        _projectState: Readonly<typeof state>,
        request: VisualExportWorkflowRequest,
      ) => {
        requests.push(request);
        throw failure;
      },
    );
    render(
      <I18nextProvider i18n={i18n}>
        <VisualExportDialog
          state={state}
          interaction={{ viewportBounds: bounds, selectionBounds: null }}
          initialCustomBounds={bounds}
          workflowLoader={async () => ({
            startVisualExportWorkflow,
            downloadVisualExportResult: vi.fn(),
            visualExportErrorPresentation,
          })}
          onClose={vi.fn()}
        />
      </I18nextProvider>,
    );
    const start = await screen.findByRole("button", { name: "开始生成" });
    fireEvent.click(screen.getByLabelText("指定 RGBA 背景"));
    fireEvent.change(screen.getByLabelText("RGBA 背景色"), {
      target: { value: "bad" },
    });
    fireEvent.click(start);
    await screen.findByText("RGBA 背景色无效，请使用 #RRGGBBAA 格式。");
    fireEvent.click(screen.getByRole("button", { name: "恢复透明背景" }));
    expect(
      (screen.getByLabelText("透明背景") as HTMLInputElement).checked,
    ).toBe(true);
    fireEvent.click(start);
    expect(requests.at(-1)?.background).toEqual({ kind: "transparent" });

    failure = new VisualExportError("visual-export-canvas-context-unavailable");
    await screen.findByText("RGBA 背景色无效，请使用 #RRGGBBAA 格式。");
    fireEvent.click(screen.getByRole("button", { name: "恢复透明背景" }));
    fireEvent.click(start);
    await screen.findByText("当前浏览器环境无法生成 PNG，请改用 SVG。");
    fireEvent.click(screen.getByRole("button", { name: "改用 SVG 格式" }));
    expect(
      (
        screen.getByLabelText(
          i18n.t("visualExport.format.svg"),
        ) as HTMLInputElement
      ).checked,
    ).toBe(true);
  });
});

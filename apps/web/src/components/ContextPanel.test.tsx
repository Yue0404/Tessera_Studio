import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import {
  createProject,
  EditorStore,
  type FixedLayerState,
} from "@tessera/core";
import { describe, expect, it, vi } from "vitest";
import i18n from "../i18n.js";
import { ContextPanel } from "./ContextPanel.js";

function project() {
  return createProject({
    name: "检查器",
    grid: { type: "square", width: 10, height: 10, cellSize: 32 },
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

const connectionActions = {
  connectionRebind: null,
  onReverseConnection: vi.fn(),
  onBeginConnectionRebind: vi.fn(),
  onCancelConnectionRebind: vi.fn(),
};

describe("ContextPanel", () => {
  it("固定图层按高度排序并提供显隐、锁定和透明度控制", async () => {
    const user = userEvent.setup();
    const onLayerState = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <ContextPanel
          {...connectionActions}
          panel="layers"
          state={project()}
          selection={[]}
          onSelectionColor={vi.fn()}
          onEdgeStyle={vi.fn()}
          onOverlay={vi.fn()}
          onConnection={vi.fn()}
          onDeleteSelection={vi.fn()}
          onLayerState={onLayerState}
          onClose={vi.fn()}
        />
      </I18nextProvider>,
    );
    const labels = screen
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(labels[0]).toContain("tessera.basic.cell-style · 500");
    expect(labels[1]).toContain("tessera.system.grid · 900");
    expect(labels.at(-1)).toContain("tessera.basic.annotation · 4400");
    const gridLock = screen.getAllByRole("checkbox", { name: "锁定" })[1];
    expect((gridLock as HTMLInputElement | undefined)?.disabled).toBe(true);
    const firstVisible = screen.getAllByRole("checkbox", { name: "显示" })[0];
    if (firstVisible === undefined) throw new Error("缺少图层显示控件");
    await user.click(firstVisible);
    expect(onLayerState).toHaveBeenCalledWith("tessera.basic.cell-style", {
      visible: false,
    });
  });

  it("属性检查器展示选择并通过回调统一修改颜色", () => {
    const onSelectionColor = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <ContextPanel
          {...connectionActions}
          panel="properties"
          state={project()}
          selection={[{ kind: "cell", id: "cell:square:1:1" }]}
          onSelectionColor={onSelectionColor}
          onEdgeStyle={vi.fn()}
          onOverlay={vi.fn()}
          onConnection={vi.fn()}
          onDeleteSelection={vi.fn()}
          onLayerState={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nextProvider>,
    );
    expect(screen.getByText("已选择 1 个对象")).toBeDefined();
    fireEvent.change(screen.getByLabelText("共同颜色"), {
      target: { value: "#112233" },
    });
    expect(onSelectionColor).toHaveBeenCalledWith("#112233");
    expect(screen.getByText("地格")).toBeDefined();
  });

  it("文字旋转直接读写度数并在输入时规范化", () => {
    const store = new EditorStore(project());
    const overlayId = store.placeText({ x: 32, y: 32 }, "九十度", {
      rotation: 90,
    });
    const onOverlay = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <ContextPanel
          {...connectionActions}
          panel="properties"
          state={store.state}
          selection={[{ kind: "overlay", id: overlayId }]}
          onSelectionColor={vi.fn()}
          onEdgeStyle={vi.fn()}
          onOverlay={onOverlay}
          onConnection={vi.fn()}
          onDeleteSelection={vi.fn()}
          onLayerState={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nextProvider>,
    );
    const rotation = screen.getByLabelText("旋转（度）");
    expect((rotation as HTMLInputElement).value).toBe("90");
    fireEvent.change(rotation, { target: { value: "450" } });
    expect(onOverlay.mock.calls[0]?.[1].style.rotation).toBe(90);
  });

  it("缺失模块占位层显示状态且不能解锁", () => {
    const state = project();
    (state.layers as Map<string, FixedLayerState>).set(
      "example.missing.layer",
      {
        layerId: "example.missing.layer",
        moduleVersion: "1.0.0",
        zIndex: 1200,
        visible: true,
        locked: true,
        opacity: 1,
        allowedKinds: [],
        runtimeStatus: "missing",
      },
    );
    render(
      <I18nextProvider i18n={i18n}>
        <ContextPanel
          {...connectionActions}
          panel="layers"
          state={state}
          selection={[]}
          onSelectionColor={vi.fn()}
          onEdgeStyle={vi.fn()}
          onOverlay={vi.fn()}
          onConnection={vi.fn()}
          onDeleteSelection={vi.fn()}
          onLayerState={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nextProvider>,
    );

    const item = screen.getByText("example.missing.layer · 1200").closest("li");
    expect(item?.textContent).toContain(
      "所需模块缺失；图层数据已保留并强制只读",
    );
    if (item === null) throw new Error("缺少占位层列表项");
    const unlock = within(item).getByRole("checkbox", { name: "锁定" });
    expect((unlock as HTMLInputElement).disabled).toBe(true);
  });

  it("标记属性面板暴露形状、尺寸、旋转、透明度和颜色", () => {
    const store = new EditorStore(project());
    const markerId = store.placeMarker(
      { kind: "cell", cellId: "cell:square:1:1" },
      "#123456FF",
      "circle",
    );
    const onOverlay = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <ContextPanel
          {...connectionActions}
          panel="properties"
          state={store.state}
          selection={[{ kind: "overlay", id: markerId }]}
          onSelectionColor={vi.fn()}
          onEdgeStyle={vi.fn()}
          onOverlay={onOverlay}
          onConnection={vi.fn()}
          onDeleteSelection={vi.fn()}
          onLayerState={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nextProvider>,
    );
    fireEvent.change(screen.getByLabelText("标记形状"), {
      target: { value: "diamond" },
    });
    expect(onOverlay.mock.calls[0]?.[1].style.markerShape).toBe("diamond");
    expect(screen.getByLabelText("标记尺寸")).toBeDefined();
    expect(screen.getByLabelText("旋转（度）")).toBeDefined();
    expect(screen.getByLabelText("透明度")).toBeDefined();
    expect(screen.getByLabelText("标记颜色")).toBeDefined();
  });

  it("箭头提供反转与端点重绑定状态和取消入口", () => {
    const store = new EditorStore(project());
    const connectionId = store.createConnection(
      { kind: "cell-center", cellId: "cell:square:1:1" },
      { kind: "cell-center", cellId: "cell:square:1:2" },
      { kind: "arrow", arrowMode: "end" },
    );
    const onReverseConnection = vi.fn();
    const onBeginConnectionRebind = vi.fn();
    const onCancelConnectionRebind = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <ContextPanel
          panel="properties"
          state={store.state}
          selection={[{ kind: "connection", id: connectionId }]}
          onSelectionColor={vi.fn()}
          onEdgeStyle={vi.fn()}
          onOverlay={vi.fn()}
          onConnection={vi.fn()}
          connectionRebind={{ connectionId, endpoint: "start" }}
          onReverseConnection={onReverseConnection}
          onBeginConnectionRebind={onBeginConnectionRebind}
          onCancelConnectionRebind={onCancelConnectionRebind}
          onDeleteSelection={vi.fn()}
          onLayerState={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nextProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "反转方向" }));
    expect(onReverseConnection).toHaveBeenCalledWith(connectionId);
    expect(screen.getByText(/正在重新绑定起点/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancelConnectionRebind).toHaveBeenCalledOnce();
  });
});

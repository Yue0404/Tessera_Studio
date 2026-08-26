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

  it("基础文字按字素和行数拒绝超限内容且不产生写入", () => {
    const store = new EditorStore(project());
    const overlayId = store.placeText({ x: 32, y: 32 }, "原文");
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

    fireEvent.change(screen.getByLabelText("文字内容"), {
      target: { value: "👩🏽‍💻".repeat(257) },
    });
    expect(onOverlay).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain(
      "文字最多 256 个字素、8 行",
    );
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

  it("标记属性面板可编辑附文、形状、尺寸、旋转、透明度和颜色", () => {
    const store = new EditorStore(project());
    const markerId = store.placeMarker(
      { kind: "cell", cellId: "cell:square:1:1" },
      "#123456FF",
      "circle",
      "前线",
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
    expect((screen.getByLabelText("标记附文") as HTMLInputElement).value).toBe(
      "前线",
    );
    fireEvent.change(screen.getByLabelText("标记附文"), {
      target: { value: "集结点" },
    });
    expect(onOverlay.mock.calls[0]?.[1].label).toBe("集结点");
    fireEvent.change(screen.getByLabelText("标记形状"), {
      target: { value: "diamond" },
    });
    expect(onOverlay.mock.calls[1]?.[1].style.markerShape).toBe("diamond");
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

  it("generic 实例可编辑 JSON 覆盖并通过统一回调提交", () => {
    const state = project();
    (state.layers as Map<string, FixedLayerState>).set(
      "example.weather.surface",
      {
        layerId: "example.weather.surface",
        moduleVersion: "1.0.0",
        zIndex: 2500,
        visible: true,
        locked: false,
        opacity: 1,
        allowedKinds: ["cell"],
        runtimeStatus: "available",
      },
    );
    state.moduleInstances.add({
      kind: "cell",
      instanceId: "generic-cell",
      elementId: "example.weather:cell.rain",
      layerId: "example.weather.surface",
      cellId: "cell:square:1:1",
      attributes: { intensity: 3 },
      styleOverrides: {},
      extensions: {},
      runtimeStatus: "available",
    });
    const onModuleInstance = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <ContextPanel
          {...connectionActions}
          panel="properties"
          state={state}
          selection={[{ kind: "module-instance", id: "generic-cell" }]}
          onSelectionColor={vi.fn()}
          onEdgeStyle={vi.fn()}
          onOverlay={vi.fn()}
          onConnection={vi.fn()}
          onModuleInstance={onModuleInstance}
          moduleRuleHints={[
            {
              instanceId: "generic-cell",
              elementId: "example.weather:cell.rain",
              severity: "error",
              kind: "occupancy",
              message: "",
              slotId: "example.weather:slot.rain",
              count: 2,
            },
            {
              instanceId: "generic-cell",
              elementId: "example.weather:cell.rain",
              severity: "warning",
              kind: "constraint",
              message: "附近需要排水设施",
              constraintId: "example.weather:constraint.drainage",
            },
          ]}
          onDeleteSelection={vi.fn()}
          onLayerState={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nextProvider>,
    );
    expect(screen.getAllByText("example.weather:cell.rain")).toHaveLength(2);
    const ruleHints = screen.getByRole("region", { name: "规则提示" });
    expect(ruleHints.textContent).toContain("错误");
    expect(ruleHints.textContent).toContain(
      "占用槽位 example.weather:slot.rain 当前有 2 个对象。",
    );
    expect(ruleHints.textContent).toContain("警告 附近需要排水设施");
    const style = screen.getByLabelText("样式覆盖（JSON）");
    fireEvent.change(style, {
      target: { value: JSON.stringify({ fillOpacity: 0.5 }) },
    });
    fireEvent.blur(style);
    expect(onModuleInstance).toHaveBeenCalledWith("generic-cell", {
      styleOverrides: { fillOpacity: 0.5 },
    });
    onModuleInstance.mockClear();
    fireEvent.change(style, { target: { value: "{" } });
    fireEvent.blur(style);
    expect(screen.getByRole("alert").textContent).toContain(
      "输入不符合模块声明，未保存更改",
    );
    expect((style as HTMLTextAreaElement).value).toBe("{}");
    expect(onModuleInstance).not.toHaveBeenCalled();

    const attributes = screen.getByLabelText("模块属性（JSON）");
    onModuleInstance.mockImplementationOnce(() => {
      throw new Error("schema rejected");
    });
    fireEvent.change(attributes, {
      target: { value: JSON.stringify({ intensity: "invalid" }) },
    });
    expect(() => fireEvent.blur(attributes)).not.toThrow();
    expect((attributes as HTMLTextAreaElement).value).toContain(
      '"intensity": 3',
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "输入不符合模块声明，未保存更改",
    );
    expect(
      (
        screen.getByRole("button", {
          name: "删除所选对象",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("DomainGroup 可用当前所选地格原子替换成员并显示非破坏性错误", () => {
    const state = project();
    (state.layers as Map<string, FixedLayerState>).set(
      "example.weather.surface",
      {
        layerId: "example.weather.surface",
        moduleVersion: "1.0.0",
        zIndex: 2500,
        visible: true,
        locked: false,
        opacity: 1,
        allowedKinds: ["domain-group"],
        runtimeStatus: "available",
      },
    );
    state.moduleInstances.add({
      kind: "domain-group",
      instanceId: "generic-domain",
      elementId: "example.weather:domain.zone",
      layerId: "example.weather.surface",
      memberCellIds: ["cell:square:1:1", "cell:square:1:2"],
      attributes: {},
      styleOverrides: {},
      extensions: {},
      runtimeStatus: "available",
    });
    const onDomainGroupMembers = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <ContextPanel
          {...connectionActions}
          panel="properties"
          state={state}
          selection={[
            { kind: "module-instance", id: "generic-domain" },
            { kind: "cell", id: "cell:square:4:4" },
            { kind: "cell", id: "cell:square:4:5" },
          ]}
          onSelectionColor={vi.fn()}
          onEdgeStyle={vi.fn()}
          onOverlay={vi.fn()}
          onConnection={vi.fn()}
          onDomainGroupMembers={onDomainGroupMembers}
          onDeleteSelection={vi.fn()}
          onLayerState={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nextProvider>,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: /扩展模块实例.*example\.weather:domain\.zone/u,
      }),
    );
    const replace = screen.getByRole("button", {
      name: "用当前所选地格替换领域成员",
    });
    expect((replace as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(replace);
    expect(onDomainGroupMembers).toHaveBeenCalledWith("generic-domain", [
      "cell:square:4:4",
      "cell:square:4:5",
    ]);

    onDomainGroupMembers.mockImplementationOnce(() => {
      throw new Error("domain-group-members-disconnected");
    });
    fireEvent.click(replace);
    expect(screen.getByRole("alert").textContent).toContain(
      "输入不符合模块声明，未保存更改",
    );
  });

  it("missing generic 占位可选择但属性与删除均只读", () => {
    const state = project();
    (state.layers as Map<string, FixedLayerState>).set(
      "example.missing.surface",
      {
        layerId: "example.missing.surface",
        moduleVersion: "1.0.0",
        zIndex: 2500,
        visible: true,
        locked: true,
        opacity: 1,
        allowedKinds: [],
        runtimeStatus: "missing",
      },
    );
    state.moduleInstances.add({
      kind: "cell",
      instanceId: "missing-cell",
      elementId: "example.missing:cell.rain",
      layerId: "example.missing.surface",
      cellId: "cell:square:1:1",
      attributes: { intensity: 3 },
      styleOverrides: {},
      extensions: {},
      runtimeStatus: "missing",
    });
    const onModuleInstance = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <ContextPanel
          {...connectionActions}
          panel="properties"
          state={state}
          selection={[{ kind: "module-instance", id: "missing-cell" }]}
          onSelectionColor={vi.fn()}
          onEdgeStyle={vi.fn()}
          onOverlay={vi.fn()}
          onConnection={vi.fn()}
          onModuleInstance={onModuleInstance}
          onDeleteSelection={vi.fn()}
          onLayerState={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nextProvider>,
    );
    expect(screen.getByText("所需模块缺失；实例只读且不可删除")).toBeDefined();
    expect(
      (screen.getByLabelText("模块属性（JSON）") as HTMLTextAreaElement)
        .disabled,
    ).toBe(true);
    fireEvent.blur(screen.getByLabelText("模块属性（JSON）"));
    expect(onModuleInstance).not.toHaveBeenCalled();
    expect(
      (
        screen.getByRole("button", {
          name: "删除所选对象",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("多选先展示坐标摘要，hover 不改选择并可下钻、返回和单项删除", async () => {
    const user = userEvent.setup();
    const store = new EditorStore(project());
    const markerId = store.placeMarker(
      { kind: "cell", cellId: "cell:square:2:3" },
      "#123456FF",
      "diamond",
    );
    const selection = [
      { kind: "cell", id: "cell:square:1:1" },
      { kind: "cell", id: "cell:square:1:2" },
      { kind: "overlay", id: markerId },
    ] as const;
    const onSelectionHover = vi.fn();
    const onDeleteSelection = vi.fn();
    const onDeleteObject = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <ContextPanel
          {...connectionActions}
          panel="properties"
          state={store.state}
          selection={selection}
          onSelectionColor={vi.fn()}
          onEdgeStyle={vi.fn()}
          onOverlay={vi.fn()}
          onConnection={vi.fn()}
          onDeleteSelection={onDeleteSelection}
          onDeleteObject={onDeleteObject}
          onSelectionHover={onSelectionHover}
          onLayerState={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nextProvider>,
    );

    const list = screen.getByRole("list", { name: "所选对象摘要" });
    expect(within(list).getByText("行 2，列 3")).toBeDefined();
    expect(within(list).getByText("菱形标记")).toBeDefined();
    const marker = within(list).getByRole("button", {
      name: /文字或标记.*行 2，列 3.*菱形标记/u,
    });
    fireEvent.mouseEnter(marker);
    expect(onSelectionHover).toHaveBeenLastCalledWith(selection[2]);
    fireEvent.mouseLeave(marker);
    expect(onSelectionHover).toHaveBeenLastCalledWith(null);
    expect(selection).toHaveLength(3);

    Object.defineProperty(list, "scrollTop", { value: 84, writable: true });
    await user.click(marker);
    expect(screen.getByRole("button", { name: "返回" })).toBeDefined();
    expect(screen.getByLabelText("标记形状")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "返回" }));
    expect(screen.getByRole("list", { name: "所选对象摘要" }).scrollTop).toBe(
      84,
    );

    await user.click(screen.getByRole("button", { name: "删除全部 3 个对象" }));
    expect(onDeleteSelection).toHaveBeenCalledOnce();
    await user.click(
      within(screen.getByRole("list", { name: "所选对象摘要" })).getByRole(
        "button",
        { name: /文字或标记.*菱形标记/u },
      ),
    );
    await user.click(screen.getByRole("button", { name: "删除此对象" }));
    expect(onDeleteObject).toHaveBeenCalledWith(selection[2]);
    expect(screen.getByRole("list", { name: "所选对象摘要" })).toBeDefined();
  });

  it("地图面板接入受控设置表单并呈现底层错误", () => {
    const onMapSettingsSubmit = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <ContextPanel
          {...connectionActions}
          panel="map"
          state={project()}
          selection={[]}
          onSelectionColor={vi.fn()}
          onEdgeStyle={vi.fn()}
          onOverlay={vi.fn()}
          onConnection={vi.fn()}
          onDeleteSelection={vi.fn()}
          onLayerState={vi.fn()}
          onMapSettingsSubmit={onMapSettingsSubmit}
          mapSettingsError="地图缩小后会产生越界对象"
          onClose={vi.fn()}
        />
      </I18nextProvider>,
    );
    expect(screen.getByRole("alert").textContent).toContain("越界对象");
    fireEvent.change(screen.getByLabelText("宽度"), {
      target: { value: "8" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用地图设置" }));
    expect(onMapSettingsSubmit).toHaveBeenCalledWith({
      type: "square",
      width: 8,
      height: 10,
      cellSize: 32,
    });
  });
});

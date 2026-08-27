import { fireEvent, render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import i18n from "../i18n.js";
import { ElementCatalog, type ElementCatalogEntry } from "./ElementCatalog.js";

describe("ElementCatalog", () => {
  function renderCatalog(
    overrides: {
      onElementSelect?: (elementId: string) => void;
      elements?: readonly ElementCatalogEntry[];
      activeElementId?: string | null;
    } = {},
  ) {
    return render(
      <I18nextProvider i18n={i18n}>
        <ElementCatalog
          collapsed={false}
          onToggle={vi.fn()}
          activeTool="brush"
          brushColor="#E3614D"
          brushMode="paint"
          edgeColor="#D9B866"
          markerLabel=""
          overlay={{ type: "marker", anchor: "cell", markerShape: "pin" }}
          textOptions={{
            text: "",
            fontSize: 18,
            color: "#F4EFE4",
            fontWeight: "normal",
            align: "center",
            rotation: 0,
          }}
          connection={{
            kind: "arrow",
            endpoint: "cell-center",
            arrowMode: "end",
            label: "",
          }}
          onBrushColor={vi.fn()}
          onBrushMode={vi.fn()}
          onEdgeColor={vi.fn()}
          onMarkerLabel={vi.fn()}
          onOverlay={vi.fn()}
          onTextOptions={vi.fn()}
          onConnection={vi.fn()}
          activeElementId={
            overrides.activeElementId === undefined
              ? "tessera.basic:cell.color"
              : overrides.activeElementId
          }
          {...(overrides.elements === undefined
            ? {}
            : { elements: overrides.elements })}
          {...(overrides.onElementSelect === undefined
            ? {}
            : { onElementSelect: overrides.onElementSelect })}
        />
      </I18nextProvider>,
    );
  }

  it("标记附文在左侧标记设置中编辑", () => {
    const onMarkerLabel = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <ElementCatalog
          collapsed={false}
          onToggle={vi.fn()}
          activeElementId="tessera.basic:marker"
          activeTool="marker"
          brushColor="#E3614D"
          brushMode="paint"
          edgeColor="#D9B866"
          markerLabel="港口"
          overlay={{ type: "marker", anchor: "cell", markerShape: "pin" }}
          textOptions={{
            text: "",
            fontSize: 18,
            color: "#F4EFE4",
            fontWeight: "normal",
            align: "center",
            rotation: 0,
          }}
          connection={{
            kind: "arrow",
            endpoint: "cell-center",
            arrowMode: "end",
            label: "",
          }}
          onBrushColor={vi.fn()}
          onBrushMode={vi.fn()}
          onEdgeColor={vi.fn()}
          onMarkerLabel={onMarkerLabel}
          onOverlay={vi.fn()}
          onTextOptions={vi.fn()}
          onConnection={vi.fn()}
        />
      </I18nextProvider>,
    );
    const input = screen.getByLabelText("标记附文");
    expect((input as HTMLInputElement).value).toBe("港口");
    fireEvent.change(input, { target: { value: "城邦" } });
    expect(onMarkerLabel).toHaveBeenCalledWith("城邦");
  });

  it("放置文字的旋转输入保持度数并规范化到 [0,360)", () => {
    const onTextOptions = vi.fn();
    const onTextInvalid = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <ElementCatalog
          collapsed={false}
          onToggle={vi.fn()}
          activeElementId="tessera.basic:text"
          activeTool="marker"
          brushColor="#E3614D"
          brushMode="paint"
          edgeColor="#D9B866"
          markerLabel=""
          overlay={{
            type: "text",
            anchor: "map-point",
            markerShape: "pin",
          }}
          textOptions={{
            text: "方向",
            fontSize: 18,
            color: "#F4EFE4",
            fontWeight: "normal",
            align: "center",
            rotation: 90,
          }}
          connection={{
            kind: "arrow",
            endpoint: "cell-center",
            arrowMode: "end",
            label: "",
          }}
          onBrushColor={vi.fn()}
          onBrushMode={vi.fn()}
          onEdgeColor={vi.fn()}
          onMarkerLabel={vi.fn()}
          onOverlay={vi.fn()}
          onTextOptions={onTextOptions}
          validateText={(value) => value !== "invalid"}
          onTextInvalid={onTextInvalid}
          onConnection={vi.fn()}
        />
      </I18nextProvider>,
    );
    const rotation = screen.getByLabelText("旋转（度）");
    expect((rotation as HTMLInputElement).value).toBe("90");
    fireEvent.change(rotation, { target: { value: "-90" } });
    expect(onTextOptions).toHaveBeenCalledWith(
      expect.objectContaining({ rotation: 270 }),
    );
    onTextOptions.mockClear();
    fireEvent.change(screen.getByLabelText("文字内容"), {
      target: { value: "invalid" },
    });
    expect(onTextInvalid).toHaveBeenCalledOnce();
    expect(onTextOptions).not.toHaveBeenCalled();

    onTextInvalid.mockClear();
    fireEvent.change(screen.getByLabelText("文字内容"), {
      target: { value: "👩🏽‍💻".repeat(257) },
    });
    expect(onTextInvalid).toHaveBeenCalledOnce();
    expect(onTextOptions).not.toHaveBeenCalled();
  });

  it("按显示名称和分类筛选已载入基础元素，清空搜索恢复全部", () => {
    renderCatalog();
    expect(screen.getAllByRole("listitem")).toHaveLength(9);
    const search = screen.getByRole("searchbox", { name: "搜索元素" });
    fireEvent.change(search, { target: { value: "箭头" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(
      within(screen.getByRole("list", { name: "元素搜索结果" })).getByText(
        "箭头",
      ),
    ).toBeDefined();
    fireEvent.change(search, { target: { value: "" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(9);
    fireEvent.change(screen.getByLabelText("分类"), {
      target: { value: "overlay" },
    });
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("搜索输入保持键盘焦点且元素按钮通过统一回调激活", () => {
    const onElementSelect = vi.fn();
    renderCatalog({ onElementSelect });
    const search = screen.getByRole("searchbox", { name: "搜索元素" });
    search.focus();
    fireEvent.keyDown(search, { code: "Space", key: " " });
    fireEvent.change(search, { target: { value: "标 记" } });
    expect(document.activeElement).toBe(search);
    fireEvent.change(search, { target: { value: "标记" } });
    const elementButton = screen.getByRole("button", {
      name: "使用目录元素 tessera.basic:marker",
    });
    const panel = screen.getByTestId("element-catalog-panel");
    panel.scrollTop = 120;
    expect(elementButton.getAttribute("aria-label")).not.toMatch(
      /选择|标记|边/u,
    );
    fireEvent.click(elementButton);
    expect(onElementSelect).toHaveBeenCalledWith("tessera.basic:marker");
    expect(panel.scrollTop).toBe(0);
  });

  it("没有选择回调时目录项保持可读但不伪装成按钮", () => {
    renderCatalog();
    expect(screen.getAllByRole("listitem")).toHaveLength(9);
    expect(
      screen.queryByRole("button", { name: /tessera\.basic:marker/u }),
    ).toBeNull();
    expect(
      within(screen.getByRole("list", { name: "元素搜索结果" })).getByText(
        "标记",
      ),
    ).toBeDefined();
  });

  it("外部会话误传 basic 重复项时仍保留九个可用内置元素", () => {
    renderCatalog({
      onElementSelect: vi.fn(),
      elements: [
        {
          moduleId: "tessera.basic",
          moduleVersion: "1.0.0",
          category: "overlay",
          elementId: "tessera.basic:text",
          displayName: "重复文字",
          disabledReason: "text-attribute-unsupported",
        },
      ],
    });
    expect(screen.getAllByRole("listitem")).toHaveLength(9);
    const text = screen.getByRole("button", {
      name: "使用目录元素 tessera.basic:text",
    });
    expect((text as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText("重复文字")).toBeNull();
  });

  it("按模块与本地化分类浏览，并保留禁用原因", () => {
    const onElementSelect = vi.fn();
    renderCatalog({
      onElementSelect,
      elements: [
        {
          moduleId: "example.weather",
          moduleVersion: "1.0.0",
          moduleDisplayName: "天气",
          category: "cell",
          categoryId: "example.weather:terrain",
          categoryDisplayName: "地形天气",
          elementId: "example.weather:cell.rain",
          displayName: "降雨",
          disabledReason: null,
        },
        {
          moduleId: "example.weather",
          moduleVersion: "1.0.0",
          moduleDisplayName: "天气",
          category: "overlay",
          categoryId: "example.weather:resource",
          categoryDisplayName: "资源图标",
          elementId: "example.weather:marker.radar",
          displayName: "雷达",
          disabledReason: "resource-style-unsupported",
        },
      ],
    });
    fireEvent.change(screen.getByLabelText("当前模块"), {
      target: { value: "example.weather" },
    });
    expect(screen.getByText("天气")).toBeDefined();
    fireEvent.change(screen.getByLabelText("分类"), {
      target: { value: "example.weather:resource" },
    });
    const disabled = screen.getByRole("button", {
      name: "使用目录元素 example.weather:marker.radar",
    });
    expect((disabled as HTMLButtonElement).disabled).toBe(true);
    expect(disabled.getAttribute("data-disabled-reason")).toBe(
      "resource-style-unsupported",
    );
    expect(screen.getByText("此元素依赖尚未支持的资源样式。")).toBeDefined();
    expect(onElementSelect).not.toHaveBeenCalled();
  });

  it("受控标记设置位于目录搜索前且不混入文字选项", () => {
    renderCatalog({ activeElementId: "tessera.basic:marker" });
    const settings = screen.getByRole("region", { name: "当前元素设置" });
    const search = screen.getByRole("searchbox", { name: "搜索元素" });
    expect(
      settings.compareDocumentPosition(search) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(
      within(settings).getByRole("heading", { name: "标记设置" }),
    ).toBeDefined();
    expect(within(settings).getByLabelText("标记形状")).toBeDefined();
    expect(
      (within(settings).getByLabelText("标记颜色") as HTMLInputElement).value,
    ).toBe("#e3614d");
    expect(within(settings).queryByLabelText("文字内容")).toBeNull();
    expect(screen.queryByLabelText("元素类型")).toBeNull();
  });

  it("受控文字设置只渲染文字选项且不渲染标记形状", () => {
    renderCatalog({ activeElementId: "tessera.basic:text" });
    const settings = screen.getByRole("region", { name: "当前元素设置" });
    expect(
      within(settings).getByRole("heading", { name: "文字设置" }),
    ).toBeDefined();
    expect(within(settings).getByLabelText("文字内容")).toBeDefined();
    expect(within(settings).queryByLabelText("标记形状")).toBeNull();
    expect(screen.queryByLabelText("元素类型")).toBeNull();
  });

  it("没有当前元素时只保留目录，不渲染当前设置区", () => {
    renderCatalog({ activeElementId: null });
    expect(screen.queryByRole("region", { name: "当前元素设置" })).toBeNull();
    expect(screen.getByRole("heading", { name: "元素目录" })).toBeDefined();
  });

  it("扩展文字只显示放置链路实际消费的锚定与内容", () => {
    renderCatalog({
      activeElementId: "example.weather:text.note",
      elements: [
        {
          moduleId: "example.weather",
          moduleVersion: "1.0.0",
          moduleDisplayName: "天气",
          category: "overlay",
          primitive: "text",
          elementId: "example.weather:text.note",
          displayName: "天气注记",
        },
      ],
    });
    const settings = screen.getByRole("region", { name: "当前元素设置" });
    expect(
      within(settings).getByRole("heading", { name: "文字设置" }),
    ).toBeDefined();
    expect(within(settings).getByLabelText("文字内容")).toBeDefined();
    expect(within(settings).getByLabelText("锚定方式")).toBeDefined();
    expect(within(settings).queryByLabelText("字号")).toBeNull();
    expect(within(settings).queryByLabelText("文字颜色")).toBeNull();
    expect(within(settings).queryByLabelText("字重")).toBeNull();
    expect(within(settings).queryByLabelText("对齐")).toBeNull();
    expect(within(settings).queryByLabelText("旋转（度）")).toBeNull();
    expect(within(settings).queryByLabelText("标记形状")).toBeNull();
  });

  it("扩展标记与连线不暴露由模块默认样式决定的无效控件", () => {
    const entries: readonly ElementCatalogEntry[] = [
      {
        moduleId: "example.weather",
        moduleVersion: "1.0.0",
        category: "overlay",
        primitive: "marker",
        elementId: "example.weather:marker.radar",
        displayName: "雷达",
      },
      {
        moduleId: "example.weather",
        moduleVersion: "1.0.0",
        category: "connection",
        primitive: "connection",
        elementId: "example.weather:connection.front",
        displayName: "锋面",
      },
    ];
    const marker = renderCatalog({
      activeElementId: "example.weather:marker.radar",
      elements: entries,
    });
    let settings = screen.getByRole("region", { name: "当前元素设置" });
    expect(within(settings).getByLabelText("锚定方式")).toBeDefined();
    expect(within(settings).queryByLabelText("标记形状")).toBeNull();
    expect(within(settings).queryByLabelText("标记颜色")).toBeNull();

    marker.unmount();
    renderCatalog({
      activeElementId: "example.weather:connection.front",
      elements: entries,
    });
    settings = screen.getByRole("region", { name: "当前元素设置" });
    expect(within(settings).getByLabelText("端点类型")).toBeDefined();
    expect(within(settings).getByLabelText("短标签")).toBeDefined();
    expect(within(settings).queryByLabelText("连线类型")).toBeNull();
    expect(within(settings).queryByLabelText("箭头模式")).toBeNull();
  });

  it.each([
    ["cell-style", "example.weather:cell.rain"],
    ["edge-style", "example.weather:edge.front"],
    ["domain-object", "example.weather:domain.storm"],
  ] as const)("扩展 %s 使用模块默认样式提示", (primitive, elementId) => {
    renderCatalog({
      activeElementId: elementId,
      elements: [
        {
          moduleId: "example.weather",
          moduleVersion: "1.0.0",
          category: primitive === "edge-style" ? "edge" : "cell",
          primitive,
          elementId,
          displayName: "模块元素",
        },
      ],
    });
    const settings = screen.getByRole("region", { name: "当前元素设置" });
    expect(
      within(settings).getByText("使用模块默认样式，放置后选择对象编辑。"),
    ).toBeDefined();
    expect(within(settings).queryByLabelText("填充颜色")).toBeNull();
    expect(within(settings).queryByLabelText("边颜色")).toBeNull();
  });
});

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
    } = {},
  ) {
    return render(
      <I18nextProvider i18n={i18n}>
        <ElementCatalog
          collapsed={false}
          onToggle={vi.fn()}
          brushColor="#E3614D"
          brushMode="paint"
          edgeColor="#D9B866"
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
          onOverlay={vi.fn()}
          onTextOptions={vi.fn()}
          onConnection={vi.fn()}
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

  it("放置文字的旋转输入保持度数并规范化到 [0,360)", () => {
    const onTextOptions = vi.fn();
    const onTextInvalid = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <ElementCatalog
          collapsed={false}
          onToggle={vi.fn()}
          brushColor="#E3614D"
          brushMode="paint"
          edgeColor="#D9B866"
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
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    const search = screen.getByRole("searchbox", { name: "搜索元素" });
    fireEvent.change(search, { target: { value: "箭头" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(
      within(screen.getByRole("list", { name: "元素搜索结果" })).getByText(
        "箭头",
      ),
    ).toBeDefined();
    fireEvent.change(search, { target: { value: "" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
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
    expect(elementButton.getAttribute("aria-label")).not.toMatch(
      /选择|标记|边/u,
    );
    fireEvent.click(elementButton);
    expect(onElementSelect).toHaveBeenCalledWith("tessera.basic:marker");
  });

  it("没有选择回调时目录项保持可读但不伪装成按钮", () => {
    renderCatalog();
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(
      screen.queryByRole("button", { name: /tessera\.basic:marker/u }),
    ).toBeNull();
    expect(
      within(screen.getByRole("list", { name: "元素搜索结果" })).getByText(
        "标记",
      ),
    ).toBeDefined();
  });

  it("外部会话误传 basic 重复项时仍保留六个可用内置元素", () => {
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
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
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
});

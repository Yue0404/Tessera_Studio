import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import i18n from "../i18n.js";
import { ElementCatalog } from "./ElementCatalog.js";

describe("ElementCatalog", () => {
  function renderCatalog(
    overrides: {
      onElementSelect?: (elementId: string) => void;
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
          {...(overrides.onElementSelect === undefined
            ? {}
            : { onElementSelect: overrides.onElementSelect })}
        />
      </I18nextProvider>,
    );
  }

  it("放置文字的旋转输入保持度数并规范化到 [0,360)", () => {
    const onTextOptions = vi.fn();
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
  });

  it("按显示名称和分类筛选已载入基础元素，清空搜索恢复全部", () => {
    renderCatalog();
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    const search = screen.getByRole("searchbox", { name: "搜索元素" });
    fireEvent.change(search, { target: { value: "箭头" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /箭头/ })).toBeDefined();
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
    fireEvent.click(screen.getByRole("button", { name: /标记/ }));
    expect(onElementSelect).toHaveBeenCalledWith("tessera.basic:marker");
  });
});

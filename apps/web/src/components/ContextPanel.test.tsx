import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createProject, EditorStore } from "@tessera/core";
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

describe("ContextPanel", () => {
  it("固定图层按高度排序并提供显隐、锁定和透明度控制", async () => {
    const user = userEvent.setup();
    const onLayerState = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <ContextPanel
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
});

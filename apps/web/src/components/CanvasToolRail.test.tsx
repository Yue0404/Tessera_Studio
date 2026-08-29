/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as Tooltip from "@radix-ui/react-tooltip";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n.js";
import { CanvasToolRail } from "./CanvasToolRail.js";

const OBJECT_PRESETS = [
  {
    elementId: "example.weather:object.circle",
    displayName: "气象圆阵",
    disabledReason: null,
    shape: "circle" as const,
  },
  {
    elementId: "example.weather:object.cluster",
    displayName: "七格气象站",
    disabledReason: "grid-unsupported",
    shape: "hexagon" as const,
  },
] as const;

describe("CanvasToolRail", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("在标记入口右侧只选择标记或文字，并显示可展开角标", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
    const user = userEvent.setup();
    const onOverlayType = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <Tooltip.Provider delayDuration={0}>
          <CanvasToolRail
            tool="marker"
            catalogCollapsed={false}
            overlayType="marker"
            eraserMode="click"
            activeElementId={null}
            objectPresets={OBJECT_PRESETS}
            onTool={vi.fn()}
            onOverlayType={onOverlayType}
            onEraserMode={vi.fn()}
            onObjectSelect={vi.fn()}
            onContext={vi.fn()}
          />
        </Tooltip.Provider>
      </I18nextProvider>,
    );

    await user.click(screen.getByRole("button", { name: "标记" }));
    const dialog = screen.getByRole("dialog", { name: "选择放置类型" });
    expect(dialog.getAttribute("data-popover-side")).toBe("right");
    expect(
      screen.getByRole("radio", { name: "标记" }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.queryByLabelText("标记附文")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "标记" })
        .querySelector('[aria-hidden="true"]'),
    ).not.toBeNull();
    await user.click(screen.getByRole("radio", { name: "文字" }));
    expect(onOverlayType).toHaveBeenCalledWith("text");
    expect(screen.queryByRole("dialog", { name: "选择放置类型" })).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "标记" }),
    );
  });

  it("橡皮擦入口选择单击或滑动模式后切换工具", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
    const user = userEvent.setup();
    const onTool = vi.fn();
    const onEraserMode = vi.fn();
    const view = render(
      <I18nextProvider i18n={i18n}>
        <Tooltip.Provider delayDuration={0}>
          <CanvasToolRail
            tool="select"
            catalogCollapsed={false}
            overlayType="marker"
            eraserMode="click"
            activeElementId={null}
            objectPresets={OBJECT_PRESETS}
            onTool={onTool}
            onOverlayType={vi.fn()}
            onEraserMode={onEraserMode}
            onObjectSelect={vi.fn()}
            onContext={vi.fn()}
          />
        </Tooltip.Provider>
      </I18nextProvider>,
    );

    const eraser = screen.getByRole("button", {
      name: "橡皮擦 · 单击擦除",
    });
    expect(eraser.textContent).not.toMatch(/单击|滑动/u);
    expect(within(eraser).getByTestId("eraser-base-icon")).toBeDefined();
    expect(within(eraser).queryByTestId("eraser-drag-trail")).toBeNull();
    await user.hover(eraser);
    expect((await screen.findByRole("tooltip")).textContent).toContain(
      "单击擦除",
    );
    await user.unhover(eraser);
    await user.click(eraser);
    expect(screen.getByRole("dialog", { name: "选择擦除方式" })).toBeDefined();
    const click = screen.getByRole("radio", { name: "单击擦除" });
    const drag = screen.getByRole("radio", { name: "滑动擦除" });
    expect(click.getAttribute("data-quick-choice-layout")).toBe("single-line");
    expect(drag.getAttribute("data-quick-choice-layout")).toBe("single-line");
    expect(
      click.querySelector("svg")?.getAttribute("data-quick-choice-icon"),
    ).toBe("click");
    expect(
      drag.querySelector("svg")?.getAttribute("data-quick-choice-icon"),
    ).toBe("drag");
    await user.click(drag);
    expect(onEraserMode).toHaveBeenCalledWith("drag");
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <Tooltip.Provider delayDuration={0}>
          <CanvasToolRail
            tool="eraser"
            catalogCollapsed={false}
            overlayType="marker"
            eraserMode="drag"
            activeElementId={null}
            objectPresets={OBJECT_PRESETS}
            onTool={onTool}
            onOverlayType={vi.fn()}
            onEraserMode={onEraserMode}
            onObjectSelect={vi.fn()}
            onContext={vi.fn()}
          />
        </Tooltip.Provider>
      </I18nextProvider>,
    );
    const dragEraser = screen.getByRole("button", {
      name: "橡皮擦 · 滑动擦除",
    });
    expect(dragEraser.textContent).not.toMatch(/单击|滑动/u);
    expect(within(dragEraser).getByTestId("eraser-base-icon")).toBeDefined();
    expect(within(dragEraser).getByTestId("eraser-drag-trail")).toBeDefined();
    await user.hover(dragEraser);
    expect((await screen.findByRole("tooltip")).textContent).toContain(
      "滑动擦除",
    );
  });

  it("所有快捷子选项共用桌面单行排版契约", () => {
    const css = readFileSync(
      resolve(
        process.cwd(),
        "apps/web/src/components/CanvasToolRail.module.css",
      ),
      "utf8",
    );
    const buttonRule = css.match(/\.quickChoices button \{([\s\S]*?)\}/u)?.[1];
    expect(buttonRule).toContain("font-size: 12px");
    expect(buttonRule).toContain("white-space: nowrap");
    expect(buttonRule).toContain("overflow: hidden");
  });

  it("按操作与放置分组，并用分隔线隔开", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <Tooltip.Provider delayDuration={0}>
          <CanvasToolRail
            tool="select"
            catalogCollapsed={false}
            overlayType="marker"
            eraserMode="click"
            activeElementId={null}
            objectPresets={OBJECT_PRESETS}
            onTool={vi.fn()}
            onOverlayType={vi.fn()}
            onEraserMode={vi.fn()}
            onObjectSelect={vi.fn()}
            onContext={vi.fn()}
          />
        </Tooltip.Provider>
      </I18nextProvider>,
    );

    const toolbar = screen.getByTestId("canvas-tool-rail");
    const operation = toolbar.querySelector('[data-tool-group="operation"]');
    const placement = toolbar.querySelector('[data-tool-group="placement"]');
    expect(operation).not.toBeNull();
    expect(placement).not.toBeNull();
    expect(
      within(operation as HTMLElement)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["选择", "平移", "橡皮擦 · 单击擦除", "框选"]);
    expect(
      within(placement as HTMLElement)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["画刷", "边", "物体", "标记", "连线与箭头"]);
    expect(toolbar.querySelector('[role="separator"]')).not.toBeNull();
  });

  it("物体入口动态显示预设、禁用原因和当前形状", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
    const user = userEvent.setup();
    const onObjectSelect = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <Tooltip.Provider delayDuration={0}>
          <CanvasToolRail
            tool="object"
            catalogCollapsed={false}
            overlayType="marker"
            eraserMode="click"
            activeElementId="example.weather:object.circle"
            objectPresets={OBJECT_PRESETS}
            onTool={vi.fn()}
            onOverlayType={vi.fn()}
            onEraserMode={vi.fn()}
            onObjectSelect={onObjectSelect}
            onContext={vi.fn()}
          />
        </Tooltip.Provider>
      </I18nextProvider>,
    );

    const objectButton = screen.getByRole("button", {
      name: "物体 · 气象圆阵",
    });
    expect(objectButton.querySelector("circle")).not.toBeNull();
    await user.click(objectButton);
    const dialog = screen.getByRole("dialog", { name: "选择物体" });
    const enabled = within(dialog).getByRole("radio", { name: "气象圆阵" });
    const disabled = within(dialog).getByRole("radio", {
      name: /七格气象站：当前网格不支持此元素/u,
    });
    expect(enabled.getAttribute("aria-checked")).toBe("true");
    expect((disabled as HTMLButtonElement).disabled).toBe(true);
    expect(disabled.getAttribute("data-disabled-reason")).toBe(
      "grid-unsupported",
    );
    await user.click(enabled);
    expect(onObjectSelect).toHaveBeenCalledWith(
      "example.weather:object.circle",
    );
    expect(screen.queryByRole("dialog", { name: "选择物体" })).toBeNull();
    expect(document.activeElement).toBe(objectButton);
  });
});

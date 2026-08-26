import * as Tooltip from "@radix-ui/react-tooltip";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n.js";
import { CanvasToolRail } from "./CanvasToolRail.js";

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
            onTool={vi.fn()}
            onOverlayType={onOverlayType}
            onEraserMode={vi.fn()}
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
    render(
      <I18nextProvider i18n={i18n}>
        <Tooltip.Provider delayDuration={0}>
          <CanvasToolRail
            tool="select"
            catalogCollapsed={false}
            overlayType="marker"
            eraserMode="click"
            onTool={onTool}
            onOverlayType={vi.fn()}
            onEraserMode={onEraserMode}
            onContext={vi.fn()}
          />
        </Tooltip.Provider>
      </I18nextProvider>,
    );

    await user.click(screen.getByRole("button", { name: "橡皮擦" }));
    expect(screen.getByRole("dialog", { name: "选择擦除方式" })).toBeDefined();
    await user.click(screen.getByRole("radio", { name: "滑动擦除" }));
    expect(onEraserMode).toHaveBeenCalledWith("drag");
  });
});

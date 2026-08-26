import * as Tooltip from "@radix-ui/react-tooltip";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n.js";
import { CanvasToolRail } from "./CanvasToolRail.js";

describe("CanvasToolRail", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("在标记入口右侧独立选择标记或文字，并支持可选附文契约", async () => {
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
    const onMarkerLabel = vi.fn();
    function Harness() {
      const [label, setLabel] = useState("港口");
      return (
        <CanvasToolRail
          tool="marker"
          catalogCollapsed={false}
          overlayType="marker"
          markerLabel={label}
          onTool={vi.fn()}
          onOverlayType={onOverlayType}
          onMarkerLabel={(value) => {
            setLabel(value);
            onMarkerLabel(value);
          }}
          onContext={vi.fn()}
        />
      );
    }
    render(
      <I18nextProvider i18n={i18n}>
        <Tooltip.Provider delayDuration={0}>
          <Harness />
        </Tooltip.Provider>
      </I18nextProvider>,
    );

    await user.click(screen.getByRole("button", { name: "标记" }));
    const dialog = screen.getByRole("dialog", { name: "选择放置类型" });
    expect(dialog.getAttribute("data-popover-side")).toBe("right");
    expect(
      screen.getByRole("radio", { name: "标记" }).getAttribute("aria-checked"),
    ).toBe("true");
    await user.clear(screen.getByLabelText("标记附文"));
    await user.type(screen.getByLabelText("标记附文"), "城邦");
    expect(onMarkerLabel).toHaveBeenLastCalledWith("城邦");
    await user.click(screen.getByRole("radio", { name: "文字" }));
    expect(onOverlayType).toHaveBeenCalledWith("text");
    expect(screen.queryByRole("dialog", { name: "选择放置类型" })).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "标记" }),
    );
  });

  it("提供独立橡皮擦按钮并切换到 eraser 工具", async () => {
    const user = userEvent.setup();
    const onTool = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <Tooltip.Provider delayDuration={0}>
          <CanvasToolRail
            tool="select"
            catalogCollapsed={false}
            overlayType="marker"
            onTool={onTool}
            onOverlayType={vi.fn()}
            onContext={vi.fn()}
          />
        </Tooltip.Provider>
      </I18nextProvider>,
    );

    await user.click(screen.getByRole("button", { name: "橡皮擦" }));
    expect(onTool).toHaveBeenCalledWith("eraser");
  });
});

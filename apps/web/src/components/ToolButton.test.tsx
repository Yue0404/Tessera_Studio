import * as Tooltip from "@radix-ui/react-tooltip";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolButton } from "./ToolButton.js";

describe("ToolButton", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("只使用左侧 Radix 提示，不再叠加浏览器原生 title", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
    const user = userEvent.setup();
    render(
      <Tooltip.Provider delayDuration={0}>
        <ToolButton label="选择工具" onClick={vi.fn()}>
          S
        </ToolButton>
      </Tooltip.Provider>,
    );

    const button = screen.getByRole("button", { name: "选择工具" });
    expect(button.getAttribute("title")).toBeNull();
    await user.hover(button);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.getAttribute("data-side")).toBe("left");
  });
});

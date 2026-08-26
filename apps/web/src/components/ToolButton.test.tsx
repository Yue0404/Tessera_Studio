import * as Tooltip from "@radix-ui/react-tooltip";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolButton } from "./ToolButton.js";

const toolButtonCss = readFileSync(
  resolve(process.cwd(), "apps/web/src/components/ToolButton.module.css"),
  "utf8",
);

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
    expect(toolButtonCss).toMatch(
      /\.tooltip\s*\{[^}]*pointer-events:\s*none;/u,
    );
    expect(toolButtonCss).toMatch(
      /:global\(\[data-radix-popper-content-wrapper\]\):has\(> \.tooltip\)\s*\{[^}]*pointer-events:\s*none;/u,
    );
  });

  it("横向工具组可把提示改到下方并显示展开角标", async () => {
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
        <ToolButton
          label="清空画布"
          tooltipSide="bottom"
          expandable
          onClick={vi.fn()}
        >
          C
        </ToolButton>
      </Tooltip.Provider>,
    );
    const button = screen.getByRole("button", { name: "清空画布" });
    await user.hover(button);
    expect((await screen.findByRole("tooltip")).getAttribute("data-side")).toBe(
      "bottom",
    );
    expect(button.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});

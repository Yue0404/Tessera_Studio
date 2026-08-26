import { fireEvent, render, screen } from "@testing-library/react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import i18n from "../i18n.js";
import { AppCommandBar } from "./AppCommandBar.js";

describe("AppCommandBar", () => {
  it("按可清内容状态禁用，并只在二次确认后清空", () => {
    const onClear = vi.fn();
    const common = {
      projectName: "测试工程",
      saveStatusKey: "status.saved",
      canUndo: false,
      canRedo: false,
      onNew: vi.fn(),
      onOpen: vi.fn(),
      onImportFragment: vi.fn(),
      onSave: vi.fn(),
      onExport: vi.fn(),
      onPackageSettings: vi.fn(),
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      onClear,
    };
    const view = render(
      <I18nextProvider i18n={i18n}>
        <Tooltip.Provider>
          <AppCommandBar {...common} canClear={false} />
        </Tooltip.Provider>
      </I18nextProvider>,
    );
    expect(
      (screen.getByRole("button", { name: "清空画布" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    view.rerender(
      <I18nextProvider i18n={i18n}>
        <Tooltip.Provider>
          <AppCommandBar {...common} canClear />
        </Tooltip.Provider>
      </I18nextProvider>,
    );
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "清空画布" }));
    expect(confirm).toHaveBeenCalledWith(
      "确定清空所有可编辑内容吗？此操作可以撤销。",
    );
    expect(onClear).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "清空画布" }));
    expect(onClear).toHaveBeenCalledOnce();
    confirm.mockRestore();
  });
});

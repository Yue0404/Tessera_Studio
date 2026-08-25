import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import i18n from "../i18n.js";
import { MapSettingsForm } from "./MapSettingsForm.js";

describe("MapSettingsForm", () => {
  it("以受控输入提交合法尺寸，并拒绝范围外值", () => {
    const onSubmit = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <MapSettingsForm
          value={{ type: "square", width: 10, height: 12, cellSize: 32 }}
          onSubmit={onSubmit}
        />
      </I18nextProvider>,
    );

    fireEvent.change(screen.getByLabelText("宽度"), {
      target: { value: "40001" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用地图设置" }));
    expect(screen.getByRole("alert").textContent).toContain("1–40000");
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("宽度"), {
      target: { value: "20" },
    });
    fireEvent.change(screen.getByLabelText("高度"), {
      target: { value: "24" },
    });
    fireEvent.change(screen.getByLabelText("单元格尺寸"), {
      target: { value: "48" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用地图设置" }));
    expect(onSubmit).toHaveBeenCalledWith({
      type: "square",
      width: 20,
      height: 24,
      cellSize: 48,
    });
  });

  it("把底层越界拒绝显示为非破坏性错误", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <MapSettingsForm
          value={{ type: "hex-pointy", width: 10, height: 12, cellSize: 32 }}
          onSubmit={() => {
            throw new Error("grid-resize-content-out-of-bounds");
          }}
        />
      </I18nextProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "应用地图设置" }));
    expect(screen.getByRole("alert").textContent).toContain("设置未应用");
  });
});

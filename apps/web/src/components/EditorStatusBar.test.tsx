import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import { createProject } from "@tessera/core";
import i18n from "../i18n.js";
import { EditorStatusBar } from "./EditorStatusBar.js";

const state = createProject({
  name: "缩放输入",
  grid: { type: "square", width: 4, height: 4, cellSize: 32 },
  style: {
    canvasBackground: "#000000FF",
    defaultCellColor: "#111111FF",
    gridColor: "#222222FF",
    gridOpacity: 1,
    gridWidth: 1,
    defaultEdgeColor: "#222222FF",
  },
});

function statusBar(zoom: number, onZoomChange = vi.fn()) {
  return {
    onZoomChange,
    view: (
      <I18nextProvider i18n={i18n}>
        <EditorStatusBar
          state={state}
          zoom={zoom}
          saveStatusKey="status.saved"
          pointerStatus={null}
          onZoomOut={vi.fn()}
          onZoomIn={vi.fn()}
          onZoomChange={onZoomChange}
          onResetZoom={vi.fn()}
          onCenterMap={vi.fn()}
          onFitMap={vi.fn()}
          onFitContent={vi.fn()}
        />
      </I18nextProvider>
    ),
  };
}

describe("EditorStatusBar 缩放输入", () => {
  it("Enter 与失焦提交并把越界值夹到 25%–400%", () => {
    const first = statusBar(1);
    const rendered = render(first.view);
    const input = screen.getByRole("spinbutton", { name: "缩放百分比" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "450" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(first.onZoomChange).toHaveBeenCalledOnce();
    expect(first.onZoomChange).toHaveBeenCalledWith(4);

    const second = statusBar(4, first.onZoomChange);
    rendered.rerender(second.view);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.blur(input);
    expect(first.onZoomChange).toHaveBeenLastCalledWith(0.25);
  });

  it("Escape 撤销编辑中间态，空值失焦不破坏当前缩放", () => {
    const current = statusBar(1);
    render(current.view);
    const input = screen.getByRole("spinbutton", { name: "缩放百分比" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "250" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect((input as HTMLInputElement).value).toBe("100");
    expect(current.onZoomChange).not.toHaveBeenCalled();

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect((input as HTMLInputElement).value).toBe("100");
    expect(current.onZoomChange).not.toHaveBeenCalled();
  });
});

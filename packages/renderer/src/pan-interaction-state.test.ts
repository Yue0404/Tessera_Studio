import { describe, expect, it } from "vitest";
import {
  isEditableShortcutTarget,
  PanInteractionState,
} from "./pan-interaction-state.js";

describe("PanInteractionState", () => {
  it("平移工具、临时空格和中键均产生增量且不依赖工具切换", () => {
    const cases = [
      { tool: "pan" as const, button: 0, spacePressed: false, buttons: 1 },
      { tool: "brush" as const, button: 0, spacePressed: true, buttons: 1 },
      { tool: "marker" as const, button: 1, spacePressed: false, buttons: 4 },
    ];
    for (const value of cases) {
      const state = new PanInteractionState();
      expect(
        state.begin({
          pointerId: 7,
          screenPoint: { x: 10, y: 20 },
          ...value,
        }),
      ).toBe(true);
      expect(state.move(7, value.buttons, { x: 13, y: 18 })).toEqual({
        x: 3,
        y: -2,
      });
      expect(state.end(7)).toBe(true);
      expect(state.move(7, value.buttons, { x: 20, y: 20 })).toBeNull();
    }
  });

  it("keyup 仅终止临时空格手势，pointercancel 可恢复全部路径", () => {
    const state = new PanInteractionState();
    state.begin({
      pointerId: 1,
      button: 0,
      screenPoint: { x: 0, y: 0 },
      tool: "brush",
      spacePressed: true,
    });
    expect(state.releaseSpace()).toBe(true);
    expect(state.move(1, 1, { x: 4, y: 4 })).toBeNull();

    state.begin({
      pointerId: 2,
      button: 1,
      screenPoint: { x: 0, y: 0 },
      tool: "brush",
      spacePressed: false,
    });
    expect(state.releaseSpace()).toBe(false);
    expect(state.cancel()).toBe(true);
    expect(state.move(2, 4, { x: 4, y: 4 })).toBeNull();
  });

  it("输入框、文本区和 contenteditable 属于快捷键隔离目标", () => {
    expect(isEditableShortcutTarget(document.createElement("input"))).toBe(
      true,
    );
    expect(isEditableShortcutTarget(document.createElement("textarea"))).toBe(
      true,
    );
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    Object.defineProperty(editable, "isContentEditable", { value: true });
    expect(isEditableShortcutTarget(editable)).toBe(true);
    expect(isEditableShortcutTarget(document.createElement("button"))).toBe(
      false,
    );
  });

  it("下拉框、contenteditable 后代和对话框内控件隔离画布快捷键", () => {
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const child = document.createElement("span");
    editable.append(child);
    const dialog = document.createElement("section");
    dialog.setAttribute("role", "dialog");
    const button = document.createElement("button");
    dialog.append(button);
    expect(isEditableShortcutTarget(document.createElement("select"))).toBe(
      true,
    );
    expect(isEditableShortcutTarget(child)).toBe(true);
    expect(isEditableShortcutTarget(button)).toBe(true);
  });
});

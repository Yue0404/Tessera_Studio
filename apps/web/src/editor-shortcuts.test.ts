import { describe, expect, it, vi } from "vitest";
import {
  blocksEditorShortcut,
  dispatchEditorShortcut,
  type EditorShortcutActions,
} from "./editor-shortcuts.js";

function actions(): EditorShortcutActions {
  return {
    select: vi.fn(),
    pan: vi.fn(),
    brush: vi.fn(),
    fill: vi.fn(),
    erase: vi.fn(),
    text: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    save: vi.fn(),
    deleteSelection: vi.fn(),
    cancel: vi.fn(),
  };
}

describe("编辑器快捷键", () => {
  it.each([
    ["v", "select"],
    ["h", "pan"],
    ["b", "brush"],
    ["g", "fill"],
    ["e", "erase"],
    ["t", "text"],
    ["Delete", "deleteSelection"],
    ["Backspace", "deleteSelection"],
    ["Escape", "cancel"],
  ] as const)("%s 调用 %s", (key, action) => {
    const value = actions();
    const event = new KeyboardEvent("keydown", { key, cancelable: true });
    expect(dispatchEditorShortcut(event, value)).toBe(true);
    expect(value[action]).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it("覆盖保存、撤销与两种重做组合且重复事件不执行", () => {
    const value = actions();
    dispatchEditorShortcut(
      new KeyboardEvent("keydown", { key: "s", ctrlKey: true }),
      value,
    );
    dispatchEditorShortcut(
      new KeyboardEvent("keydown", { key: "z", metaKey: true }),
      value,
    );
    dispatchEditorShortcut(
      new KeyboardEvent("keydown", { key: "z", ctrlKey: true, shiftKey: true }),
      value,
    );
    dispatchEditorShortcut(
      new KeyboardEvent("keydown", { key: "y", ctrlKey: true }),
      value,
    );
    dispatchEditorShortcut(
      new KeyboardEvent("keydown", { key: "v", repeat: true }),
      value,
    );
    expect(value.save).toHaveBeenCalledOnce();
    expect(value.undo).toHaveBeenCalledOnce();
    expect(value.redo).toHaveBeenCalledTimes(2);
    expect(value.select).not.toHaveBeenCalled();
  });

  it("输入控件、contenteditable 与对话框阻止编辑器快捷键", () => {
    const input = document.createElement("input");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const dialog = document.createElement("section");
    dialog.setAttribute("role", "dialog");
    const button = document.createElement("button");
    dialog.append(button);
    expect(blocksEditorShortcut(input)).toBe(true);
    expect(blocksEditorShortcut(editable)).toBe(true);
    expect(blocksEditorShortcut(button)).toBe(true);
    expect(blocksEditorShortcut(document.body)).toBe(false);
  });
});

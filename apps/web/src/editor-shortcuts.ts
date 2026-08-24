export interface EditorShortcutActions {
  select(): void;
  pan(): void;
  brush(): void;
  fill(): void;
  erase(): void;
  text(): void;
  undo(): void;
  redo(): void;
  save(): void;
  deleteSelection(): void;
  cancel(): void;
}

export function blocksEditorShortcut(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('[role="dialog"]') !== null) return true;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable) ||
    target.closest('[contenteditable="true"]') !== null
  );
}

/** 返回 true 表示已消费快捷键；重复 keydown 不制造重复历史或保存。 */
export function dispatchEditorShortcut(
  event: KeyboardEvent,
  actions: EditorShortcutActions,
): boolean {
  if (blocksEditorShortcut(event.target) || event.repeat) return false;
  const command = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (command && key === "z") {
    if (event.shiftKey) actions.redo();
    else actions.undo();
  } else if (command && key === "y") actions.redo();
  else if (command && key === "s") actions.save();
  else if (!command && key === "v") actions.select();
  else if (!command && key === "h") actions.pan();
  else if (!command && key === "b") actions.brush();
  else if (!command && key === "g") actions.fill();
  else if (!command && key === "e") actions.erase();
  else if (!command && key === "t") actions.text();
  else if (!command && (event.key === "Delete" || event.key === "Backspace"))
    actions.deleteSelection();
  else if (!command && event.key === "Escape") actions.cancel();
  else return false;
  event.preventDefault();
  return true;
}

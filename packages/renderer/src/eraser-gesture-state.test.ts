import { describe, expect, it, vi } from "vitest";
import { EraserGestureState } from "./eraser-gesture-state.js";

describe("渲染器滑动橡皮批次", () => {
  it("整段按下到抬起只开启并提交一次批次", () => {
    const gesture = new EraserGestureState();
    const begin = vi.fn();
    const commit = vi.fn();
    gesture.begin("drag", begin);
    gesture.begin("drag", begin);
    expect(gesture.active).toBe(true);
    gesture.finish(commit);
    gesture.finish(commit);
    expect(begin).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledOnce();
  });

  it("单击不创建批次，取消滑动只回滚一次", () => {
    const gesture = new EraserGestureState();
    const begin = vi.fn();
    const cancel = vi.fn();
    gesture.begin("click", begin);
    expect(gesture.active).toBe(false);
    gesture.begin("drag", begin);
    gesture.cancel(cancel);
    gesture.cancel(cancel);
    expect(begin).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
  });
});

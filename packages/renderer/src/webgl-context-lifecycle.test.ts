import { describe, expect, it, vi } from "vitest";
import { WebGlContextLifecycle } from "./webgl-context-lifecycle.js";

describe("WebGlContextLifecycle", () => {
  it("丢失时阻止默认销毁，恢复只执行一次", () => {
    const target = new EventTarget();
    const onLost = vi.fn();
    const onRestored = vi.fn();
    const lifecycle = new WebGlContextLifecycle(target, {
      onLost,
      onRestored,
    });
    const lost = new Event("webglcontextlost", { cancelable: true });

    target.dispatchEvent(lost);
    target.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(lost.defaultPrevented).toBe(true);
    expect(lifecycle.status).toBe("lost");
    expect(onLost).toHaveBeenCalledOnce();

    target.dispatchEvent(new Event("webglcontextrestored"));
    target.dispatchEvent(new Event("webglcontextrestored"));
    expect(lifecycle.status).toBe("available");
    expect(onRestored).toHaveBeenCalledOnce();
  });

  it("destroy 后移除两个监听器", () => {
    const target = new EventTarget();
    const onLost = vi.fn();
    const onRestored = vi.fn();
    const lifecycle = new WebGlContextLifecycle(target, {
      onLost,
      onRestored,
    });

    lifecycle.destroy();
    lifecycle.destroy();
    target.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    target.dispatchEvent(new Event("webglcontextrestored"));
    expect(onLost).not.toHaveBeenCalled();
    expect(onRestored).not.toHaveBeenCalled();
  });
});

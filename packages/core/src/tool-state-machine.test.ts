import { describe, expect, it } from "vitest";
import {
  InvalidToolTransitionError,
  ToolStateMachine,
} from "./tool-state-machine.js";

describe("工具状态机", () => {
  it.each([
    ["select", "ready"],
    ["pan", "ready"],
    ["brush", "ready"],
    ["edge", "ready"],
    ["marker", "ready"],
    ["eraser", "ready"],
    ["connection", "choosing-start"],
    ["box-select", "ready"],
  ] as const)("选择 %s 后进入 %s", (tool, phase) => {
    const machine = new ToolStateMachine();
    machine.selectTool(tool);
    expect(machine.state.phase).toBe(phase);
  });

  it("橡皮点击不创建拖拽态，由领域删除事务处理", () => {
    const machine = new ToolStateMachine();
    machine.selectTool("eraser");
    expect(machine.pointerDown({ x: 1, y: 1 }, null)).toBe(false);
    expect(machine.state).toMatchObject({ tool: "eraser", phase: "ready" });
  });

  it("连线按 choosing-start → previewing-end → committing → choosing-start 转换", () => {
    const machine = new ToolStateMachine();
    machine.selectTool("connection");
    machine.pointerDown({ x: 1, y: 1 }, "cell:square:0:0");
    expect(machine.state.phase).toBe("previewing-end");
    machine.pointerMove({ x: 5, y: 5 });
    machine.pointerDown({ x: 5, y: 5 }, "cell:square:0:1");
    expect(machine.state.phase).toBe("committing");
    machine.commitSucceeded();
    expect(machine.state.phase).toBe("choosing-start");
  });

  it("提交失败保留预览，取消清空临时状态", () => {
    const machine = new ToolStateMachine();
    machine.selectTool("connection");
    machine.pointerDown({ x: 1, y: 1 }, "cell:square:0:0");
    machine.pointerDown({ x: 5, y: 5 }, "cell:square:0:1");
    machine.commitFailed();
    expect(machine.state).toMatchObject({
      phase: "previewing-end",
      startCellId: "cell:square:0:0",
    });
    machine.cancel();
    expect(machine.state).toMatchObject({
      phase: "idle",
      startCellId: null,
      startPoint: null,
    });
  });

  it("非法自连接被拒绝且不进入 committing", () => {
    const machine = new ToolStateMachine();
    machine.selectTool("connection");
    machine.pointerDown({ x: 1, y: 1 }, "cell:square:0:0");
    expect(() =>
      machine.pointerDown({ x: 1, y: 1 }, "cell:square:0:0"),
    ).toThrow(InvalidToolTransitionError);
    expect(machine.state.phase).toBe("previewing-end");
  });

  it("切换工具取消未完成连线", () => {
    const machine = new ToolStateMachine();
    machine.selectTool("connection");
    machine.pointerDown({ x: 1, y: 1 }, "cell:square:0:0");
    machine.selectTool("brush");
    expect(machine.state).toMatchObject({
      tool: "brush",
      phase: "ready",
      startCellId: null,
    });
  });

  it("仅在临时工具状态实际变化时报告变更", () => {
    const machine = new ToolStateMachine();

    expect(machine.pointerMove({ x: 1, y: 1 })).toBe(false);
    expect(machine.pointerDown({ x: 1, y: 1 }, "cell:square:0:0")).toBe(false);
    expect(machine.pointerUp({ x: 1, y: 1 })).toBe(false);

    machine.selectTool("box-select");
    expect(machine.pointerDown({ x: 1, y: 1 }, null)).toBe(true);
    expect(machine.pointerMove({ x: 1, y: 1 })).toBe(false);
    expect(machine.pointerMove({ x: 2, y: 3 })).toBe(true);
    expect(machine.pointerUp({ x: 2, y: 3 })).toBe(true);
    expect(machine.pointerUp({ x: 2, y: 3 })).toBe(false);
  });
});

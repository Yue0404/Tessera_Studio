import { createProject, EditorStore } from "@tessera/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pixiMock = vi.hoisted(() => {
  const instances: {
    calls: (readonly unknown[])[];
  }[] = [];
  class Graphics {
    readonly calls: (readonly unknown[])[] = [];

    constructor() {
      instances.push(this);
    }

    clear() {
      this.calls.length = 0;
      return this;
    }

    moveTo(x: number, y: number) {
      this.calls.push(["moveTo", x, y]);
      return this;
    }

    lineTo(x: number, y: number) {
      this.calls.push(["lineTo", x, y]);
      return this;
    }

    stroke() {
      return this;
    }

    poly() {
      return this;
    }

    roundRect(x: number, y: number, width: number, height: number) {
      this.calls.push(["roundRect", x, y, width, height]);
      return this;
    }

    fill() {
      return this;
    }

    destroy() {
      return undefined;
    }
  }
  class Container {
    readonly children: any[] = [];
    readonly position = {
      x: 0,
      y: 0,
      set: (x: number, y: number) => {
        this.position.x = x;
        this.position.y = y;
      },
    };
    rotation = 0;

    addChild(...children: any[]) {
      this.children.push(...children);
      return children[0];
    }

    removeChildren() {
      return this.children.splice(0);
    }

    destroy() {
      return undefined;
    }
  }
  class Text {
    readonly anchor = { set: vi.fn() };
    alpha = 1;

    constructor(readonly options: unknown) {}
  }
  return { Container, Graphics, Text, instances };
});

vi.mock("pixi.js", () => ({
  Graphics: pixiMock.Graphics,
  Container: pixiMock.Container,
  Text: pixiMock.Text,
}));

import { ConnectionRenderer } from "./connection-renderer.js";

function stateWithLine(startX: number, endX: number, label?: string) {
  const store = new EditorStore(
    createProject({
      name: "裁切",
      grid: { type: "square", width: 10, height: 10, cellSize: 32 },
      style: {
        canvasBackground: "#09141DFF",
        defaultCellColor: "#14232DFF",
        gridColor: "#59656AFF",
        gridOpacity: 0.7,
        gridWidth: 1,
        defaultEdgeColor: "#59656AFF",
      },
    }),
  );
  store.createConnection(
    { kind: "map-point", point: { x: startX, y: 50 } },
    { kind: "map-point", point: { x: endX, y: 50 } },
    { kind: "line", ...(label === undefined ? {} : { label }) },
  );
  return store.state;
}

function stateWithArrow(startX: number, endX: number, strokeWidth: number) {
  const store = new EditorStore(stateWithLine(startX, endX));
  const connectionId = store.createConnection(
    { kind: "map-point", point: { x: startX, y: 70 } },
    { kind: "map-point", point: { x: endX, y: 70 } },
    { kind: "arrow", arrowMode: "end" },
  );
  const connection = store.state.connections.get(connectionId);
  if (connection === undefined) throw new Error("test-connection-missing");
  store.updateConnection(connectionId, {
    ...connection,
    style: { ...connection.style, strokeWidth },
  });
  return store.state;
}

describe("ConnectionRenderer 视口集成裁切", () => {
  beforeEach(() => pixiMock.instances.splice(0));

  it("端点均在外但穿越视口时绘制完整可见段", () => {
    const container = { addChild: vi.fn() } as any;
    const renderer = new ConnectionRenderer(container);
    renderer.render(stateWithLine(-50, 150), {
      minX: 0,
      minY: 0,
      maxX: 100,
      maxY: 100,
    });
    expect(pixiMock.instances[0]?.calls).toEqual([
      ["moveTo", 0, 50],
      ["lineTo", 100, 50],
    ]);
  });

  it("单端在外时只裁切视口外端点", () => {
    const container = { addChild: vi.fn() } as any;
    const renderer = new ConnectionRenderer(container);
    renderer.render(stateWithLine(-50, 50), {
      minX: 0,
      minY: 0,
      maxX: 100,
      maxY: 100,
    });
    expect(pixiMock.instances[0]?.calls).toEqual([
      ["moveTo", 0, 50],
      ["lineTo", 50, 50],
    ]);
  });

  it("短标签位于线体之后的上层容器并带背景", () => {
    const parent = { addChild: vi.fn() } as any;
    const renderer = new ConnectionRenderer(parent);
    renderer.render(stateWithLine(20, 80, "道路"), {
      minX: 0,
      minY: 0,
      maxX: 100,
      maxY: 100,
    });
    const layer = parent.addChild.mock.calls[0]?.[0] as
      InstanceType<typeof pixiMock.Container> | undefined;
    const item = layer?.children[0] as
      InstanceType<typeof pixiMock.Container> | undefined;
    const label = item?.children[1] as
      InstanceType<typeof pixiMock.Container> | undefined;
    expect(item?.children[0]).toBeInstanceOf(pixiMock.Graphics);
    expect(label?.position).toMatchObject({ x: 50, y: 42.96 });
    expect(label?.children[0]).toBeInstanceOf(pixiMock.Graphics);
    expect(
      (label?.children[0] as InstanceType<typeof pixiMock.Graphics>)
        .calls[0]?.[0],
    ).toBe("roundRect");
  });

  it.each([3, 12])(
    "箭杆在线宽 %d 时都精确结束于三角箭头底边",
    (strokeWidth) => {
      const container = { addChild: vi.fn() } as any;
      const renderer = new ConnectionRenderer(container);
      renderer.render(stateWithArrow(20, 80, strokeWidth), {
        minX: 0,
        minY: 0,
        maxX: 100,
        maxY: 100,
      });
      const arrowGraphics = pixiMock.instances.find((instance) =>
        instance.calls.some((call) => call[2] === 70),
      );
      expect(arrowGraphics?.calls[0]).toEqual(["moveTo", 20, 70]);
      expect(arrowGraphics?.calls[1]?.[0]).toBe("lineTo");
      expect(arrowGraphics?.calls[1]?.[1]).toBe(
        80 - Math.max(strokeWidth * 3, 32 * 0.18),
      );
    },
  );
});

import { createProject, EditorStore } from "@tessera/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pixiMock = vi.hoisted(() => {
  const instances: {
    calls: (readonly [string, number, number])[];
  }[] = [];
  class Graphics {
    readonly calls: (readonly [string, number, number])[] = [];

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

    fill() {
      return this;
    }

    destroy() {
      return undefined;
    }
  }
  class Container {
    readonly children: any[] = [];

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
  return { Container, Graphics, instances };
});

vi.mock("pixi.js", () => ({
  Graphics: pixiMock.Graphics,
  Container: pixiMock.Container,
  Text: vi.fn(),
}));

import { ConnectionRenderer } from "./connection-renderer.js";

function stateWithLine(startX: number, endX: number) {
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
    "line",
  );
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
});

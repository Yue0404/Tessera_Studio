import {
  cellCenter,
  cellId,
  cellPolygon,
  createProject,
  type ProjectState,
  type VisibleCell,
} from "@tessera/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pixiMock = vi.hoisted(() => {
  class PointValue {
    x = 0;
    y = 0;

    set(x: number, y = x) {
      this.x = x;
      this.y = y;
    }
  }

  class Container {
    static readonly instances: Container[] = [];
    readonly children: Container[] = [];
    readonly position = new PointValue();
    parent: Container | null = null;
    label = "";
    zIndex = 0;
    destroyCount = 0;

    constructor() {
      Container.instances.push(this);
    }

    addChild(...children: Container[]) {
      for (const child of children) {
        child.removeFromParent();
        child.parent = this;
        this.children.push(child);
      }
      return children[0];
    }

    removeChild(child: Container) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      child.parent = null;
      return child;
    }

    removeChildren() {
      const removed = this.children.splice(0);
      for (const child of removed) child.parent = null;
      return removed;
    }

    removeFromParent() {
      this.parent?.removeChild(this);
    }

    destroy(options?: { readonly children?: boolean }) {
      this.destroyCount += 1;
      this.removeFromParent();
      if (options?.children === true) {
        for (const child of this.removeChildren()) child.destroy(options);
      }
    }
  }

  type GraphicsCall =
    | readonly ["moveTo" | "lineTo", number, number]
    | readonly ["poly", readonly number[]]
    | readonly ["fill" | "stroke", unknown];

  class Graphics extends Container {
    calls: GraphicsCall[] = [];

    clear() {
      this.calls = [];
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

    poly(points: readonly number[]) {
      this.calls.push(["poly", [...points]]);
      return this;
    }

    fill(options: unknown) {
      this.calls.push(["fill", options]);
      return this;
    }

    stroke(options: unknown) {
      this.calls.push(["stroke", options]);
      return this;
    }

    circle() {
      return this;
    }
  }

  class FillPattern {
    readonly testDouble = true;
  }
  class Matrix {
    readonly testDouble = true;
  }
  class Sprite extends Container {}
  class Text extends Container {}

  return { Container, FillPattern, Graphics, Matrix, Sprite, Text };
});

vi.mock("pixi.js", () => pixiMock);

import { GridRenderer } from "./grid-renderer.js";

function project(): ProjectState {
  return createProject({
    name: "网格批次",
    grid: { type: "square", width: 192, height: 1, cellSize: 36 },
    style: {
      canvasBackground: "#09141DFF",
      defaultCellColor: "#14232DFF",
      gridColor: "#59656AFF",
      gridOpacity: 0.7,
      gridWidth: 1,
      defaultEdgeColor: "#59656AFF",
    },
  });
}

function visibleCell(
  state: Readonly<ProjectState>,
  column: number,
): VisibleCell {
  return {
    row: 0,
    column,
    cellId: cellId(state.grid.type, 0, column),
    center: cellCenter(state.grid, 0, column),
    polygon: cellPolygon(state.grid, 0, column),
  };
}

function gridLayer(root: InstanceType<typeof pixiMock.Container>) {
  const layer = root.children.find(
    (child) => child.label === "tessera-layer:tessera.system.grid",
  );
  if (layer === undefined) throw new Error("grid-test-layer-missing");
  return layer;
}

function gridPlan(root: InstanceType<typeof pixiMock.Container>) {
  return gridLayer(root).children.map((child) => [
    ...(child as InstanceType<typeof pixiMock.Graphics>).calls,
  ]);
}

describe("GridRenderer 分块稳定性", () => {
  beforeEach(() => {
    pixiMock.Container.instances.length = 0;
  });

  it("64 列分块边界的共享网格边只由 canonical owner 绘制一次", () => {
    const state = project();
    state.cells.touchRuntimeChunk(0, 0);
    state.cells.touchRuntimeChunk(0, 1);
    const root = new pixiMock.Container();
    const renderer = new GridRenderer(root as never);

    renderer.render(state, [visibleCell(state, 0), visibleCell(state, 64)]);

    const boundaryX = 64 * state.grid.cellSize;
    const segments = gridPlan(root).flatMap((calls) =>
      calls.flatMap((call, index) => {
        const next = calls[index + 1];
        return call[0] === "moveTo" &&
          next?.[0] === "lineTo" &&
          call[1] === boundaryX &&
          next[1] === boundaryX
          ? [[call[2], next[2]]]
          : [];
      }),
    );
    expect(segments).toEqual([[0, state.grid.cellSize]]);
  });

  it("淘汰后按反向输入重建仍产生相同绘制计划且无孤儿子对象", () => {
    const state = project();
    const root = new pixiMock.Container();
    const renderer = new GridRenderer(root as never);
    state.cells.touchRuntimeChunk(0, 0);
    state.cells.touchRuntimeChunk(0, 1);

    renderer.render(state, [visibleCell(state, 0), visibleCell(state, 64)]);
    const before = gridPlan(root);
    expect(root.children.map((layer) => layer.children.length)).toEqual([
      renderer.stats.batchCount,
      renderer.stats.batchCount,
      renderer.stats.batchCount,
    ]);

    state.cells.evictRuntimeChunks(0);
    state.cells.touchRuntimeChunk(0, 2);
    renderer.render(state, [visibleCell(state, 128)]);
    expect(root.children.map((layer) => layer.children.length)).toEqual([
      renderer.stats.batchCount,
      renderer.stats.batchCount,
      renderer.stats.batchCount,
    ]);

    state.cells.evictRuntimeChunks(0);
    state.cells.touchRuntimeChunk(0, 1);
    state.cells.touchRuntimeChunk(0, 0);
    renderer.render(state, [visibleCell(state, 64), visibleCell(state, 0)]);

    expect(gridPlan(root)).toEqual(before);
    expect(root.children.map((layer) => layer.children.length)).toEqual([
      renderer.stats.batchCount,
      renderer.stats.batchCount,
      renderer.stats.batchCount,
    ]);
    const destroyed = pixiMock.Container.instances.filter(
      (instance) => instance.destroyCount > 0,
    );
    expect(destroyed.length).toBeGreaterThan(0);
    expect(destroyed.every((instance) => instance.destroyCount === 1)).toBe(
      true,
    );
  });
});

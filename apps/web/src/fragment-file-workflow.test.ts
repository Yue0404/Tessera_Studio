import { createProject, EditorStore } from "@tessera/core";
import {
  createFragmentFromStateV1,
  stringifyFragmentV1,
} from "@tessera/formats";
import { describe, expect, it, vi } from "vitest";
import {
  commitFragmentMerge,
  prepareFragmentMerge,
  readFragmentFile,
} from "./fragment-file-workflow.js";

function store(name = "工程", size = 4) {
  return new EditorStore(
    createProject({
      name,
      grid: { type: "square", width: size, height: size, cellSize: 24 },
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
}

function fragmentText() {
  const source = store("来源");
  source.paintCell(0, 0, "#AA0000FF");
  return stringifyFragmentV1(
    createFragmentFromStateV1(source.state, {
      fragmentId: crypto.randomUUID(),
      bounds: { minX: 0, minY: 0, maxX: 24, maxY: 24 },
      includedLayerIds: ["tessera.basic.cell-style"],
    }),
  );
}

describe("fragment file workflow", () => {
  it("超限时不调用 text，损坏输入稳定拒绝", async () => {
    const text = vi.fn(async () => "{}");
    await expect(
      readFragmentFile({ size: 512 * 1024 * 1024 + 1, text }),
    ).rejects.toMatchObject({
      code: "fragment-file-size-invalid",
    });
    expect(text).not.toHaveBeenCalled();
    await expect(
      readFragmentFile({ size: 1, text: async () => "{" }),
    ).rejects.toMatchObject({
      code: "fragment-file-invalid",
    });
  });

  it("合并保存成功后才返回新 store", async () => {
    const target = store("目标");
    const fragment = await readFragmentFile({
      size: fragmentText().length,
      text: async () => fragmentText(),
    });
    const prepared = prepareFragmentMerge(target.state, fragment);
    expect(prepared.plan.status).toBe("ready");
    const save = vi.fn(async () => undefined);
    const merged = await commitFragmentMerge(prepared, { save });
    expect(save).toHaveBeenCalledTimes(1);
    expect([...merged.state.cells.values()]).toHaveLength(1);
    expect([...target.state.cells.values()]).toHaveLength(0);
  });

  it("保存失败不提供可替换当前工程的 store", async () => {
    const target = store("目标");
    const text = fragmentText();
    const fragment = await readFragmentFile({
      size: text.length,
      text: async () => text,
    });
    const prepared = prepareFragmentMerge(target.state, fragment);
    await expect(
      commitFragmentMerge(prepared, {
        save: async () => {
          throw new Error("quota");
        },
      }),
    ).rejects.toMatchObject({ code: "fragment-merge-save-failed" });
    expect([...target.state.cells.values()]).toHaveLength(0);
  });

  it("默认位置越界时要求整数平移，合法平移后才可确认", () => {
    const source = store("来源");
    source.paintCell(3, 3, "#AA0000FF");
    const fragment = createFragmentFromStateV1(source.state, {
      fragmentId: crypto.randomUUID(),
      bounds: { minX: 72, minY: 72, maxX: 96, maxY: 96 },
      includedLayerIds: ["tessera.basic.cell-style"],
    });
    const target = store("小目标", 2);
    expect(prepareFragmentMerge(target.state, fragment).plan.status).toBe(
      "requires-translation",
    );
    expect(
      prepareFragmentMerge(target.state, fragment, {
        kind: "square",
        deltaRow: -2,
        deltaColumn: -2,
      }).plan.status,
    ).toBe("ready");
  });
});

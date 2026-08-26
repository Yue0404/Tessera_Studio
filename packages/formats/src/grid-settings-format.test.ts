import { createProject, EditorStore } from "@tessera/core";
import { describe, expect, it } from "vitest";
import { parseProjectV1, stringifyProjectV1 } from "./project-format.js";

describe("地图设置 Project v1 往返", () => {
  it("调整后的 width/height/cellSize 保存、加载并随撤销恢复", () => {
    const editor = new EditorStore(
      createProject({
        name: "地图设置格式",
        grid: { type: "hex-pointy", width: 4, height: 4, cellSize: 32 },
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
    editor.placeMarker({ kind: "cell", cellId: "cell:hex-pointy:1:1" });
    expect(
      editor.updateGridSettings({ width: 8, height: 6, cellSize: 48 }),
    ).toMatchObject({ status: "updated" });
    const document = JSON.parse(stringifyProjectV1(editor.state)) as any;
    expect(document.grid).toMatchObject({ width: 8, height: 6, cellSize: 48 });
    expect(parseProjectV1(JSON.stringify(document)).grid).toMatchObject({
      width: 8,
      height: 6,
      cellSize: 48,
    });

    editor.undo();
    expect(parseProjectV1(stringifyProjectV1(editor.state)).grid).toMatchObject(
      {
        width: 4,
        height: 4,
        cellSize: 32,
      },
    );
  });
});

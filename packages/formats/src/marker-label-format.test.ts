import { createProject, EditorStore } from "@tessera/core";
import { describe, expect, it } from "vitest";
import { createFragmentFromStateV1 } from "./export-closure.js";
import { computeProjectContentBounds } from "./content-bounds.js";
import { parseFragmentV1, stringifyFragmentV1 } from "./fragment-format.js";
import {
  parseProjectV1,
  stringifyProjectV1,
  toProjectV1,
} from "./project-format.js";

function store(): EditorStore {
  return new EditorStore(
    createProject({
      name: "附文格式",
      grid: { type: "square", width: 8, height: 8, cellSize: 32 },
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

describe("Project/Fragment 标记附文格式", () => {
  it("写入 attributes.label，旧工程缺失时恢复为 null", () => {
    const source = store();
    const markerId = source.placeMarker(
      { kind: "cell", cellId: "cell:square:1:1" },
      "#D9B866FF",
      "circle",
      "首都",
    );
    const document = JSON.parse(stringifyProjectV1(source.state)) as any;
    const serialized = document.managers.overlayManager.overlays.find(
      (overlay: any) => overlay.overlayId === markerId,
    );
    expect(serialized.attributes).toEqual({ label: "首都" });

    const restored = parseProjectV1(JSON.stringify(document));
    expect(restored.overlays.get(markerId)).toMatchObject({ label: "首都" });
    delete serialized.attributes.label;
    document.contentBounds = computeProjectContentBounds(document);
    const legacy = parseProjectV1(JSON.stringify(document));
    expect(legacy.overlays.get(markerId)).toMatchObject({ label: null });
  });

  it("完整工程与 Fragment 均保留附文及未知 extensions", () => {
    const source = store();
    const markerId = source.placeMarker(
      { kind: "cell", cellId: "cell:square:1:1" },
      "#D9B866FF",
      "diamond",
      "港口",
    );
    const document = JSON.parse(stringifyProjectV1(source.state)) as any;
    const serialized = document.managers.overlayManager.overlays.find(
      (overlay: any) => overlay.overlayId === markerId,
    );
    serialized.extensions.vendor = { token: 7 };
    serialized.anchor.extensions.futureAnchor = { token: 9 };

    const restoredState = parseProjectV1(JSON.stringify(document));
    const restored = new EditorStore(restoredState);
    const marker = restored.state.overlays.get(markerId);
    if (marker === undefined || marker.overlayType !== "marker")
      throw new Error("marker-missing");
    restored.updateOverlay(markerId, { ...marker, label: "新港" });
    const preserved = toProjectV1(restored.state, { mode: "preserve" }) as any;
    const preservedMarker = preserved.managers.overlayManager.overlays.find(
      (overlay: any) => overlay.overlayId === markerId,
    );
    expect(preservedMarker.attributes).toEqual({ label: "新港" });
    expect(preservedMarker.extensions).toEqual({ vendor: { token: 7 } });
    expect(preservedMarker.anchor.extensions).toEqual({
      futureAnchor: { token: 9 },
    });

    const fragment = createFragmentFromStateV1(restored.state, {
      fragmentId: "11111111-1111-4111-8111-111111111111",
      bounds: { minX: 0, minY: 0, maxX: 128, maxY: 128 },
      includedLayerIds: ["tessera.basic.placed-object"],
    }) as any;
    expect(fragment.objects.overlays[0].attributes).toEqual({ label: "新港" });
    expect(fragment.objects.overlays[0].extensions).toEqual({
      vendor: { token: 7 },
    });
    expect(fragment.objects.overlays[0].anchor.extensions).toEqual({
      futureAnchor: { token: 9 },
    });
    const fragmentRoundTrip = parseFragmentV1(stringifyFragmentV1(fragment));
    expect(fragmentRoundTrip.objects.overlays[0]?.attributes).toEqual({
      label: "新港",
    });
  });
});

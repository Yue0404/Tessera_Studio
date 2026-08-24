import type { ProjectV1Document } from "@tessera/formats";
import { describe, expect, it } from "vitest";
import { countProjectModuleObjectReferences } from "./project-module-references.js";

function documentAt(
  location: "cell" | "edge" | "overlay" | "connection" | "group",
): ProjectV1Document {
  const element = { elementId: "vendor.module:item" };
  return {
    modules: [{ moduleId: "vendor.module", version: "1.2.3" }],
    chunks:
      location === "cell"
        ? [{ cellOverrides: [{ layerInstances: [element] }] }]
        : [],
    managers: {
      edgeManager: {
        edges: location === "edge" ? [{ layerInstances: [element] }] : [],
      },
      overlayManager: { overlays: location === "overlay" ? [element] : [] },
      connectionManager: {
        connections: location === "connection" ? [element] : [],
      },
    },
    domainGroups: location === "group" ? [element] : [],
  } as unknown as ProjectV1Document;
}

describe("工程模块对象引用计数", () => {
  it.each(["cell", "edge", "overlay", "connection", "group"] as const)(
    "覆盖 %s 实例位置且不把模块声明算作对象",
    (location) => {
      const document = documentAt(location);
      expect(
        countProjectModuleObjectReferences(document, "vendor.module", "1.2.3"),
      ).toBe(1);
      expect(
        countProjectModuleObjectReferences(document, "vendor.module", "9.9.9"),
      ).toBe(0);
    },
  );
});

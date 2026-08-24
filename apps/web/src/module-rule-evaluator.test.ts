import {
  createProject,
  edgeIdentity,
  EditorStore,
  type FixedLayerState,
  type ModuleRuntimeInstance,
} from "@tessera/core";
import type {
  ModuleConstraintDefinition,
  ModuleElementDefinition,
  ParsedModulePackage,
} from "@tessera/module-runtime";
import { describe, expect, it, vi } from "vitest";
import { ProjectModuleRuleEvaluator } from "./module-rule-evaluator.js";

const layerId = "example.rules.runtime";
const slotCell = "example.rules:slot.cell";
const slotEdge = "example.rules:slot.edge";
const slotRoute = "example.rules:slot.route";

function element(
  elementId: string,
  primitive: ModuleElementDefinition["primitive"],
  anchors: ModuleElementDefinition["anchors"],
  occupancy: ModuleElementDefinition["occupancy"] = [],
  constraintIds: readonly string[] = [],
): ModuleElementDefinition {
  return {
    elementId,
    categoryId: "example.rules:category.test",
    nameKey: { kind: "literal", language: "zh-CN", text: elementId },
    descriptionKey: { kind: "literal", language: "zh-CN", text: elementId },
    primitive,
    layerId,
    anchors,
    supportedGrids: ["square"],
    defaultStyle: {},
    attributeSchema: {
      type: "object",
      properties: {
        level: { type: "integer", minimum: 0, maximum: 10, default: 3 },
        phase: {
          type: "string",
          minLength: 1,
          maxLength: 16,
          enum: ["planned", "built"],
          default: "planned",
        },
      },
      required: ["level", "phase"],
      additionalProperties: false,
    },
    occupancy,
    constraintIds,
    resourceIds: [],
    source: {
      sourceId: "example.rules:source.test",
      rulesetId: "rules-v1",
      contentVersion: "1",
      retrievedAt: "2026-08-24T00:00:00.000Z",
    },
  };
}

const cellElement = element(
  "example.rules:cell.city",
  "cell-style",
  ["cell"],
  [{ slotId: slotCell, anchor: "cell", min: 0, max: 1, conflict: "warning" }],
  [
    "example.rules:constraint.properties",
    "example.rules:constraint.neighbors",
    "example.rules:constraint.info",
  ],
);
const overlayCellElement = element(
  "example.rules:marker.city",
  "marker",
  ["cell"],
  [{ slotId: slotCell, anchor: "cell", min: 0, max: 1, conflict: "warning" }],
);
const edgeElement = element(
  "example.rules:edge.river",
  "edge-style",
  ["edge"],
  [{ slotId: slotEdge, anchor: "edge", min: 0, max: 1, conflict: "error" }],
);
const overlayEdgeElement = element(
  "example.rules:marker.bridge",
  "marker",
  ["edge"],
  [{ slotId: slotEdge, anchor: "edge", min: 0, max: 1, conflict: "error" }],
);
const connectionElement = element(
  "example.rules:connection.route",
  "connection",
  ["cell-center"],
  [
    {
      slotId: slotRoute,
      anchor: "cell-center",
      min: 0,
      max: 1,
      conflict: "warning",
    },
  ],
);

const constraints: readonly ModuleConstraintDefinition[] = [
  {
    constraintId: "example.rules:constraint.properties",
    severity: "error",
    messageKey: { kind: "key", key: "constraint.properties" },
    appliesTo: [cellElement.elementId],
    maxRadius: 0,
    rulesetVersion: "1",
    condition: {
      op: "all",
      conditions: [
        { op: "grid-is", grids: ["square"] },
        { op: "anchor-is", anchors: ["cell"] },
        { op: "property-equals", path: "attributes.phase", value: "planned" },
        {
          op: "any",
          conditions: [
            {
              op: "property-in",
              path: "attributes.phase",
              values: ["planned", "built"],
            },
            { op: "grid-is", grids: ["hex-pointy"] },
          ],
        },
        { op: "number-range", path: "attributes.level", min: 2, max: 4 },
        { op: "occupancy-count", slotId: slotCell, min: 1, max: 2 },
        { op: "not", condition: { op: "grid-is", grids: ["hex-pointy"] } },
      ],
    },
    extensions: {},
  },
  {
    constraintId: "example.rules:constraint.neighbors",
    severity: "warning",
    messageKey: { kind: "key", key: "constraint.neighbors" },
    appliesTo: [cellElement.elementId],
    maxRadius: 2,
    rulesetVersion: "1",
    condition: {
      op: "neighbor-count",
      radius: 2,
      elementId: overlayCellElement.elementId,
      min: 1,
      max: 4,
    },
    extensions: {},
  },
  {
    constraintId: "example.rules:constraint.info",
    severity: "info",
    messageKey: { kind: "literal", language: "zh-CN", text: "六边形提示" },
    appliesTo: [cellElement.elementId],
    maxRadius: 0,
    rulesetVersion: "1",
    condition: { op: "grid-is", grids: ["hex-pointy"] },
    extensions: {},
  },
];

const modulePackage = {
  kind: "module",
  artifactId: "example.rules",
  version: "1.0.0",
  manifest: { defaultLanguage: "zh-CN" },
  elements: [
    cellElement,
    overlayCellElement,
    edgeElement,
    overlayEdgeElement,
    connectionElement,
  ],
  constraints,
  locales: {
    "zh-CN": {
      "constraint.properties": "属性不满足",
      "constraint.neighbors": "半径内缺少邻居",
    },
  },
} as unknown as ParsedModulePackage;

function store(): EditorStore {
  const state = createProject({
    name: "规则",
    grid: { type: "square", width: 20, height: 20, cellSize: 32 },
    style: {
      canvasBackground: "#09141DFF",
      defaultCellColor: "#14232DFF",
      gridColor: "#59656AFF",
      gridOpacity: 0.7,
      gridWidth: 1,
      defaultEdgeColor: "#59656AFF",
    },
  });
  (state.layers as Map<string, FixedLayerState>).set(layerId, {
    layerId,
    moduleVersion: "1.0.0",
    zIndex: 2500,
    visible: true,
    locked: false,
    opacity: 1,
    allowedKinds: ["cell", "edge", "overlay", "connection"],
    runtimeStatus: "available",
  });
  return new EditorStore(state);
}

function common(elementId: string) {
  return {
    instanceId: `${elementId}:${crypto.randomUUID()}`,
    elementId,
    layerId,
    attributes: { level: 3, phase: "planned" },
    styleOverrides: {},
    extensions: {},
    runtimeStatus: "available" as const,
  };
}

function add(editor: EditorStore, instance: ModuleRuntimeInstance): string {
  return editor.addModuleInstance(instance);
}

describe("ProjectModuleRuleEvaluator", () => {
  it("cell/edge/overlay/connection 的同锚点冲突只提示且允许保留", () => {
    const editor = store();
    const evaluator = new ProjectModuleRuleEvaluator(
      editor,
      [modulePackage],
      "zh-CN",
    );
    const cellIdValue = "cell:square:2:2";
    const cellInstance = add(editor, {
      ...common(cellElement.elementId),
      kind: "cell",
      cellId: cellIdValue,
    });
    const cellOverlay = add(editor, {
      ...common(overlayCellElement.elementId),
      kind: "overlay",
      objectKind: "anchored-overlay",
      overlayType: "marker",
      anchor: { kind: "cell", cellId: cellIdValue, extensions: {} },
      orderInLayer: 0,
    });
    const cellHints = evaluator.hintsForInstance(cellInstance);
    expect(cellHints).toHaveLength(3);
    expect(cellHints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "occupancy",
          severity: "warning",
          count: 2,
        }),
        expect.objectContaining({ kind: "constraint", severity: "warning" }),
        expect.objectContaining({ kind: "constraint", severity: "info" }),
      ]),
    );
    expect(evaluator.hintsForInstance(cellOverlay)).toEqual([
      expect.objectContaining({
        kind: "occupancy",
        severity: "warning",
        count: 2,
      }),
    ]);

    const edge = edgeIdentity(editor.state.grid, { row: 3, column: 3 }, 1);
    const edgeInstance = add(editor, {
      ...common(edgeElement.elementId),
      kind: "edge",
      edgeId: edge.edgeId,
      adjacentCellIds: edge.adjacentCellIds,
    });
    add(editor, {
      ...common(overlayEdgeElement.elementId),
      kind: "overlay",
      objectKind: "anchored-overlay",
      overlayType: "marker",
      anchor: { kind: "edge", edgeId: edge.edgeId, extensions: {} },
      orderInLayer: 0,
    });
    expect(evaluator.hintsForInstance(edgeInstance)).toEqual([
      expect.objectContaining({
        kind: "occupancy",
        severity: "error",
        count: 2,
      }),
    ]);

    const firstConnection = add(editor, {
      ...common(connectionElement.elementId),
      kind: "connection",
      objectKind: "line",
      start: { kind: "cell-center", cellId: "cell:square:5:5", extensions: {} },
      end: { kind: "cell-center", cellId: "cell:square:5:6", extensions: {} },
      label: null,
    });
    add(editor, {
      ...common(connectionElement.elementId),
      kind: "connection",
      objectKind: "line",
      start: { kind: "cell-center", cellId: "cell:square:5:5", extensions: {} },
      end: { kind: "cell-center", cellId: "cell:square:5:6", extensions: {} },
      label: null,
    });
    expect(evaluator.hintsForInstance(firstConnection)).toEqual([
      expect.objectContaining({
        kind: "occupancy",
        severity: "warning",
        count: 2,
      }),
    ]);
    expect(editor.state.moduleInstances.size).toBe(6);

    const visibleLayer = editor.state.layers.get(layerId);
    if (visibleLayer === undefined) throw new Error("layer-missing");
    (editor.state.layers as Map<string, FixedLayerState>).set(layerId, {
      ...visibleLayer,
      visible: false,
      locked: true,
    });
    expect(evaluator.hintsForInstance(firstConnection)).toHaveLength(1);

    (editor.state.layers as Map<string, FixedLayerState>).set(
      layerId,
      visibleLayer,
    );
    expect(editor.deleteModuleInstance(cellOverlay)).toBe(true);
    expect(
      evaluator
        .hintsForInstance(cellInstance)
        .some((hint) => hint.kind === "occupancy"),
    ).toBe(false);
    editor.undo();
    expect(
      evaluator
        .hintsForInstance(cellInstance)
        .some((hint) => hint.kind === "occupancy"),
    ).toBe(true);
  });

  it("白名单 AST 支持属性、组合、半径邻居与三 severity 的动态重算", () => {
    const editor = store();
    const evaluator = new ProjectModuleRuleEvaluator(
      editor,
      [modulePackage],
      "zh-CN",
    );
    const target = add(editor, {
      ...common(cellElement.elementId),
      kind: "cell",
      cellId: "cell:square:8:8",
    });
    expect(
      evaluator.hintsForInstance(target).map((hint) => hint.severity),
    ).toEqual(["warning", "info"]);

    const neighbor = add(editor, {
      ...common(overlayCellElement.elementId),
      kind: "overlay",
      objectKind: "anchored-overlay",
      overlayType: "marker",
      anchor: { kind: "cell", cellId: "cell:square:8:10", extensions: {} },
      orderInLayer: 0,
    });
    const valuesSpy = vi
      .spyOn(editor.state.moduleInstances, "values")
      .mockImplementation(() => {
        throw new Error("规则局部重算不得遍历全部通用实例");
      });
    expect(
      evaluator.hintsForInstance(target).map((hint) => hint.severity),
    ).toEqual(["info"]);

    editor.updateModuleInstance(target, {
      attributes: { level: 9, phase: "built" },
    });
    expect(evaluator.hintsForInstance(target)).toEqual([
      expect.objectContaining({ severity: "error", message: "属性不满足" }),
      expect.objectContaining({ severity: "info", message: "六边形提示" }),
    ]);
    editor.undo();
    expect(evaluator.hintsForInstance(target)).toHaveLength(1);
    editor.redo();
    expect(evaluator.hintsForInstance(target)).toHaveLength(2);
    expect(editor.state.moduleInstances.get(neighbor)).toBeDefined();
    valuesSpy.mockRestore();
  });

  it("防御性忽略未由元素 attributeSchema 预声明的属性路径", () => {
    const baseConstraint = constraints[0];
    if (baseConstraint === undefined) throw new Error("constraint-missing");
    const invalidConstraint: ModuleConstraintDefinition = {
      ...baseConstraint,
      constraintId: "example.rules:constraint.undeclared",
      condition: {
        op: "property-equals",
        path: "attributes.internal",
        value: true,
      },
    };
    const invalidPackage = {
      ...modulePackage,
      elements: modulePackage.elements.map((item) =>
        item.elementId === cellElement.elementId
          ? { ...item, constraintIds: [invalidConstraint.constraintId] }
          : item,
      ),
      constraints: [invalidConstraint],
    } as ParsedModulePackage;
    const editor = store();
    const instanceId = add(editor, {
      ...common(cellElement.elementId),
      kind: "cell",
      cellId: "cell:square:4:4",
    });

    expect(
      new ProjectModuleRuleEvaluator(
        editor,
        [invalidPackage],
        "zh-CN",
      ).hintsForInstance(instanceId),
    ).toEqual([]);
  });
});

import {
  cellPolygon,
  edgeIdentity,
  mapPointToCell,
  parseCellId,
  projectTextContentViolation,
  type Point,
  type ProjectGrid,
} from "@tessera/core";

type ErrorFactory = (
  code: string,
  details?: Readonly<Record<string, unknown>>,
) => Error;

function pointOnSegment(point: Point, start: Point, end: Point): boolean {
  const cross =
    (point.x - start.x) * (end.y - start.y) -
    (point.y - start.y) * (end.x - start.x);
  const scale = Math.max(
    1,
    Math.abs(point.x),
    Math.abs(point.y),
    Math.abs(start.x),
    Math.abs(start.y),
    Math.abs(end.x),
    Math.abs(end.y),
  );
  if (Math.abs(cross) > Number.EPSILON * scale * scale * 16) return false;
  return (
    point.x >= Math.min(start.x, end.x) - Number.EPSILON * scale * 16 &&
    point.x <= Math.max(start.x, end.x) + Number.EPSILON * scale * 16 &&
    point.y >= Math.min(start.y, end.y) - Number.EPSILON * scale * 16 &&
    point.y <= Math.max(start.y, end.y) + Number.EPSILON * scale * 16
  );
}

function pointInsideOrOnPolygon(
  point: Point,
  polygon: readonly Point[],
): boolean {
  let inside = false;
  for (
    let index = 0, previousIndex = polygon.length - 1;
    index < polygon.length;
    previousIndex = index, index += 1
  ) {
    const current = polygon[index];
    const previous = polygon[previousIndex];
    if (current === undefined || previous === undefined) continue;
    if (pointOnSegment(point, previous, current)) return true;
    const crossesRay =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) /
          (previous.y - current.y) +
          current.x;
    if (crossesRay) inside = !inside;
  }
  return inside;
}

/** 地图坐标锚点必须落在有限地图实际单元格几何内。 */
export function isMapPointInsideGrid(grid: ProjectGrid, point: Point): boolean {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  const coordinate = mapPointToCell(grid, point);
  if (coordinate === undefined) return false;
  return pointInsideOrOnPolygon(
    point,
    cellPolygon(grid, coordinate.row, coordinate.column),
  );
}

export function assertMapPointInsideGrid(
  grid: ProjectGrid,
  point: Point,
  pointer: string,
  makeError: ErrorFactory,
): void {
  if (!isMapPointInsideGrid(grid, point)) {
    throw makeError("map-point-out-of-bounds", { pointer });
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  pointer: string,
  makeError: ErrorFactory,
): asserts value is Record<string, unknown> {
  if (!isPlainRecord(value)) {
    throw makeError("basic-payload-object-required", { pointer });
  }
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    keys.some((key) => !allowed.has(key))
  ) {
    throw makeError("basic-payload-keys-invalid", { pointer });
  }
}

function assertColor(value: unknown, pointer: string, makeError: ErrorFactory) {
  if (typeof value !== "string" || !/^#[0-9A-Fa-f]{8}$/.test(value)) {
    throw makeError("basic-color-invalid", { pointer });
  }
}

function assertFiniteRange(
  value: unknown,
  minimum: number,
  maximum: number,
  pointer: string,
  makeError: ErrorFactory,
): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw makeError("basic-number-range-invalid", {
      pointer,
      minimum,
      maximum,
    });
  }
}

/** 已知 basic 元素必须经过严格白名单；外部模块由对应精确版本 Schema 解释。 */
export function validateKnownBasicInstance(
  instance: {
    elementId: string;
    layerId: string;
    styleOverrides: unknown;
    attributes: unknown;
  },
  pointer: string,
  makeError: ErrorFactory,
): void {
  const stylePointer = `${pointer}/styleOverrides`;
  const attributesPointer = `${pointer}/attributes`;
  switch (instance.elementId) {
    case "tessera.basic:cell.color": {
      if (instance.layerId !== "tessera.basic.cell-style") {
        throw makeError("basic-layer-mismatch", { pointer });
      }
      assertExactKeys(
        instance.styleOverrides,
        ["fillColor", "fillOpacity"],
        [],
        stylePointer,
        makeError,
      );
      assertColor(
        instance.styleOverrides.fillColor,
        `${stylePointer}/fillColor`,
        makeError,
      );
      assertFiniteRange(
        instance.styleOverrides.fillOpacity,
        0,
        1,
        `${stylePointer}/fillOpacity`,
        makeError,
      );
      assertExactKeys(
        instance.attributes,
        [],
        ["label"],
        attributesPointer,
        makeError,
      );
      if (
        instance.attributes.label !== undefined &&
        instance.attributes.label !== null &&
        typeof instance.attributes.label !== "string"
      ) {
        throw makeError("basic-cell-label-invalid", {
          pointer: `${attributesPointer}/label`,
        });
      }
      if (typeof instance.attributes.label === "string") {
        assertTextLimits(
          instance.attributes.label,
          `${attributesPointer}/label`,
          makeError,
        );
      }
      return;
    }
    case "tessera.basic:edge.style": {
      if (instance.layerId !== "tessera.basic.edge-style") {
        throw makeError("basic-layer-mismatch", { pointer });
      }
      assertExactKeys(
        instance.styleOverrides,
        ["strokeColor", "strokeOpacity", "strokeWidth", "lineCap", "lineStyle"],
        [],
        stylePointer,
        makeError,
      );
      assertColor(
        instance.styleOverrides.strokeColor,
        `${stylePointer}/strokeColor`,
        makeError,
      );
      assertFiniteRange(
        instance.styleOverrides.strokeOpacity,
        0,
        1,
        `${stylePointer}/strokeOpacity`,
        makeError,
      );
      assertFiniteRange(
        instance.styleOverrides.strokeWidth,
        Number.MIN_VALUE,
        Number.MAX_VALUE,
        `${stylePointer}/strokeWidth`,
        makeError,
      );
      if (
        !["round", "butt", "square"].includes(
          String(instance.styleOverrides.lineCap),
        ) ||
        !["solid", "dashed"].includes(String(instance.styleOverrides.lineStyle))
      ) {
        throw makeError("basic-edge-style-enum-invalid", {
          pointer: stylePointer,
        });
      }
      assertExactKeys(
        instance.attributes,
        [],
        ["persistence"],
        attributesPointer,
        makeError,
      );
      if (
        instance.attributes.persistence !== undefined &&
        !["explicit-style", "reference-only"].includes(
          String(instance.attributes.persistence),
        )
      ) {
        throw makeError("basic-edge-persistence-invalid", {
          pointer: `${attributesPointer}/persistence`,
        });
      }
      return;
    }
    case "tessera.basic:marker": {
      if (instance.layerId !== "tessera.basic.placed-object") {
        throw makeError("basic-layer-mismatch", { pointer });
      }
      assertExactKeys(
        instance.styleOverrides,
        ["size", "rotation", "opacity", "color", "markerShape"],
        [],
        stylePointer,
        makeError,
      );
      assertFiniteRange(
        instance.styleOverrides.size,
        Number.MIN_VALUE,
        Number.MAX_VALUE,
        `${stylePointer}/size`,
        makeError,
      );
      assertFiniteRange(
        instance.styleOverrides.rotation,
        0,
        360,
        `${stylePointer}/rotation`,
        makeError,
      );
      if (instance.styleOverrides.rotation === 360) {
        throw makeError("basic-rotation-invalid", {
          pointer: `${stylePointer}/rotation`,
        });
      }
      assertFiniteRange(
        instance.styleOverrides.opacity,
        0,
        1,
        `${stylePointer}/opacity`,
        makeError,
      );
      assertColor(
        instance.styleOverrides.color,
        `${stylePointer}/color`,
        makeError,
      );
      if (
        !["circle", "diamond", "pin"].includes(
          String(instance.styleOverrides.markerShape),
        )
      ) {
        throw makeError("basic-marker-shape-invalid", {
          pointer: `${stylePointer}/markerShape`,
        });
      }
      assertExactKeys(
        instance.attributes,
        [],
        ["label"],
        attributesPointer,
        makeError,
      );
      if (
        instance.attributes.label !== undefined &&
        instance.attributes.label !== null &&
        typeof instance.attributes.label !== "string"
      ) {
        throw makeError("basic-marker-label-invalid", {
          pointer: `${attributesPointer}/label`,
        });
      }
      if (typeof instance.attributes.label === "string") {
        assertTextLimits(
          instance.attributes.label,
          `${attributesPointer}/label`,
          makeError,
        );
      }
      return;
    }
    case "tessera.basic:text": {
      if (instance.layerId !== "tessera.basic.annotation") {
        throw makeError("basic-layer-mismatch", { pointer });
      }
      assertExactKeys(
        instance.styleOverrides,
        [
          "fontSize",
          "rotation",
          "opacity",
          "color",
          "fontWeight",
          "align",
          "backgroundVisible",
        ],
        [],
        stylePointer,
        makeError,
      );
      assertFiniteRange(
        instance.styleOverrides.fontSize,
        Number.MIN_VALUE,
        Number.MAX_VALUE,
        `${stylePointer}/fontSize`,
        makeError,
      );
      assertFiniteRange(
        instance.styleOverrides.rotation,
        0,
        360,
        `${stylePointer}/rotation`,
        makeError,
      );
      if (instance.styleOverrides.rotation === 360) {
        throw makeError("basic-rotation-invalid", {
          pointer: `${stylePointer}/rotation`,
        });
      }
      assertFiniteRange(
        instance.styleOverrides.opacity,
        0,
        1,
        `${stylePointer}/opacity`,
        makeError,
      );
      assertColor(
        instance.styleOverrides.color,
        `${stylePointer}/color`,
        makeError,
      );
      if (
        !["normal", "bold"].includes(
          String(instance.styleOverrides.fontWeight),
        ) ||
        !["left", "center", "right"].includes(
          String(instance.styleOverrides.align),
        ) ||
        typeof instance.styleOverrides.backgroundVisible !== "boolean"
      ) {
        throw makeError("basic-text-style-invalid", { pointer: stylePointer });
      }
      assertExactKeys(
        instance.attributes,
        ["text"],
        [],
        attributesPointer,
        makeError,
      );
      if (typeof instance.attributes.text !== "string") {
        throw makeError("basic-text-value-invalid", {
          pointer: `${attributesPointer}/text`,
        });
      }
      assertTextLimits(
        instance.attributes.text,
        `${attributesPointer}/text`,
        makeError,
      );
      return;
    }
    case "tessera.basic:connection.line":
    case "tessera.basic:connection.arrow": {
      if (instance.layerId !== "tessera.basic.connection") {
        throw makeError("basic-layer-mismatch", { pointer });
      }
      assertExactKeys(
        instance.styleOverrides,
        ["strokeColor", "strokeWidth", "strokeOpacity", "lineStyle"],
        [],
        stylePointer,
        makeError,
      );
      assertColor(
        instance.styleOverrides.strokeColor,
        `${stylePointer}/strokeColor`,
        makeError,
      );
      assertFiniteRange(
        instance.styleOverrides.strokeWidth,
        Number.MIN_VALUE,
        Number.MAX_VALUE,
        `${stylePointer}/strokeWidth`,
        makeError,
      );
      assertFiniteRange(
        instance.styleOverrides.strokeOpacity,
        0,
        1,
        `${stylePointer}/strokeOpacity`,
        makeError,
      );
      if (
        !["solid", "dashed"].includes(String(instance.styleOverrides.lineStyle))
      ) {
        throw makeError("basic-connection-style-invalid", {
          pointer: stylePointer,
        });
      }
      assertExactKeys(
        instance.attributes,
        [],
        [],
        attributesPointer,
        makeError,
      );
      return;
    }
    default:
      if (instance.elementId.startsWith("tessera.basic:")) {
        throw makeError("basic-element-unknown", {
          elementId: instance.elementId,
          pointer,
        });
      }
  }
}

export type BasicPlacement =
  "cell" | "edge" | "marker-overlay" | "text-overlay" | "line" | "arrow";

export function validateKnownBasicPlacement(
  elementId: string,
  placement: BasicPlacement,
  pointer: string,
  makeError: ErrorFactory,
): void {
  const expected: Partial<Record<string, BasicPlacement>> = {
    "tessera.basic:cell.color": "cell",
    "tessera.basic:edge.style": "edge",
    "tessera.basic:marker": "marker-overlay",
    "tessera.basic:text": "text-overlay",
    "tessera.basic:connection.line": "line",
    "tessera.basic:connection.arrow": "arrow",
  };
  const expectedPlacement = expected[elementId];
  if (
    elementId.startsWith("tessera.basic:") &&
    expectedPlacement !== placement
  ) {
    throw makeError("basic-primitive-placement-invalid", {
      pointer,
      elementId,
      placement,
      expectedPlacement,
    });
  }
}

export function assertTextLimits(
  value: string,
  pointer: string,
  makeError: ErrorFactory,
): void {
  const violation = projectTextContentViolation(value);
  if (violation === "text-line-limit-exceeded") {
    throw makeError(violation, { pointer, maxLines: 8 });
  }
  if (violation === "text-grapheme-limit-exceeded") {
    throw makeError(violation, { pointer, maxGraphemes: 256 });
  }
}

export function assertCanonicalEdge(
  grid: ProjectGrid,
  edgeId: string,
  adjacentCellIds: readonly string[],
  pointer: string,
  makeError: ErrorFactory,
): void {
  const ownerCellId = adjacentCellIds[0];
  if (ownerCellId === undefined) {
    throw makeError("edge-adjacent-cells-invalid", { pointer, edgeId });
  }
  const owner = parseCellId(ownerCellId);
  const sideCount = grid.type === "square" ? 4 : 6;
  for (let side = 0; side < sideCount; side += 1) {
    const identity = edgeIdentity(grid, owner, side);
    if (
      identity.edgeId === edgeId &&
      identity.adjacentCellIds.length === adjacentCellIds.length &&
      identity.adjacentCellIds.every(
        (cellId, index) => cellId === adjacentCellIds[index],
      )
    ) {
      return;
    }
  }
  throw makeError("edge-id-adjacency-mismatch", { pointer, edgeId });
}

export function compareCellIds(left: string, right: string): number {
  const leftCell = parseCellId(left);
  const rightCell = parseCellId(right);
  return leftCell.row - rightCell.row || leftCell.column - rightCell.column;
}

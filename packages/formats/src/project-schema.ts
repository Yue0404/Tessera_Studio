export const PROJECT_MIME = "application/vnd.tessera.project+json";
export const PROJECT_EXTENSION = ".tessera-project.json";

const extensions = { type: "object", additionalProperties: true } as const;
const color = { type: "string", pattern: "^#[0-9A-Fa-f]{8}$" } as const;
const uuid = { type: "string", format: "uuid" } as const;
const cellId = {
  type: "string",
  pattern: "^cell:(square|hex-pointy):[0-9]+:[0-9]+$",
} as const;
const instanceBase = {
  instanceId: uuid,
  attributes: { type: "object", additionalProperties: false },
  extensions,
} as const;
const cellLayerInstance = {
  type: "object",
  additionalProperties: false,
  required: [
    "instanceId",
    "elementId",
    "layerId",
    "styleOverrides",
    "attributes",
    "extensions",
  ],
  properties: {
    ...instanceBase,
    elementId: { const: "tessera.basic:cell.color" },
    layerId: { const: "tessera.basic.cell-style" },
    styleOverrides: {
      type: "object",
      additionalProperties: false,
      required: ["fillColor", "fillOpacity"],
      properties: {
        fillColor: color,
        fillOpacity: { type: "number", minimum: 0, maximum: 1 },
      },
    },
  },
} as const;
const edgeLayerInstance = {
  type: "object",
  additionalProperties: false,
  required: [
    "instanceId",
    "elementId",
    "layerId",
    "styleOverrides",
    "attributes",
    "extensions",
  ],
  properties: {
    ...instanceBase,
    elementId: { const: "tessera.basic:edge.style" },
    layerId: { const: "tessera.basic.edge-style" },
    styleOverrides: {
      type: "object",
      additionalProperties: false,
      required: ["strokeColor", "strokeOpacity", "strokeWidth", "lineCap"],
      properties: {
        strokeColor: color,
        strokeOpacity: { type: "number", minimum: 0, maximum: 1 },
        strokeWidth: { type: "number", exclusiveMinimum: 0 },
        lineCap: { enum: ["round", "butt", "square"] },
      },
    },
  },
} as const;

export const projectV1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: [
    "kind",
    "formatVersion",
    "createdWithAppVersion",
    "projectId",
    "name",
    "createdAt",
    "updatedAt",
    "exportScope",
    "isComplete",
    "lineage",
    "grid",
    "modules",
    "layerStates",
    "mapStyle",
    "contentBounds",
    "chunks",
    "managers",
    "domainGroups",
    "embeddedAssets",
    "viewState",
    "extensions",
  ],
  properties: {
    kind: { const: "tessera-project" },
    formatVersion: { const: "1" },
    createdWithAppVersion: {
      type: "string",
      pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$",
    },
    projectId: uuid,
    name: { type: "string", minLength: 1, maxLength: 128 },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    exportScope: { const: "full" },
    isComplete: { const: true },
    lineage: { type: "null" },
    grid: {
      type: "object",
      additionalProperties: false,
      required: [
        "type",
        "orientation",
        "width",
        "height",
        "cellSize",
        "coordinateEncoding",
        "chunkSizeCells",
        "extensions",
      ],
      properties: {
        type: { enum: ["square", "hex-pointy"] },
        orientation: { enum: ["axis-aligned", "pointy"] },
        width: { type: "integer", minimum: 1, maximum: 40000 },
        height: { type: "integer", minimum: 1, maximum: 40000 },
        cellSize: { type: "number", minimum: 12, maximum: 96 },
        coordinateEncoding: { const: "row-column-zero-based" },
        chunkSizeCells: { const: 64 },
        extensions,
      },
    },
    modules: {
      type: "array",
      minItems: 1,
      maxItems: 1024,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["moduleId", "version", "packageSourceKind", "extensions"],
        properties: {
          moduleId: { type: "string", minLength: 1 },
          version: { type: "string", pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$" },
          packageSourceKind: {
            enum: ["built-in", "user-file", "generated-local"],
          },
          extensions,
        },
      },
    },
    layerStates: {
      type: "array",
      minItems: 1,
      maxItems: 8192,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "layerId",
          "moduleVersion",
          "zIndex",
          "visible",
          "locked",
          "opacity",
          "extensions",
        ],
        properties: {
          layerId: { type: "string", minLength: 1 },
          moduleVersion: {
            type: "string",
            pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$",
          },
          zIndex: { type: "integer" },
          visible: { type: "boolean" },
          locked: { type: "boolean" },
          opacity: { type: "number", minimum: 0, maximum: 1 },
          extensions,
        },
      },
    },
    mapStyle: {
      type: "object",
      additionalProperties: false,
      required: [
        "canvasBackground",
        "gridLineStyle",
        "defaultCellStyle",
        "defaultEdgeStyle",
        "extensions",
      ],
      properties: {
        canvasBackground: color,
        gridLineStyle: {
          type: "object",
          additionalProperties: false,
          required: ["strokeColor", "strokeOpacity", "strokeWidth"],
          properties: {
            strokeColor: color,
            strokeOpacity: { type: "number", minimum: 0, maximum: 1 },
            strokeWidth: { type: "number", exclusiveMinimum: 0 },
          },
        },
        defaultCellStyle: {
          type: "object",
          additionalProperties: false,
          required: ["fillColor", "fillOpacity"],
          properties: {
            fillColor: color,
            fillOpacity: { type: "number", minimum: 0, maximum: 1 },
          },
        },
        defaultEdgeStyle: {
          type: "object",
          additionalProperties: false,
          required: ["strokeColor", "strokeOpacity", "strokeWidth", "lineCap"],
          properties: {
            strokeColor: color,
            strokeOpacity: { type: "number", minimum: 0, maximum: 1 },
            strokeWidth: { type: "number", exclusiveMinimum: 0 },
            lineCap: { enum: ["round", "butt", "square"] },
          },
        },
        extensions,
      },
    },
    contentBounds: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["minX", "minY", "maxX", "maxY"],
          properties: {
            minX: { type: "number" },
            minY: { type: "number" },
            maxX: { type: "number" },
            maxY: { type: "number" },
          },
        },
      ],
    },
    chunks: {
      type: "array",
      maxItems: 1000000,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "chunkRow",
          "chunkColumn",
          "cellOverrides",
          "ownedEdgeIds",
          "ownedOverlayIds",
          "ownedDomainGroupIds",
          "extensions",
        ],
        properties: {
          chunkRow: { type: "integer", minimum: 0, maximum: 624 },
          chunkColumn: { type: "integer", minimum: 0, maximum: 624 },
          cellOverrides: {
            type: "array",
            maxItems: 4096,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["cellId", "layerInstances", "extensions"],
              properties: {
                cellId,
                layerInstances: {
                  type: "array",
                  minItems: 1,
                  maxItems: 1,
                  items: cellLayerInstance,
                },
                extensions,
              },
            },
          },
          ownedEdgeIds: {
            type: "array",
            maxItems: 16384,
            uniqueItems: true,
            items: { type: "string", minLength: 1 },
          },
          ownedOverlayIds: { type: "array", maxItems: 0 },
          ownedDomainGroupIds: { type: "array", maxItems: 0 },
          extensions,
        },
      },
    },
    managers: {
      type: "object",
      additionalProperties: false,
      required: ["edgeManager", "connectionManager", "overlayManager"],
      properties: {
        edgeManager: {
          type: "object",
          additionalProperties: false,
          required: ["formatVersion", "edges", "extensions"],
          properties: {
            formatVersion: { const: "1" },
            edges: {
              type: "array",
              maxItems: 3200000000,
              items: {
                type: "object",
                additionalProperties: false,
                required: [
                  "kind",
                  "edgeId",
                  "adjacentCellIds",
                  "layerInstances",
                  "extensions",
                ],
                properties: {
                  kind: { const: "edge" },
                  edgeId: { type: "string", minLength: 1 },
                  adjacentCellIds: {
                    type: "array",
                    minItems: 1,
                    maxItems: 2,
                    uniqueItems: true,
                    items: cellId,
                  },
                  layerInstances: {
                    type: "array",
                    minItems: 1,
                    maxItems: 1,
                    items: edgeLayerInstance,
                  },
                  extensions,
                },
              },
            },
            extensions,
          },
        },
        connectionManager: {
          type: "object",
          additionalProperties: false,
          required: ["formatVersion", "connections", "extensions"],
          properties: {
            formatVersion: { const: "1" },
            connections: { type: "array", maxItems: 0 },
            extensions,
          },
        },
        overlayManager: {
          type: "object",
          additionalProperties: false,
          required: ["formatVersion", "overlays", "extensions"],
          properties: {
            formatVersion: { const: "1" },
            overlays: { type: "array", maxItems: 0 },
            extensions,
          },
        },
      },
    },
    domainGroups: { type: "array", maxItems: 0 },
    embeddedAssets: { type: "array", maxItems: 0 },
    viewState: { type: "null" },
    extensions,
  },
} as const;

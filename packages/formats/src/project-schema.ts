export const PROJECT_MIME = "application/vnd.tessera.project+json";
export const PROJECT_EXTENSION = ".tessera-project.json";

export const extensionsSchema = {
  type: "object",
  additionalProperties: true,
} as const;
const extensions = extensionsSchema;
const color = { type: "string", pattern: "^#[0-9A-Fa-f]{8}$" } as const;
export const uuidSchema = { type: "string", format: "uuid" } as const;
const uuid = uuidSchema;
export const semVerSchema = {
  type: "string",
  pattern:
    "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$",
} as const;
const namespacedIdPattern = "^[a-z][a-z0-9-]*(?:\\.[a-z][a-z0-9-]*)+$";
export const moduleIdSchema = {
  type: "string",
  minLength: 3,
  maxLength: 128,
  pattern: namespacedIdPattern,
} as const;
export const layerIdSchema = moduleIdSchema;
export const elementIdSchema = {
  type: "string",
  maxLength: 192,
  pattern:
    "^[a-z][a-z0-9-]*(?:\\.[a-z][a-z0-9-]*)+:[a-z][a-z0-9-]*(?:\\.[a-z][a-z0-9-]*)*$",
} as const;
const canonicalCoordinate = "(?:0|[1-9][0-9]{0,4})";
export const cellIdSchema = {
  type: "string",
  pattern: `^cell:(square|hex-pointy):${canonicalCoordinate}:${canonicalCoordinate}$`,
} as const;
const cellId = cellIdSchema;
export const edgeIdSchema = {
  type: "string",
  pattern: `^edge:(square|hex-pointy):${canonicalCoordinate}:${canonicalCoordinate}(?:\\|${canonicalCoordinate}:${canonicalCoordinate}|\\|boundary:(?:top|right|bottom|left|upper-right|lower-right|lower-left|upper-left))$`,
} as const;
const instanceBase = {
  instanceId: uuid,
  attributes: { type: "object", additionalProperties: true },
  extensions,
} as const;
export const layerInstanceSchema = {
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
    elementId: elementIdSchema,
    layerId: layerIdSchema,
    styleOverrides: {
      type: "object",
      additionalProperties: true,
    },
  },
} as const;
const cellLayerInstance = layerInstanceSchema;
const edgeLayerInstance = layerInstanceSchema;

export const mapPointSchema = {
  type: "object",
  additionalProperties: false,
  required: ["x", "y"],
  properties: {
    x: { type: "number" },
    y: { type: "number" },
  },
} as const;
const mapPoint = mapPointSchema;
const connectionEndpoint = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "cellId", "extensions"],
      properties: { kind: { const: "cell-center" }, cellId, extensions },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "edgeId", "extensions"],
      properties: {
        kind: { const: "edge-midpoint" },
        edgeId: edgeIdSchema,
        extensions,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "point", "extensions"],
      properties: { kind: { const: "map-point" }, point: mapPoint, extensions },
    },
  ],
} as const;
const connectionStyle = {
  type: "object",
  additionalProperties: true,
} as const;
const connectionCommon = {
  connectionId: uuid,
  elementId: elementIdSchema,
  layerId: layerIdSchema,
  start: connectionEndpoint,
  end: connectionEndpoint,
  styleOverrides: connectionStyle,
  attributes: { type: "object", additionalProperties: true },
  label: { type: ["string", "null"], maxLength: 4096 },
  extensions,
} as const;
const lineConnection = {
  type: "object",
  additionalProperties: false,
  required: [
    "kind",
    "connectionId",
    "elementId",
    "layerId",
    "start",
    "end",
    "styleOverrides",
    "attributes",
    "label",
    "extensions",
  ],
  properties: {
    ...connectionCommon,
    kind: { const: "line" },
    elementId: connectionCommon.elementId,
  },
} as const;
const arrowConnection = {
  type: "object",
  additionalProperties: false,
  required: [...lineConnection.required, "arrowStart", "arrowEnd"],
  properties: {
    ...connectionCommon,
    kind: { const: "arrow" },
    elementId: connectionCommon.elementId,
    arrowStart: { type: "boolean" },
    arrowEnd: { type: "boolean" },
  },
} as const;
const overlayAnchor = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "cellId", "extensions"],
      properties: { kind: { const: "cell" }, cellId, extensions },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "edgeId", "extensions"],
      properties: {
        kind: { const: "edge" },
        edgeId: edgeIdSchema,
        extensions,
      },
    },
  ],
} as const;
const markerStyle = {
  type: "object",
  additionalProperties: true,
} as const;
const textStyle = {
  type: "object",
  additionalProperties: true,
} as const;
const markerAttributes = {
  type: "object",
  additionalProperties: true,
} as const;
const textAttributes = {
  type: "object",
  additionalProperties: true,
} as const;
const anchoredMarkerOverlay = {
  type: "object",
  additionalProperties: false,
  required: [
    "kind",
    "overlayId",
    "elementId",
    "layerId",
    "overlayType",
    "anchor",
    "styleOverrides",
    "attributes",
    "orderInLayer",
    "extensions",
  ],
  properties: {
    kind: { const: "anchored-overlay" },
    overlayId: uuid,
    elementId: elementIdSchema,
    layerId: layerIdSchema,
    overlayType: { const: "marker" },
    anchor: overlayAnchor,
    styleOverrides: markerStyle,
    attributes: markerAttributes,
    orderInLayer: { type: "integer", minimum: -1000000, maximum: 1000000 },
    extensions,
  },
} as const;
const anchoredTextOverlay = {
  ...anchoredMarkerOverlay,
  properties: {
    ...anchoredMarkerOverlay.properties,
    elementId: elementIdSchema,
    layerId: layerIdSchema,
    overlayType: { const: "text" },
    styleOverrides: textStyle,
    attributes: textAttributes,
  },
} as const;
const freeMarkerOverlay = {
  type: "object",
  additionalProperties: false,
  required: [
    "kind",
    "overlayId",
    "elementId",
    "layerId",
    "overlayType",
    "point",
    "styleOverrides",
    "attributes",
    "orderInLayer",
    "extensions",
  ],
  properties: {
    kind: { const: "free-overlay" },
    overlayId: uuid,
    elementId: elementIdSchema,
    layerId: layerIdSchema,
    overlayType: { const: "marker" },
    point: mapPoint,
    styleOverrides: markerStyle,
    attributes: markerAttributes,
    orderInLayer: { type: "integer", minimum: -1000000, maximum: 1000000 },
    extensions,
  },
} as const;
const freeTextOverlay = {
  ...freeMarkerOverlay,
  properties: {
    ...freeMarkerOverlay.properties,
    elementId: elementIdSchema,
    layerId: layerIdSchema,
    overlayType: { const: "text" },
    styleOverrides: textStyle,
    attributes: textAttributes,
  },
} as const;

export const projectV1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  allOf: [
    {
      if: {
        properties: { exportScope: { const: "full" } },
        required: ["exportScope"],
      },
      then: {
        properties: {
          isComplete: { const: true },
        },
      },
    },
    {
      if: {
        properties: { exportScope: { const: "partial" } },
        required: ["exportScope"],
      },
      then: {
        properties: {
          isComplete: { const: false },
          lineage: { $ref: "#/$defs/lineage" },
        },
      },
    },
  ],
  $defs: {
    bounds: {
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
    lineage: {
      type: "object",
      additionalProperties: false,
      required: [
        "sourceProjectId",
        "originScope",
        "selectionBounds",
        "includedLayerIds",
        "omittedLayerIds",
        "extensions",
      ],
      properties: {
        sourceProjectId: uuid,
        originScope: { enum: ["full", "partial"] },
        selectionBounds: { $ref: "#/$defs/bounds" },
        includedLayerIds: {
          type: "array",
          maxItems: 8192,
          uniqueItems: true,
          items: layerIdSchema,
        },
        omittedLayerIds: {
          type: "array",
          maxItems: 8192,
          uniqueItems: true,
          items: layerIdSchema,
        },
        extensions,
      },
    },
  },
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
    createdWithAppVersion: semVerSchema,
    projectId: uuid,
    name: { type: "string", minLength: 1, maxLength: 128 },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    exportScope: { enum: ["full", "partial"] },
    isComplete: { type: "boolean" },
    lineage: {
      anyOf: [{ type: "null" }, { $ref: "#/$defs/lineage" }],
    },
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
        cellSize: { type: "number", exclusiveMinimum: 0 },
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
          moduleId: moduleIdSchema,
          version: semVerSchema,
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
          layerId: layerIdSchema,
          moduleVersion: semVerSchema,
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
                  maxItems: 8192,
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
            items: edgeIdSchema,
          },
          ownedOverlayIds: {
            type: "array",
            maxItems: 16384,
            uniqueItems: true,
            items: uuid,
          },
          ownedDomainGroupIds: {
            type: "array",
            maxItems: 16384,
            uniqueItems: true,
            items: uuid,
          },
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
              maxItems: 2000000,
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
                  edgeId: edgeIdSchema,
                  adjacentCellIds: {
                    type: "array",
                    minItems: 1,
                    maxItems: 2,
                    uniqueItems: true,
                    items: cellId,
                  },
                  layerInstances: {
                    type: "array",
                    minItems: 0,
                    maxItems: 8192,
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
            connections: {
              type: "array",
              maxItems: 2000000,
              items: { oneOf: [lineConnection, arrowConnection] },
            },
            extensions,
          },
        },
        overlayManager: {
          type: "object",
          additionalProperties: false,
          required: ["formatVersion", "overlays", "extensions"],
          properties: {
            formatVersion: { const: "1" },
            overlays: {
              type: "array",
              maxItems: 2000000,
              items: {
                oneOf: [
                  anchoredMarkerOverlay,
                  anchoredTextOverlay,
                  freeMarkerOverlay,
                  freeTextOverlay,
                ],
              },
            },
            extensions,
          },
        },
      },
    },
    domainGroups: {
      type: "array",
      maxItems: 2000000,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "kind",
          "groupId",
          "elementId",
          "layerId",
          "memberCellIds",
          "attributes",
          "styleOverrides",
          "extensions",
        ],
        properties: {
          kind: { const: "domain-group" },
          groupId: uuid,
          elementId: elementIdSchema,
          layerId: layerIdSchema,
          memberCellIds: {
            type: "array",
            minItems: 1,
            maxItems: 4096,
            uniqueItems: true,
            items: cellId,
          },
          attributes: { type: "object", additionalProperties: true },
          styleOverrides: { type: "object", additionalProperties: true },
          extensions,
        },
      },
    },
    embeddedAssets: {
      type: "array",
      maxItems: 4096,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "assetId",
          "mimeType",
          "bytes",
          "encoding",
          "data",
          "extensions",
        ],
        properties: {
          assetId: uuid,
          mimeType: {
            enum: ["image/png", "image/webp", "font/woff2", "application/json"],
          },
          bytes: { type: "integer", minimum: 0, maximum: 16777216 },
          encoding: { const: "base64" },
          data: { type: "string", maxLength: 22369624 },
          extensions,
        },
      },
    },
    viewState: { type: "null" },
    extensions,
  },
} as const;

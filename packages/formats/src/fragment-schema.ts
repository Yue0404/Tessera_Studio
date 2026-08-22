import {
  extensionsSchema,
  layerIdSchema,
  moduleIdSchema,
  projectV1Schema,
  semVerSchema,
  uuidSchema,
} from "./project-schema.js";

export const FRAGMENT_MIME = "application/vnd.tessera.fragment+json";
export const FRAGMENT_EXTENSION = ".tessera-fragment.json";

const projectProperties = projectV1Schema.properties;
const chunkProperties = projectProperties.chunks.items.properties;
const managerProperties = projectProperties.managers.properties;

export const fragmentV1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: [
    "kind",
    "formatVersion",
    "createdWithAppVersion",
    "fragmentId",
    "sourceProjectId",
    "sourceGrid",
    "fragmentBounds",
    "requiredModules",
    "requiredLayerIds",
    "objects",
    "extensions",
  ],
  properties: {
    kind: { const: "tessera-fragment" },
    formatVersion: { const: "1" },
    createdWithAppVersion: semVerSchema,
    fragmentId: uuidSchema,
    sourceProjectId: uuidSchema,
    sourceGrid: {
      type: "object",
      additionalProperties: false,
      required: [
        "type",
        "orientation",
        "width",
        "height",
        "cellSize",
        "coordinateEncoding",
        "extensions",
      ],
      properties: {
        type: { enum: ["square", "hex-pointy"] },
        orientation: { enum: ["axis-aligned", "pointy"] },
        width: { type: "integer", minimum: 1, maximum: 40000 },
        height: { type: "integer", minimum: 1, maximum: 40000 },
        cellSize: { type: "number", exclusiveMinimum: 0 },
        coordinateEncoding: { const: "row-column-zero-based" },
        extensions: extensionsSchema,
      },
    },
    fragmentBounds: {
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
    requiredModules: {
      type: "array",
      minItems: 1,
      maxItems: 1024,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["moduleId", "version", "extensions"],
        properties: {
          moduleId: moduleIdSchema,
          version: semVerSchema,
          extensions: extensionsSchema,
        },
      },
    },
    requiredLayerIds: {
      type: "array",
      maxItems: 8192,
      uniqueItems: true,
      items: layerIdSchema,
    },
    objects: {
      type: "object",
      additionalProperties: false,
      required: [
        "cellOverrides",
        "edges",
        "connections",
        "overlays",
        "domainGroups",
        "embeddedAssets",
        "extensions",
      ],
      properties: {
        cellOverrides: {
          type: "array",
          maxItems: 2000000,
          items: chunkProperties.cellOverrides.items,
        },
        edges: {
          type: "array",
          maxItems: 2000000,
          items: managerProperties.edgeManager.properties.edges.items,
        },
        connections: {
          type: "array",
          maxItems: 2000000,
          items:
            managerProperties.connectionManager.properties.connections.items,
        },
        overlays: {
          type: "array",
          maxItems: 2000000,
          items: managerProperties.overlayManager.properties.overlays.items,
        },
        domainGroups: projectProperties.domainGroups,
        embeddedAssets: projectProperties.embeddedAssets,
        extensions: extensionsSchema,
      },
    },
    extensions: extensionsSchema,
  },
} as const;

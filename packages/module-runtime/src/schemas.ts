const namespaceId = "^[a-z][a-z0-9-]*(?:\\.[a-z][a-z0-9-]*)+$";
const qualifiedId =
  "^[a-z][a-z0-9-]*(?:\\.[a-z][a-z0-9-]*)+:[a-z][a-z0-9-]*(?:\\.[a-z][a-z0-9-]*)*$";
const semver =
  "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$";
const packagePath = "^(?!/)(?!.*\\\\)(?!.*(?:^|/)\\.\\.(?:/|$))[^\\u0000]+$";
const color = "^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$";

const extensionsSchema = {
  type: "object",
  additionalProperties: true,
} as const;
const localizedTextSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "key"],
      properties: {
        kind: { const: "key" },
        key: { type: "string", minLength: 1, maxLength: 256 },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "language", "text"],
      properties: {
        kind: { const: "literal" },
        language: { type: "string", minLength: 2, maxLength: 64 },
        text: { type: "string", minLength: 1, maxLength: 4096 },
      },
    },
  ],
} as const;
const appVersionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["min"],
  properties: {
    min: { type: "string", pattern: semver },
    maxExclusive: { type: "string", pattern: semver },
  },
} as const;
const packageSourceSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: { kind: { const: "built-in" } },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "publisher", "publishedAt"],
      properties: {
        kind: { const: "user-file" },
        publisher: { type: "string", minLength: 1, maxLength: 256 },
        publishedAt: { type: "string", format: "date-time" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: [
        "kind",
        "generatorId",
        "generatorVersion",
        "generatedAt",
        "sourceProduct",
        "sourceManifestPath",
        "sourceMetadata",
        "extensions",
      ],
      properties: {
        kind: { const: "generated-local" },
        generatorId: { type: "string", pattern: namespaceId, maxLength: 128 },
        generatorVersion: { type: "string", pattern: semver },
        generatedAt: { type: "string", format: "date-time" },
        sourceProduct: { type: "string", minLength: 1, maxLength: 256 },
        sourceManifestPath: {
          anyOf: [
            { type: "null" },
            { type: "string", pattern: packagePath, maxLength: 512 },
          ],
        },
        sourceMetadata: { type: "object", additionalProperties: true },
        extensions: extensionsSchema,
      },
    },
  ],
} as const;

const primitiveEnum = [
  "cell-style",
  "edge-style",
  "marker",
  "text",
  "connection",
  "domain-object",
] as const;
const anchorEnum = ["cell", "cell-center", "edge", "map-point"] as const;
const gridEnum = ["square", "hex-pointy"] as const;

const layerSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "layerId",
    "nameKey",
    "zIndex",
    "allowedPrimitives",
    "allowedAnchors",
    "defaultVisible",
    "defaultLocked",
    "defaultOpacity",
  ],
  properties: {
    layerId: {
      type: "string",
      pattern: namespaceId,
      minLength: 3,
      maxLength: 128,
    },
    nameKey: localizedTextSchema,
    zIndex: { type: "integer", minimum: 0, maximum: 4999 },
    allowedPrimitives: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { enum: primitiveEnum },
    },
    allowedAnchors: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { enum: anchorEnum },
    },
    defaultVisible: { type: "boolean" },
    defaultLocked: { type: "boolean" },
    defaultOpacity: { type: "number", minimum: 0, maximum: 1 },
    extensions: extensionsSchema,
  },
} as const;

const resourceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["resourceId", "path", "mimeType", "bytes", "license"],
  properties: {
    resourceId: { type: "string", pattern: qualifiedId, maxLength: 192 },
    path: { type: "string", pattern: packagePath, maxLength: 512 },
    mimeType: {
      enum: ["image/png", "image/webp", "font/woff2", "application/json"],
    },
    bytes: { type: "integer", minimum: 0, maximum: 67108864 },
    license: {
      type: "object",
      additionalProperties: false,
      required: ["status", "sourceName"],
      properties: {
        status: { enum: ["redistributable", "local-only", "prohibited"] },
        sourceName: { type: "string", minLength: 1, maxLength: 512 },
        sourceUrl: { type: "string", minLength: 1, maxLength: 2048 },
        licenseId: { type: "string", minLength: 1, maxLength: 128 },
      },
    },
    extensions: extensionsSchema,
  },
} as const;

export const moduleManifestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: [
    "formatVersion",
    "kind",
    "moduleId",
    "version",
    "nameKey",
    "descriptionKey",
    "authors",
    "appVersion",
    "supportedGrids",
    "dependencies",
    "layers",
    "elementFiles",
    "constraintFiles",
    "migrationFiles",
    "catalogManifestPath",
    "defaultLanguage",
    "locales",
    "resources",
    "capabilities",
    "packageSource",
  ],
  properties: {
    formatVersion: { const: "1" },
    kind: { const: "module" },
    moduleId: {
      type: "string",
      pattern: namespaceId,
      minLength: 3,
      maxLength: 128,
    },
    version: { type: "string", pattern: semver },
    nameKey: localizedTextSchema,
    descriptionKey: localizedTextSchema,
    authors: {
      type: "array",
      minItems: 1,
      maxItems: 64,
      items: { type: "string", minLength: 1, maxLength: 256 },
    },
    appVersion: appVersionSchema,
    supportedGrids: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { enum: gridEnum },
    },
    dependencies: {
      type: "array",
      maxItems: 1024,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["moduleId", "versionRange", "optional"],
        properties: {
          moduleId: { type: "string", pattern: namespaceId, maxLength: 128 },
          versionRange: { type: "string", minLength: 1, maxLength: 256 },
          optional: { type: "boolean" },
        },
      },
    },
    layers: { type: "array", minItems: 1, maxItems: 1024, items: layerSchema },
    elementFiles: {
      type: "array",
      uniqueItems: true,
      maxItems: 4096,
      items: { type: "string", pattern: packagePath, maxLength: 512 },
    },
    constraintFiles: {
      type: "array",
      uniqueItems: true,
      maxItems: 4096,
      items: { type: "string", pattern: packagePath, maxLength: 512 },
    },
    migrationFiles: {
      type: "array",
      uniqueItems: true,
      maxItems: 4096,
      items: { type: "string", pattern: packagePath, maxLength: 512 },
    },
    catalogManifestPath: {
      anyOf: [
        { type: "null" },
        { type: "string", pattern: packagePath, maxLength: 512 },
      ],
    },
    defaultLanguage: { type: "string", minLength: 2, maxLength: 64 },
    locales: {
      type: "object",
      maxProperties: 128,
      additionalProperties: {
        type: "string",
        pattern: packagePath,
        maxLength: 512,
      },
    },
    resources: { type: "array", maxItems: 65536, items: resourceSchema },
    capabilities: {
      type: "array",
      uniqueItems: true,
      items: {
        enum: [
          "cell-style",
          "edge-style",
          "anchored-overlay",
          "free-overlay",
          "connection",
          "domain-object",
          "declarative-constraints",
          "content-catalog",
        ],
      },
    },
    packageSource: packageSourceSchema,
    extensions: extensionsSchema,
  },
} as const;

export const presetManifestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: [
    "formatVersion",
    "kind",
    "presetId",
    "version",
    "nameKey",
    "descriptionKey",
    "authors",
    "appVersion",
    "modules",
    "grid",
    "layerStates",
    "panelLayout",
    "defaultLanguage",
    "locales",
    "packageSource",
    "extensions",
  ],
  properties: {
    formatVersion: { const: "1" },
    kind: { const: "preset" },
    presetId: {
      type: "string",
      pattern: namespaceId,
      minLength: 3,
      maxLength: 128,
    },
    version: { type: "string", pattern: semver },
    nameKey: localizedTextSchema,
    descriptionKey: localizedTextSchema,
    authors: {
      type: "array",
      minItems: 1,
      maxItems: 64,
      items: { type: "string", minLength: 1, maxLength: 256 },
    },
    appVersion: appVersionSchema,
    modules: {
      type: "array",
      minItems: 1,
      maxItems: 1024,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["moduleId", "versionRange", "required", "extensions"],
        properties: {
          moduleId: { type: "string", pattern: namespaceId, maxLength: 128 },
          versionRange: { type: "string", minLength: 1, maxLength: 256 },
          required: { type: "boolean" },
          extensions: extensionsSchema,
        },
      },
    },
    grid: {
      type: "object",
      additionalProperties: false,
      required: [
        "supportedGrids",
        "defaultGrid",
        "minWidth",
        "maxWidth",
        "minHeight",
        "maxHeight",
        "cellSize",
        "mapStyle",
        "extensions",
      ],
      properties: {
        supportedGrids: {
          type: "array",
          minItems: 1,
          uniqueItems: true,
          items: { enum: gridEnum },
        },
        defaultGrid: { enum: gridEnum },
        minWidth: { type: "integer", minimum: 1, maximum: 40000 },
        maxWidth: { type: "integer", minimum: 1, maximum: 40000 },
        minHeight: { type: "integer", minimum: 1, maximum: 40000 },
        maxHeight: { type: "integer", minimum: 1, maximum: 40000 },
        cellSize: { type: "number", exclusiveMinimum: 0, maximum: 4096 },
        mapStyle: { type: "object", additionalProperties: true },
        extensions: extensionsSchema,
      },
    },
    layerStates: {
      type: "array",
      maxItems: 4096,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["layerId", "visible", "locked", "opacity"],
        properties: {
          layerId: { type: "string", pattern: namespaceId, maxLength: 128 },
          visible: { type: "boolean" },
          locked: { type: "boolean" },
          opacity: { type: "number", minimum: 0, maximum: 1 },
          extensions: extensionsSchema,
        },
      },
    },
    panelLayout: {
      type: "object",
      additionalProperties: false,
      required: ["openCategories"],
      properties: {
        openCategories: {
          type: "array",
          uniqueItems: true,
          items: { type: "string", pattern: qualifiedId, maxLength: 192 },
        },
        extensions: extensionsSchema,
      },
    },
    defaultLanguage: { type: "string", minLength: 2, maxLength: 64 },
    locales: {
      type: "object",
      maxProperties: 128,
      additionalProperties: {
        type: "string",
        pattern: packagePath,
        maxLength: 512,
      },
    },
    packageSource: packageSourceSchema,
    extensions: extensionsSchema,
  },
} as const;

export const catalogManifestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: [
    "kind",
    "formatVersion",
    "moduleId",
    "moduleVersion",
    "catalogId",
    "catalogVersion",
    "catalogSource",
    "categories",
    "entries",
    "extensions",
  ],
  properties: {
    kind: { const: "content-catalog" },
    formatVersion: { const: "1" },
    moduleId: { type: "string", pattern: namespaceId, maxLength: 128 },
    moduleVersion: { type: "string", pattern: semver },
    catalogId: { type: "string", pattern: qualifiedId, maxLength: 192 },
    catalogVersion: { type: "string", pattern: semver },
    catalogSource: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["profileId", "metadata", "extensions"],
          properties: {
            profileId: { type: "string", pattern: namespaceId, maxLength: 128 },
            metadata: { type: "object", additionalProperties: true },
            extensions: extensionsSchema,
          },
        },
      ],
    },
    categories: {
      type: "array",
      maxItems: 65536,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["categoryId", "nameKey", "count", "extensions"],
        properties: {
          categoryId: { type: "string", pattern: qualifiedId, maxLength: 192 },
          nameKey: localizedTextSchema,
          count: { type: "integer", minimum: 0, maximum: 2000000 },
          extensions: extensionsSchema,
        },
      },
    },
    entries: {
      type: "array",
      maxItems: 2000000,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "elementId",
          "categoryId",
          "sourceId",
          "contentVersion",
          "resourceIds",
          "extensions",
        ],
        properties: {
          elementId: { type: "string", pattern: qualifiedId, maxLength: 192 },
          categoryId: { type: "string", pattern: qualifiedId, maxLength: 192 },
          sourceId: { type: "string", pattern: qualifiedId, maxLength: 192 },
          contentVersion: { type: "string", minLength: 1, maxLength: 128 },
          resourceIds: {
            type: "array",
            uniqueItems: true,
            items: { type: "string", pattern: qualifiedId, maxLength: 192 },
          },
          extensions: extensionsSchema,
        },
      },
    },
    extensions: extensionsSchema,
  },
} as const;

const migrationOperationSchemas = [
  {
    type: "object",
    additionalProperties: false,
    required: ["op", "fromElementId", "toElementId"],
    properties: {
      op: { const: "rename-element-id" },
      fromElementId: { type: "string", pattern: qualifiedId, maxLength: 192 },
      toElementId: { type: "string", pattern: qualifiedId, maxLength: 192 },
    },
  },
  {
    type: "object",
    additionalProperties: false,
    required: ["op", "elementId", "fromKey", "toKey"],
    properties: {
      op: { const: "rename-attribute-key" },
      elementId: { type: "string", pattern: qualifiedId, maxLength: 192 },
      fromKey: { type: "string", minLength: 1, maxLength: 128 },
      toKey: { type: "string", minLength: 1, maxLength: 128 },
    },
  },
  {
    type: "object",
    additionalProperties: false,
    required: ["op", "elementId", "attributeKey", "mapping"],
    properties: {
      op: { const: "map-enum-value" },
      elementId: { type: "string", pattern: qualifiedId, maxLength: 192 },
      attributeKey: { type: "string", minLength: 1, maxLength: 128 },
      mapping: {
        type: "object",
        minProperties: 1,
        maxProperties: 1024,
        additionalProperties: { type: ["string", "number", "boolean", "null"] },
      },
    },
  },
  {
    type: "object",
    additionalProperties: false,
    required: ["op", "elementId", "attributeKey", "value", "whenMissing"],
    properties: {
      op: { const: "fill-default" },
      elementId: { type: "string", pattern: qualifiedId, maxLength: 192 },
      attributeKey: { type: "string", minLength: 1, maxLength: 128 },
      value: true,
      whenMissing: { const: true },
    },
  },
] as const;

export const migrationManifestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: [
    "kind",
    "formatVersion",
    "moduleId",
    "migrationId",
    "fromVersionRange",
    "toVersion",
    "operations",
    "extensions",
  ],
  properties: {
    kind: { const: "module-migration" },
    formatVersion: { const: "1" },
    moduleId: { type: "string", pattern: namespaceId, maxLength: 128 },
    migrationId: { type: "string", pattern: qualifiedId, maxLength: 192 },
    fromVersionRange: { type: "string", minLength: 1, maxLength: 256 },
    toVersion: { type: "string", pattern: semver },
    operations: {
      type: "array",
      minItems: 1,
      maxItems: 4096,
      items: { oneOf: migrationOperationSchemas },
    },
    extensions: extensionsSchema,
  },
} as const;

export const localeFileSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  maxProperties: 200000,
  propertyNames: { minLength: 1, maxLength: 256 },
  additionalProperties: { type: "string", maxLength: 1048576 },
} as const;

export const civ6SourceManifestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["kind", "formatVersion", "generatorId", "files", "extensions"],
  properties: {
    kind: { const: "generated-source-manifest" },
    formatVersion: { const: "1" },
    generatorId: { const: "tessera.civ6-extractor" },
    files: {
      type: "array",
      maxItems: 65536,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["relativePath", "resourceId", "bytes", "extensions"],
        properties: {
          relativePath: {
            type: "string",
            pattern: packagePath,
            maxLength: 512,
          },
          resourceId: { type: "string", pattern: qualifiedId, maxLength: 192 },
          bytes: { type: "integer", minimum: 0, maximum: 67108864 },
          extensions: extensionsSchema,
        },
      },
    },
    extensions: extensionsSchema,
  },
} as const;

const dashPatternSchema = {
  type: "array",
  minItems: 1,
  maxItems: 16,
  items: { type: "number", minimum: 0.1, maximum: 256 },
} as const;
const cellStyleSchema = {
  type: "object",
  additionalProperties: false,
  required: ["fillColor", "fillOpacity"],
  properties: {
    fillColor: { type: "string", pattern: color },
    fillOpacity: { type: "number", minimum: 0, maximum: 1 },
    patternResourceId: { type: "string", pattern: qualifiedId, maxLength: 192 },
    patternScale: { type: "number", exclusiveMinimum: 0, maximum: 256 },
  },
} as const;
const edgeStyleSchema = {
  type: "object",
  additionalProperties: false,
  required: ["strokeColor", "strokeOpacity", "strokeWidth", "lineCap"],
  properties: {
    strokeColor: { type: "string", pattern: color },
    strokeOpacity: { type: "number", minimum: 0, maximum: 1 },
    strokeWidth: { type: "number", exclusiveMinimum: 0, maximum: 4096 },
    dashPattern: dashPatternSchema,
    lineCap: { enum: ["butt", "round", "square"] },
  },
} as const;
const markerStyleSchema = {
  type: "object",
  additionalProperties: false,
  required: ["color", "opacity", "displaySize", "rotation"],
  properties: {
    shape: { enum: ["circle", "diamond", "pin"] },
    resourceId: { type: "string", pattern: qualifiedId, maxLength: 192 },
    color: { type: "string", pattern: color },
    opacity: { type: "number", minimum: 0, maximum: 1 },
    displaySize: { type: "number", exclusiveMinimum: 0, maximum: 4096 },
    rotation: { type: "number", minimum: 0, exclusiveMaximum: 360 },
  },
} as const;
const textStyleSchema = {
  type: "object",
  additionalProperties: false,
  required: ["color", "opacity", "fontSize", "fontWeight", "align", "rotation"],
  properties: {
    color: { type: "string", pattern: color },
    opacity: { type: "number", minimum: 0, maximum: 1 },
    fontResourceId: { type: "string", pattern: qualifiedId, maxLength: 192 },
    fontSize: { type: "number", exclusiveMinimum: 0, maximum: 4096 },
    fontWeight: { enum: ["normal", "bold"] },
    align: { enum: ["left", "center", "right"] },
    rotation: { type: "number", minimum: 0, exclusiveMaximum: 360 },
    backgroundColor: { type: "string", pattern: color },
    wrapWidth: { type: "number", exclusiveMinimum: 0, maximum: 16384 },
  },
} as const;
const connectionStyleSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "strokeColor",
    "strokeOpacity",
    "strokeWidth",
    "lineCap",
    "arrowStart",
    "arrowEnd",
    "arrowSize",
  ],
  properties: {
    strokeColor: { type: "string", pattern: color },
    strokeOpacity: { type: "number", minimum: 0, maximum: 1 },
    strokeWidth: { type: "number", exclusiveMinimum: 0, maximum: 4096 },
    dashPattern: dashPatternSchema,
    lineCap: { enum: ["butt", "round", "square"] },
    arrowStart: { type: "boolean" },
    arrowEnd: { type: "boolean" },
    arrowSize: { type: "number", exclusiveMinimum: 0, maximum: 4096 },
  },
} as const;
const domainStyleSchema = {
  type: "object",
  additionalProperties: false,
  required: ["representation", "style"],
  properties: {
    representation: {
      enum: ["cell-style", "edge-style", "marker", "text", "connection"],
    },
    style: {
      oneOf: [
        cellStyleSchema,
        edgeStyleSchema,
        markerStyleSchema,
        textStyleSchema,
        connectionStyleSchema,
      ],
    },
  },
} as const;

export const elementFileSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $defs: {
    attributeProperty: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["type"],
          properties: {
            type: { const: "boolean" },
            default: { type: "boolean" },
            extensions: extensionsSchema,
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["type", "minimum", "maximum"],
          properties: {
            type: { enum: ["integer", "number"] },
            minimum: { type: "number" },
            maximum: { type: "number" },
            default: { type: "number" },
            extensions: extensionsSchema,
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["type", "minLength", "maxLength"],
          properties: {
            type: { const: "string" },
            minLength: { type: "integer", minimum: 0, maximum: 1048576 },
            maxLength: { type: "integer", minimum: 0, maximum: 1048576 },
            enum: {
              type: "array",
              minItems: 1,
              uniqueItems: true,
              items: { type: "string", maxLength: 1048576 },
            },
            default: { type: "string", maxLength: 1048576 },
            extensions: extensionsSchema,
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["type", "minItems", "maxItems", "items"],
          properties: {
            type: { const: "array" },
            minItems: { type: "integer", minimum: 0, maximum: 65536 },
            maxItems: { type: "integer", minimum: 0, maximum: 65536 },
            items: { $ref: "#/$defs/attributeProperty" },
            default: { type: "array", maxItems: 65536 },
            extensions: extensionsSchema,
          },
        },
        { $ref: "#/$defs/attributeObject" },
      ],
    },
    attributeObject: {
      type: "object",
      additionalProperties: false,
      required: ["type", "properties", "required", "additionalProperties"],
      properties: {
        type: { const: "object" },
        properties: {
          type: "object",
          maxProperties: 1024,
          additionalProperties: { $ref: "#/$defs/attributeProperty" },
        },
        required: {
          type: "array",
          uniqueItems: true,
          items: { type: "string", minLength: 1, maxLength: 128 },
        },
        additionalProperties: { const: false },
        extensions: extensionsSchema,
      },
    },
  },
  type: "array",
  maxItems: 2000000,
  items: {
    type: "object",
    additionalProperties: false,
    required: [
      "elementId",
      "categoryId",
      "nameKey",
      "descriptionKey",
      "primitive",
      "layerId",
      "anchors",
      "supportedGrids",
      "defaultStyle",
      "attributeSchema",
      "occupancy",
      "constraintIds",
      "resourceIds",
      "source",
    ],
    properties: {
      elementId: { type: "string", pattern: qualifiedId, maxLength: 192 },
      categoryId: { type: "string", pattern: qualifiedId, maxLength: 192 },
      nameKey: localizedTextSchema,
      descriptionKey: localizedTextSchema,
      primitive: { enum: primitiveEnum },
      layerId: { type: "string", pattern: namespaceId, maxLength: 128 },
      anchors: {
        type: "array",
        minItems: 1,
        uniqueItems: true,
        items: { enum: anchorEnum },
      },
      supportedGrids: {
        type: "array",
        minItems: 1,
        uniqueItems: true,
        items: { enum: gridEnum },
      },
      defaultStyle: {
        oneOf: [
          cellStyleSchema,
          edgeStyleSchema,
          markerStyleSchema,
          textStyleSchema,
          connectionStyleSchema,
          domainStyleSchema,
        ],
      },
      attributeSchema: { $ref: "#/$defs/attributeObject" },
      occupancy: {
        type: "array",
        maxItems: 64,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["slotId", "anchor", "min", "max", "conflict"],
          properties: {
            slotId: { type: "string", pattern: qualifiedId, maxLength: 192 },
            anchor: { enum: anchorEnum },
            min: { type: "integer", minimum: 0, maximum: 65536 },
            max: { type: "integer", minimum: 0, maximum: 65536 },
            conflict: { enum: ["allow", "warning", "error"] },
            extensions: extensionsSchema,
          },
        },
      },
      constraintIds: {
        type: "array",
        uniqueItems: true,
        items: { type: "string", pattern: qualifiedId, maxLength: 192 },
      },
      resourceIds: {
        type: "array",
        uniqueItems: true,
        items: { type: "string", pattern: qualifiedId, maxLength: 192 },
      },
      source: {
        type: "object",
        additionalProperties: false,
        required: ["sourceId", "rulesetId", "contentVersion", "retrievedAt"],
        properties: {
          sourceId: { type: "string", pattern: qualifiedId, maxLength: 192 },
          rulesetId: { type: "string", minLength: 1, maxLength: 192 },
          contentVersion: { type: "string", minLength: 1, maxLength: 128 },
          retrievedAt: { type: "string", format: "date-time" },
          sourceUrl: { type: "string", minLength: 1, maxLength: 2048 },
          extensions: extensionsSchema,
        },
      },
      group: {
        type: "object",
        additionalProperties: false,
        required: ["minMembers", "maxMembers", "connectivity", "memberRules"],
        properties: {
          minMembers: { type: "integer", minimum: 2, maximum: 64 },
          maxMembers: { type: "integer", minimum: 2, maximum: 64 },
          connectivity: { const: "edge" },
          memberRules: {
            type: "array",
            uniqueItems: true,
            items: { type: "string", minLength: 1, maxLength: 256 },
          },
          extensions: extensionsSchema,
        },
      },
      extensions: extensionsSchema,
    },
  },
} as const;

export const constraintFileSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $defs: {
    condition: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["op", "conditions"],
          properties: {
            op: { enum: ["all", "any"] },
            conditions: {
              type: "array",
              minItems: 1,
              maxItems: 256,
              items: { $ref: "#/$defs/condition" },
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["op", "condition"],
          properties: {
            op: { const: "not" },
            condition: { $ref: "#/$defs/condition" },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["op", "grids"],
          properties: {
            op: { const: "grid-is" },
            grids: {
              type: "array",
              minItems: 1,
              uniqueItems: true,
              items: { enum: gridEnum },
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["op", "anchors"],
          properties: {
            op: { const: "anchor-is" },
            anchors: {
              type: "array",
              minItems: 1,
              uniqueItems: true,
              items: { enum: anchorEnum },
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["op", "path", "value"],
          properties: {
            op: { const: "property-equals" },
            path: { type: "string", minLength: 1, maxLength: 256 },
            value: { type: ["string", "number", "boolean", "null"] },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["op", "path", "values"],
          properties: {
            op: { const: "property-in" },
            path: { type: "string", minLength: 1, maxLength: 256 },
            values: {
              type: "array",
              minItems: 1,
              uniqueItems: true,
              items: { type: ["string", "number", "boolean", "null"] },
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["op", "path", "min", "max"],
          properties: {
            op: { const: "number-range" },
            path: { type: "string", minLength: 1, maxLength: 256 },
            min: { type: "number" },
            max: { type: "number" },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["op", "slotId", "min", "max"],
          properties: {
            op: { const: "occupancy-count" },
            slotId: { type: "string", pattern: qualifiedId, maxLength: 192 },
            min: { type: "integer", minimum: 0, maximum: 65536 },
            max: { type: "integer", minimum: 0, maximum: 65536 },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["op", "radius", "min", "max"],
          anyOf: [{ required: ["elementId"] }, { required: ["slotId"] }],
          properties: {
            op: { const: "neighbor-count" },
            radius: { type: "integer", minimum: 1, maximum: 6 },
            elementId: { type: "string", pattern: qualifiedId, maxLength: 192 },
            slotId: { type: "string", pattern: qualifiedId, maxLength: 192 },
            min: { type: "integer", minimum: 0, maximum: 65536 },
            max: { type: "integer", minimum: 0, maximum: 65536 },
          },
        },
      ],
    },
  },
  type: "array",
  maxItems: 65536,
  items: {
    type: "object",
    additionalProperties: false,
    required: [
      "constraintId",
      "severity",
      "messageKey",
      "appliesTo",
      "maxRadius",
      "rulesetVersion",
      "condition",
    ],
    properties: {
      constraintId: { type: "string", pattern: qualifiedId, maxLength: 192 },
      severity: { enum: ["error", "warning", "info"] },
      messageKey: localizedTextSchema,
      appliesTo: {
        type: "array",
        minItems: 1,
        uniqueItems: true,
        items: { type: "string", pattern: qualifiedId, maxLength: 192 },
      },
      maxRadius: { type: "integer", minimum: 0, maximum: 6 },
      rulesetVersion: { type: "string", minLength: 1, maxLength: 128 },
      condition: { $ref: "#/$defs/condition" },
      extensions: extensionsSchema,
    },
  },
} as const;

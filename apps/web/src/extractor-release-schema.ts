const SEMVER_PATTERN =
  "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$";

/** 可选提取器 Release 目录格式；运行时由生成的 standalone validator 执行。 */
export const extractorReleaseCatalogV1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "releases"],
  properties: {
    schemaVersion: { const: "1" },
    releases: {
      type: "array",
      maxItems: 256,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "extractorId",
          "version",
          "os",
          "arch",
          "minOsBuild",
          "artifactType",
          "entrypoint",
          "bytes",
          "sha256",
          "outputModuleId",
          "outputModuleVersion",
          "minAppVersion",
          "assetUrl",
        ],
        properties: {
          extractorId: { const: "tessera.civ6-extractor" },
          version: { type: "string", pattern: SEMVER_PATTERN },
          os: { const: "windows" },
          arch: { const: "x64" },
          minOsBuild: { type: "integer", minimum: 26100 },
          artifactType: { const: "portable-zip" },
          entrypoint: {
            const: "TesseraCiv6Extractor.exe",
          },
          bytes: {
            type: "integer",
            minimum: 1,
            maximum: Number.MAX_SAFE_INTEGER,
          },
          sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
          outputModuleId: { const: "tessera.civ6" },
          outputModuleVersion: { type: "string", pattern: SEMVER_PATTERN },
          minAppVersion: { type: "string", pattern: SEMVER_PATTERN },
          assetUrl: {
            type: "string",
            maxLength: 2048,
            pattern:
              "^https://github\\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/releases/download/[^/?#]+/[^/?#]+\\.zip$",
          },
        },
      },
    },
  },
} as const;

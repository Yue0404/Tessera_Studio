import type { GridType } from "@tessera/core";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type Extensions = Readonly<Record<string, JsonValue>>;

export type LocalizedText =
  | { readonly kind: "key"; readonly key: string }
  | {
      readonly kind: "literal";
      readonly language: string;
      readonly text: string;
    };

export interface AppVersionRange {
  readonly min: string;
  readonly maxExclusive?: string;
}

export type PackageSource =
  | { readonly kind: "built-in" }
  | {
      readonly kind: "user-file";
      readonly publisher: string;
      readonly publishedAt: string;
    }
  | {
      readonly kind: "generated-local";
      readonly generatorId: string;
      readonly generatorVersion: string;
      readonly generatedAt: string;
      readonly sourceProduct: string;
      readonly sourceManifestPath: string | null;
      readonly sourceMetadata: Readonly<Record<string, JsonValue>>;
      readonly extensions: Extensions;
    };

export type ModuleCapability =
  | "cell-style"
  | "edge-style"
  | "anchored-overlay"
  | "free-overlay"
  | "connection"
  | "domain-object"
  | "declarative-constraints"
  | "content-catalog";

export type PrimitiveKind =
  | "cell-style"
  | "edge-style"
  | "marker"
  | "text"
  | "connection"
  | "domain-object";

export type AnchorKind = "cell" | "cell-center" | "edge" | "map-point";

export interface ModuleDependency {
  readonly moduleId: string;
  readonly versionRange: string;
  readonly optional: boolean;
}

export interface ModuleLayerDefinition {
  readonly layerId: string;
  readonly nameKey: LocalizedText;
  readonly zIndex: number;
  readonly allowedPrimitives: readonly PrimitiveKind[];
  readonly allowedAnchors: readonly AnchorKind[];
  readonly defaultVisible: boolean;
  readonly defaultLocked: boolean;
  readonly defaultOpacity: number;
  readonly extensions?: Extensions;
}

export interface ResourceLicense {
  readonly status: "redistributable" | "local-only" | "prohibited";
  readonly sourceName: string;
  readonly sourceUrl?: string;
  readonly licenseId?: string;
}

export interface ModuleResource {
  readonly resourceId: string;
  readonly path: string;
  readonly mimeType:
    "image/png" | "image/webp" | "font/woff2" | "application/json";
  readonly bytes: number;
  readonly license: ResourceLicense;
  readonly extensions?: Extensions;
}

export interface ModuleManifest {
  readonly formatVersion: "1";
  readonly kind: "module";
  readonly moduleId: string;
  readonly version: string;
  readonly nameKey: LocalizedText;
  readonly descriptionKey: LocalizedText;
  readonly authors: readonly string[];
  readonly appVersion: AppVersionRange;
  readonly supportedGrids: readonly GridType[];
  readonly dependencies: readonly ModuleDependency[];
  readonly layers: readonly ModuleLayerDefinition[];
  readonly elementFiles: readonly string[];
  readonly constraintFiles: readonly string[];
  readonly migrationFiles: readonly string[];
  readonly catalogManifestPath: string | null;
  readonly defaultLanguage: string;
  readonly locales: Readonly<Record<string, string>>;
  readonly resources: readonly ModuleResource[];
  readonly capabilities: readonly ModuleCapability[];
  readonly packageSource: PackageSource;
  readonly extensions?: Extensions;
}

export interface PresetModuleRequirement {
  readonly moduleId: string;
  readonly versionRange: string;
  readonly required: boolean;
  readonly extensions?: Extensions;
}

export interface PresetGridDefinition {
  readonly supportedGrids: readonly GridType[];
  readonly defaultGrid: GridType;
  readonly minWidth: number;
  readonly maxWidth: number;
  readonly minHeight: number;
  readonly maxHeight: number;
  readonly cellSize: number;
  readonly mapStyle: Readonly<Record<string, JsonValue>>;
  readonly extensions: Extensions;
}

export interface PresetLayerState {
  readonly layerId: string;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly opacity: number;
  readonly extensions?: Extensions;
}

export interface PresetManifest {
  readonly formatVersion: "1";
  readonly kind: "preset";
  readonly presetId: string;
  readonly version: string;
  readonly nameKey: LocalizedText;
  readonly descriptionKey: LocalizedText;
  readonly authors: readonly string[];
  readonly appVersion: AppVersionRange;
  readonly modules: readonly PresetModuleRequirement[];
  readonly grid: PresetGridDefinition;
  readonly layerStates: readonly PresetLayerState[];
  readonly panelLayout: {
    readonly openCategories: readonly string[];
    readonly extensions?: Extensions;
  };
  readonly defaultLanguage: string;
  readonly locales: Readonly<Record<string, string>>;
  readonly packageSource: PackageSource;
  readonly extensions: Extensions;
}

export interface AttributeSchema {
  readonly type: "object";
  readonly properties: Readonly<Record<string, AttributePropertySchema>>;
  readonly required: readonly string[];
  readonly additionalProperties: false;
  readonly extensions?: Extensions;
}

export type AttributePropertySchema =
  | {
      readonly type: "boolean";
      readonly default?: boolean;
      readonly extensions?: Extensions;
    }
  | {
      readonly type: "integer" | "number";
      readonly minimum: number;
      readonly maximum: number;
      readonly default?: number;
      readonly extensions?: Extensions;
    }
  | {
      readonly type: "string";
      readonly minLength: number;
      readonly maxLength: number;
      readonly enum?: readonly string[];
      readonly default?: string;
      readonly extensions?: Extensions;
    }
  | {
      readonly type: "array";
      readonly minItems: number;
      readonly maxItems: number;
      readonly items: AttributePropertySchema;
      readonly default?: readonly JsonValue[];
      readonly extensions?: Extensions;
    }
  | AttributeSchema;

export interface OccupancyDefinition {
  readonly slotId: string;
  readonly anchor: AnchorKind;
  readonly min: number;
  readonly max: number;
  readonly conflict: "allow" | "warning" | "error";
  readonly extensions?: Extensions;
}

export interface ElementSource {
  readonly sourceId: string;
  readonly rulesetId: string;
  readonly contentVersion: string;
  readonly retrievedAt: string;
  readonly sourceUrl?: string;
  readonly extensions?: Extensions;
}

export interface ModuleElementDefinition {
  readonly elementId: string;
  readonly categoryId: string;
  readonly nameKey: LocalizedText;
  readonly descriptionKey: LocalizedText;
  readonly primitive: PrimitiveKind;
  readonly layerId: string;
  readonly anchors: readonly AnchorKind[];
  readonly supportedGrids: readonly GridType[];
  readonly defaultStyle: Readonly<Record<string, JsonValue>>;
  readonly attributeSchema: AttributeSchema;
  readonly occupancy: readonly OccupancyDefinition[];
  readonly constraintIds: readonly string[];
  readonly resourceIds: readonly string[];
  readonly source: ElementSource;
  readonly group?: {
    readonly minMembers: number;
    readonly maxMembers: number;
    readonly connectivity: "edge";
    readonly memberRules: readonly string[];
    /** 新建时相对中心格展开的固定 footprint；缺失表示仅兼容既有实例。 */
    readonly placementPreset?: Readonly<{
      readonly square?: readonly {
        readonly row: number;
        readonly column: number;
      }[];
      readonly "hex-pointy"?: readonly {
        readonly q: number;
        readonly r: number;
      }[];
    }>;
    readonly extensions?: Extensions;
  };
  readonly extensions?: Extensions;
}

export type ConstraintCondition =
  | {
      readonly op: "all" | "any";
      readonly conditions: readonly ConstraintCondition[];
    }
  | { readonly op: "not"; readonly condition: ConstraintCondition }
  | { readonly op: "grid-is"; readonly grids: readonly GridType[] }
  | { readonly op: "anchor-is"; readonly anchors: readonly AnchorKind[] }
  | {
      readonly op: "property-equals";
      readonly path: string;
      readonly value: JsonPrimitive;
    }
  | {
      readonly op: "property-in";
      readonly path: string;
      readonly values: readonly JsonPrimitive[];
    }
  | {
      readonly op: "number-range";
      readonly path: string;
      readonly min: number;
      readonly max: number;
    }
  | {
      readonly op: "occupancy-count";
      readonly slotId: string;
      readonly min: number;
      readonly max: number;
    }
  | {
      readonly op: "neighbor-count";
      readonly radius: number;
      readonly elementId?: string;
      readonly slotId?: string;
      readonly min: number;
      readonly max: number;
    };

export interface ModuleConstraintDefinition {
  readonly constraintId: string;
  readonly severity: "error" | "warning" | "info";
  readonly messageKey: LocalizedText;
  readonly appliesTo: readonly string[];
  readonly maxRadius: number;
  readonly rulesetVersion: string;
  readonly condition: ConstraintCondition;
  readonly extensions?: Extensions;
}

export interface ContentCatalogManifest {
  readonly kind: "content-catalog";
  readonly formatVersion: "1";
  readonly moduleId: string;
  readonly moduleVersion: string;
  readonly catalogId: string;
  readonly catalogVersion: string;
  readonly catalogSource: {
    readonly profileId: string;
    readonly metadata: Readonly<Record<string, JsonValue>>;
    readonly extensions: Extensions;
  } | null;
  readonly categories: readonly {
    readonly categoryId: string;
    readonly nameKey: LocalizedText;
    readonly count: number;
    readonly extensions: Extensions;
  }[];
  readonly entries: readonly {
    readonly elementId: string;
    readonly categoryId: string;
    readonly sourceId: string;
    readonly contentVersion: string;
    readonly resourceIds: readonly string[];
    readonly extensions: Extensions;
  }[];
  readonly extensions: Extensions;
}

export type MigrationOperation =
  | {
      readonly op: "rename-element-id";
      readonly fromElementId: string;
      readonly toElementId: string;
    }
  | {
      readonly op: "rename-attribute-key";
      readonly elementId: string;
      readonly fromKey: string;
      readonly toKey: string;
    }
  | {
      readonly op: "map-enum-value";
      readonly elementId: string;
      readonly attributeKey: string;
      readonly mapping: Readonly<Record<string, JsonPrimitive>>;
    }
  | {
      readonly op: "fill-default";
      readonly elementId: string;
      readonly attributeKey: string;
      readonly value: JsonValue;
      readonly whenMissing: true;
    };

export interface ModuleMigrationManifest {
  readonly kind: "module-migration";
  readonly formatVersion: "1";
  readonly moduleId: string;
  readonly migrationId: string;
  readonly fromVersionRange: string;
  readonly toVersion: string;
  readonly operations: readonly MigrationOperation[];
  readonly extensions: Extensions;
}

export interface Civ6SourceManifest {
  readonly kind: "generated-source-manifest";
  readonly formatVersion: "1";
  readonly generatorId: "tessera.civ6-extractor";
  readonly files: readonly {
    readonly relativePath: string;
    readonly resourceId: string;
    readonly bytes: number;
    readonly extensions: Extensions;
  }[];
  readonly extensions: Extensions;
}

export interface PackageFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface PackageFileDescriptor {
  readonly path: string;
  readonly bytes: number;
}

export type PackageByteStream = AsyncIterable<Uint8Array>;

export interface PackageFileSet {
  readonly origin: "built-in" | "user-file";
  readonly files: readonly PackageFile[];
}

export interface ExtensionPackageSource {
  readonly origin: "built-in" | "user-file";
  listFiles(signal?: AbortSignal): AsyncIterable<PackageFileDescriptor>;
  openFile(path: string, signal?: AbortSignal): PackageByteStream;
  dispose?(): void | Promise<void>;
}

/** 已完成路径与长度预检、且可重复打开文件的只读包访问器。 */
export interface PackageResourceAccess {
  readonly origin: ExtensionPackageSource["origin"];
  readonly files: readonly PackageFileDescriptor[];
  openFile(path: string, signal?: AbortSignal): PackageByteStream;
  dispose?(): void | Promise<void>;
}

export interface ResourceDecodeRequest {
  readonly path: string;
  readonly mimeType: ModuleResource["mimeType"];
  readonly bytes: number;
  readonly stream: PackageByteStream;
  readonly signal: AbortSignal | undefined;
}

/** 平台实现负责真正解码图片、字体等资源；返回前必须释放临时解码对象。 */
export interface ResourceDecodeGateway {
  validate(request: ResourceDecodeRequest): Promise<void>;
}

export interface ParsedModulePackage {
  readonly kind: "module";
  readonly artifactId: string;
  readonly version: string;
  readonly manifest: ModuleManifest;
  readonly elements: readonly ModuleElementDefinition[];
  readonly constraints: readonly ModuleConstraintDefinition[];
  readonly migrations: readonly ModuleMigrationManifest[];
  readonly catalog: ContentCatalogManifest | null;
  readonly locales: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly resources: PackageResourceAccess;
}

export interface ParsedPresetPackage {
  readonly kind: "preset";
  readonly artifactId: string;
  readonly version: string;
  readonly manifest: PresetManifest;
  readonly locales: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly resources: PackageResourceAccess;
}

export type ParsedExtensionPackage = ParsedModulePackage | ParsedPresetPackage;

export type MigrationPlan =
  | { readonly status: "not-required"; readonly steps: readonly never[] }
  | {
      readonly status: "execution-not-supported";
      readonly steps: readonly ModuleMigrationManifest[];
    };

export interface RegistryModuleState {
  readonly module: ParsedModulePackage;
  readonly optionalDependenciesMissing: readonly string[];
}

export interface RegistryPresetState {
  readonly preset: ParsedPresetPackage;
  readonly status: "available" | "missing" | "incompatible" | "corrupted";
  readonly moduleStates: readonly {
    readonly moduleId: string;
    readonly status: "available" | "missing" | "incompatible" | "corrupted";
  }[];
}

export interface PackageRegistry {
  readonly modules: ReadonlyMap<string, RegistryModuleState>;
  readonly presets: ReadonlyMap<string, RegistryPresetState>;
  readonly loadOrder: readonly string[];
  readonly basicModule: RegistryModuleState;
}

export type PackageAvailability =
  "enabled" | "available" | "missing" | "incompatible" | "corrupted";

export interface PackageChoice {
  readonly moduleId: string;
  readonly version: string;
  readonly required: boolean;
  readonly supportedGrids: readonly GridType[];
  readonly appVersion: AppVersionRange;
  readonly status: PackageAvailability;
  readonly nameKey: string;
  readonly statusKey: string;
}

import {
  cellPolygon,
  domainGroupGeometry,
  DomainGroupError,
  edgeSegment,
  markerLabelFontSize,
  markerLabelPoint,
  parseCellId,
  projectTextContentValid,
  projectConnectionEndpointPoint,
  type EditorStore,
  type ModuleConnectionEndpoint,
  type ModuleRuntimeInstance,
} from "@tessera/core";
import {
  BASIC_MODULE_PACKAGE,
  resolveLocalizedText,
  validateElementFile,
  type AttributePropertySchema,
  type AttributeSchema,
  type JsonValue,
  type ModuleElementDefinition,
  type ParsedExtensionPackage,
  type ParsedModulePackage,
} from "@tessera/module-runtime";
import {
  GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER,
  arrowPolygon,
  arrowShaftSegment,
  domainMapShapeGeometry,
  genericOverlayPoint,
  type GenericModuleVisualDescriptor,
} from "@tessera/renderer";
import { genericModuleResourceKey } from "@tessera/renderer/generic-module-assets";
import type {
  VisualExportCaptureOptions,
  VisualPrimitive,
} from "@tessera/renderer/visual-export";
import {
  ProjectModuleRuleEvaluator,
  type ProjectRuleHint,
} from "./module-rule-evaluator.js";
import type { ProjectModuleResourceRuntime } from "./project-module-resource-runtime.js";

export type ModuleElementCategory =
  "cell" | "edge" | "object" | "overlay" | "connection";
export type ModuleElementDisabledReason =
  | "grid-unsupported"
  | "layer-unavailable"
  | "layer-readonly"
  | "primitive-unsupported"
  | "anchor-unsupported"
  | "resource-style-unsupported"
  | "text-attribute-unsupported"
  | "required-attribute-missing";

export interface ActiveProjectModuleElement {
  readonly moduleId: string;
  readonly moduleVersion: string;
  readonly moduleDisplayName: string;
  readonly categoryId: string;
  readonly categoryDisplayName: string;
  readonly category: ModuleElementCategory;
  readonly primitive: ModuleElementDefinition["primitive"];
  readonly elementId: string;
  readonly displayName: string;
  readonly description: string;
  readonly disabledReason: ModuleElementDisabledReason | null;
  readonly definition: ModuleElementDefinition;
}

export class ActiveProjectModuleError extends Error {
  constructor(
    readonly code:
      | ModuleElementDisabledReason
      | "element-unavailable"
      | "attribute-invalid"
      | "style-override-invalid"
      | DomainGroupError["code"],
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(code);
    this.name = "ActiveProjectModuleError";
  }
}

function enabledModuleVersions(
  store: EditorStore,
): ReadonlyMap<string, string> {
  const document = store.state.formatSource.opaqueDocument;
  if (document === null || typeof document !== "object") return new Map();
  const modules = (document as { readonly modules?: unknown }).modules;
  if (!Array.isArray(modules)) return new Map();
  return new Map(
    modules.flatMap((candidate) => {
      if (
        candidate === null ||
        typeof candidate !== "object" ||
        typeof (candidate as { moduleId?: unknown }).moduleId !== "string" ||
        typeof (candidate as { version?: unknown }).version !== "string"
      )
        return [];
      const item = candidate as { moduleId: string; version: string };
      return [[item.moduleId, item.version] as const];
    }),
  );
}

function displayText(
  text: ModuleElementDefinition["nameKey"],
  language: string,
  module: ParsedModulePackage,
): string {
  // literal 是模块明确提供的单语言直填，不因当前界面语言不同而丢失可发现性。
  if (text.kind === "literal") return text.text;
  return resolveLocalizedText(
    text,
    language,
    module.locales,
    module.manifest.defaultLanguage,
  );
}

function categoryDisplayName(
  module: ParsedModulePackage,
  definition: ModuleElementDefinition,
  language: string,
): string {
  const category = module.catalog?.categories.find(
    (item) => item.categoryId === definition.categoryId,
  );
  return category === undefined
    ? definition.categoryId
    : displayText(category.nameKey, language, module);
}

function categoryFor(element: ModuleElementDefinition): ModuleElementCategory {
  if (element.primitive === "cell-style") return "cell";
  if (element.primitive === "edge-style") return "edge";
  if (element.primitive === "connection") return "connection";
  if (element.primitive === "domain-object") return "object";
  return "overlay";
}

function exposedElements(module: ParsedModulePackage) {
  // 无固定预设的旧 domain-object 只用于恢复既有实例，不再进入可放置目录。
  const placeable = module.elements.filter(
    (item) =>
      item.primitive !== "domain-object" ||
      item.group?.placementPreset !== undefined,
  );
  // 初始模块其余基础元素仍只走既有专用管理器。
  return module.artifactId === "tessera.basic"
    ? placeable.filter((item) => item.primitive === "domain-object")
    : placeable;
}

function runtimeKindFor(
  element: ModuleElementDefinition,
): ModuleRuntimeInstance["kind"] {
  if (element.primitive === "cell-style") return "cell";
  if (element.primitive === "edge-style") return "edge";
  if (element.primitive === "connection") return "connection";
  if (element.primitive === "domain-object") return "domain-group";
  return "overlay";
}

function styleKeysForPrimitive(
  primitive:
    | Exclude<ModuleElementDefinition["primitive"], "domain-object">
    | "map-shape",
): readonly string[] {
  return primitive === "cell-style"
    ? ["fillColor", "fillOpacity", "patternResourceId", "patternScale"]
    : primitive === "edge-style"
      ? [
          "strokeColor",
          "strokeOpacity",
          "strokeWidth",
          "dashPattern",
          "lineCap",
        ]
      : primitive === "marker"
        ? ["shape", "color", "opacity", "displaySize", "rotation", "resourceId"]
        : primitive === "text"
          ? [
              "color",
              "opacity",
              "fontSize",
              "fontWeight",
              "align",
              "rotation",
              "backgroundColor",
              "wrapWidth",
              "fontResourceId",
            ]
          : primitive === "connection"
            ? [
                "strokeColor",
                "strokeOpacity",
                "strokeWidth",
                "lineCap",
                "dashPattern",
                "arrowStart",
                "arrowEnd",
                "arrowSize",
              ]
            : primitive === "map-shape"
              ? [
                  "shape",
                  "fillColor",
                  "fillOpacity",
                  "strokeColor",
                  "strokeOpacity",
                  "strokeWidth",
                  "sizeScale",
                  "rotation",
                ]
              : [];
}

function domainRepresentation(
  element: ModuleElementDefinition,
): "cell-style" | "edge-style" | "marker" | "text" | "map-shape" | null {
  if (element.primitive !== "domain-object") return null;
  const representation = element.defaultStyle.representation;
  return representation === "cell-style" ||
    representation === "edge-style" ||
    representation === "marker" ||
    representation === "text" ||
    representation === "map-shape"
    ? representation
    : null;
}

function allowedStyleKeys(element: ModuleElementDefinition): readonly string[] {
  const primitive =
    element.primitive === "domain-object"
      ? domainRepresentation(element)
      : element.primitive;
  return primitive === null ? [] : styleKeysForPrimitive(primitive);
}

function supportedStyle(element: ModuleElementDefinition): boolean {
  const allowed = allowedStyleKeys(element);
  const style =
    element.primitive === "domain-object"
      ? element.defaultStyle.style
      : element.defaultStyle;
  return (
    style !== null &&
    typeof style === "object" &&
    !Array.isArray(style) &&
    Object.keys(style).every((key) => allowed.includes(key))
  );
}

function normalizedDashPattern(value: unknown): readonly number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const pattern = value.filter(
    (item): item is number => typeof item === "number",
  );
  return pattern.length > 0 ? pattern : undefined;
}

function defaultForProperty(
  schema: AttributePropertySchema,
): JsonValue | undefined {
  if ("default" in schema && schema.default !== undefined)
    return structuredClone(schema.default);
  if (schema.type !== "object") return undefined;
  const nested = defaultsForSchema(schema);
  return nested.missingRequired.length === 0 ? nested.attributes : undefined;
}

function defaultsForSchema(schema: AttributeSchema): {
  readonly attributes: Record<string, JsonValue>;
  readonly missingRequired: readonly string[];
} {
  const attributes: Record<string, JsonValue> = {};
  const missingRequired: string[] = [];
  const required = new Set(schema.required);
  for (const [key, property] of Object.entries(schema.properties)) {
    const value = defaultForProperty(property);
    if (value !== undefined) attributes[key] = value;
    else if (required.has(key)) missingRequired.push(key);
  }
  return { attributes, missingRequired };
}

function disabledReason(
  store: EditorStore,
  module: ParsedModulePackage,
  element: ModuleElementDefinition,
): ModuleElementDisabledReason | null {
  if (!element.supportedGrids.includes(store.state.grid.type))
    return "grid-unsupported";
  const layer = store.state.layers.get(element.layerId);
  if (layer === undefined || layer.moduleVersion !== module.version)
    return "layer-unavailable";
  if (layer.runtimeStatus === "missing" || layer.locked || !layer.visible)
    return "layer-readonly";
  if (
    element.primitive === "text" ||
    domainRepresentation(element) === "text"
  ) {
    const text = element.attributeSchema.properties.text;
    if (
      text?.type !== "string" ||
      text.maxLength === undefined ||
      text.maxLength > 256
    )
      return "text-attribute-unsupported";
  }
  if (!layer.allowedKinds.includes(runtimeKindFor(element)))
    return "primitive-unsupported";
  if (!supportedStyle(element)) return "primitive-unsupported";
  const requiredAnchor =
    element.primitive === "cell-style"
      ? "cell"
      : element.primitive === "edge-style"
        ? "edge"
        : null;
  if (requiredAnchor !== null && !element.anchors.includes(requiredAnchor))
    return "anchor-unsupported";
  if (element.anchors.length === 0) return "anchor-unsupported";
  const missingRequired = defaultsForSchema(
    element.attributeSchema,
  ).missingRequired.filter(
    (key) => !(element.primitive === "text" && key === "text"),
  );
  if (missingRequired.length > 0) return "required-attribute-missing";
  return null;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return (
    typeof value === "object" &&
    Object.values(value as Record<string, unknown>).every(isJsonValue)
  );
}

function textContentValid(
  element: ModuleElementDefinition,
  attributes: Readonly<Record<string, JsonValue>>,
): boolean {
  const representation =
    element.primitive === "domain-object"
      ? domainRepresentation(element)
      : element.primitive;
  if (representation === "text") {
    const value = attributes.text;
    return typeof value === "string" && moduleTextContentValid(value);
  }
  if (representation !== "marker" || attributes.label === undefined)
    return true;
  return (
    element.attributeSchema.properties.label?.type === "string" &&
    typeof attributes.label === "string" &&
    moduleTextContentValid(attributes.label)
  );
}

/** 模块标记只有显式声明 label 字符串属性时，才获得附文语义。 */
function markerLabelValue(
  element: ModuleElementDefinition,
  attributes: Readonly<Record<string, unknown>>,
): string | null {
  return element.attributeSchema.properties.label?.type === "string" &&
    typeof attributes.label === "string" &&
    moduleTextContentValid(attributes.label)
    ? attributes.label
    : null;
}

export function moduleTextContentValid(value: string): boolean {
  return projectTextContentValid(value);
}

function valueMatchesSchema(
  value: JsonValue,
  schema: AttributePropertySchema,
): boolean {
  if (schema.type === "boolean") return typeof value === "boolean";
  if (schema.type === "integer")
    return (
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= schema.minimum &&
      value <= schema.maximum
    );
  if (schema.type === "number")
    return (
      typeof value === "number" &&
      value >= schema.minimum &&
      value <= schema.maximum
    );
  if (schema.type === "string")
    return (
      typeof value === "string" &&
      value.length >= schema.minLength &&
      value.length <= schema.maxLength &&
      (schema.enum === undefined || schema.enum.includes(value))
    );
  if (schema.type === "array")
    return (
      Array.isArray(value) &&
      value.length >= schema.minItems &&
      value.length <= schema.maxItems &&
      value.every((item) => valueMatchesSchema(item, schema.items))
    );
  if (schema.type === "object") {
    if (value === null || Array.isArray(value) || typeof value !== "object")
      return false;
    return attributesMatchSchema(value as Record<string, JsonValue>, schema);
  }
  return false;
}

function attributesMatchSchema(
  attributes: Readonly<Record<string, JsonValue>>,
  schema: AttributeSchema,
): boolean {
  if (
    Object.keys(attributes).some((key) => schema.properties[key] === undefined)
  )
    return false;
  if (schema.required.some((key) => attributes[key] === undefined))
    return false;
  return Object.entries(attributes).every(([key, value]) => {
    const property = schema.properties[key];
    return property !== undefined && valueMatchesSchema(value, property);
  });
}

function endpointAnchorSupported(
  element: ModuleElementDefinition,
  endpoint: ModuleConnectionEndpoint,
): boolean {
  return endpoint.kind === "cell-center"
    ? element.anchors.includes("cell-center") ||
        element.anchors.includes("cell")
    : endpoint.kind === "edge-midpoint"
      ? element.anchors.includes("edge")
      : element.anchors.includes("map-point");
}

function instanceContractMatches(
  store: EditorStore,
  element: ModuleElementDefinition,
  instance: ModuleRuntimeInstance,
): boolean {
  if (
    instance.elementId !== element.elementId ||
    instance.layerId !== element.layerId ||
    !element.supportedGrids.includes(store.state.grid.type) ||
    store.state.layers.get(instance.layerId)?.runtimeStatus === "missing"
  )
    return false;
  if (instance.kind === "cell")
    return (
      element.primitive === "cell-style" && element.anchors.includes("cell")
    );
  if (instance.kind === "edge")
    return (
      element.primitive === "edge-style" && element.anchors.includes("edge")
    );
  if (instance.kind === "overlay") {
    if (element.primitive !== "marker" && element.primitive !== "text")
      return false;
    if (instance.overlayType !== element.primitive) return false;
    if (instance.objectKind === "free-overlay")
      return (
        instance.point !== undefined && element.anchors.includes("map-point")
      );
    if (instance.anchor?.kind === "cell")
      return (
        element.anchors.includes("cell") ||
        element.anchors.includes("cell-center")
      );
    return instance.anchor?.kind === "edge" && element.anchors.includes("edge");
  }
  if (instance.kind === "connection") {
    if (element.primitive !== "connection") return false;
    const arrow =
      element.defaultStyle.arrowStart === true ||
      element.defaultStyle.arrowEnd === true;
    return (
      instance.objectKind === (arrow ? "arrow" : "line") &&
      endpointAnchorSupported(element, instance.start) &&
      endpointAnchorSupported(element, instance.end)
    );
  }
  if (
    instance.kind !== "domain-group" ||
    element.primitive !== "domain-object" ||
    element.group === undefined
  )
    return false;
  try {
    domainGroupGeometry(store.state.grid, instance.memberCellIds, {
      minMembers: element.group.minMembers,
      maxMembers: element.group.maxMembers,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 精确包恢复后的第二道契约门：格式层只知道载体结构，这里用真实 element 定义
 * 重验 primitive/layer/grid/anchor/schema。调用方必须在保存候选和切换 Store 前执行。
 */
export function validateActiveProjectModuleInstances(
  store: EditorStore,
  packages: readonly ParsedExtensionPackage[],
): void {
  const enabled = enabledModuleVersions(store);
  const exactModules = new Map(
    packages
      .filter(
        (item): item is ParsedModulePackage =>
          item.kind === "module" &&
          (item.artifactId === "tessera.basic" ||
            enabled.get(item.artifactId) === item.version),
      )
      .map((module) => [`${module.artifactId}@${module.version}`, module]),
  );
  for (const instance of store.state.moduleInstances.values()) {
    // 缺包实例保持 opaque 只读；重装精确包后会在下一次恢复进入严格校验。
    if (instance.runtimeStatus === "missing") continue;
    const moduleId = instance.elementId.split(":", 1)[0] ?? "";
    const version = enabled.get(moduleId);
    const module =
      version === undefined
        ? undefined
        : exactModules.get(`${moduleId}@${version}`);
    // 包目录与 Store 在 React 提交时可能短暂分两步换代；精确包缺失属于可保留的
    // tolerant 状态，不能把已打开工程击穿。精确包存在时仍必须完整重验实例。
    if (module === undefined) continue;
    const element = module.elements.find(
      (item) => item.elementId === instance.elementId,
    );
    if (element === undefined)
      throw new ActiveProjectModuleError("element-unavailable", {
        instanceId: instance.instanceId,
        elementId: instance.elementId,
      });
    if (
      instance.kind === "domain-group" &&
      element.primitive === "domain-object" &&
      element.group !== undefined
    ) {
      try {
        domainGroupGeometry(store.state.grid, instance.memberCellIds, {
          minMembers: element.group.minMembers,
          maxMembers: element.group.maxMembers,
        });
      } catch (error) {
        if (error instanceof DomainGroupError)
          throw new ActiveProjectModuleError(error.code, {
            instanceId: instance.instanceId,
            ...error.details,
          });
        throw error;
      }
    }
    if (!instanceContractMatches(store, element, instance))
      throw new ActiveProjectModuleError("primitive-unsupported", {
        instanceId: instance.instanceId,
        elementId: instance.elementId,
      });
    if (
      !attributesMatchSchema(
        instance.attributes as Readonly<Record<string, JsonValue>>,
        element.attributeSchema,
      ) ||
      !textContentValid(
        element,
        instance.attributes as Readonly<Record<string, JsonValue>>,
      )
    )
      throw new ActiveProjectModuleError("attribute-invalid", {
        instanceId: instance.instanceId,
      });
    normalizeStyleOverrides(element, instance.styleOverrides);
  }
}

function normalizeStyleOverrides(
  definition: ModuleElementDefinition,
  overrides: Readonly<Record<string, unknown>>,
): Record<string, JsonValue> {
  const normalized: Record<string, JsonValue> = {};
  const allowed = allowedStyleKeys(definition);
  for (const [key, value] of Object.entries(overrides)) {
    if (!allowed.includes(key) || !isJsonValue(value))
      throw new ActiveProjectModuleError("style-override-invalid", { key });
    normalized[key] = structuredClone(value);
  }
  try {
    validateElementFile(
      [
        {
          ...definition,
          defaultStyle:
            definition.primitive === "domain-object"
              ? {
                  ...definition.defaultStyle,
                  style: {
                    ...(definition.defaultStyle.style as Readonly<
                      Record<string, JsonValue>
                    >),
                    ...normalized,
                  },
                }
              : { ...definition.defaultStyle, ...normalized },
        },
      ],
      `runtime-style/${definition.elementId}`,
    );
  } catch {
    throw new ActiveProjectModuleError("style-override-invalid", {
      elementId: definition.elementId,
    });
  }
  return normalized;
}

export class ActiveProjectModuleSession {
  readonly #store: EditorStore;
  readonly #elements: readonly ActiveProjectModuleElement[];
  readonly #byId: ReadonlyMap<string, ActiveProjectModuleElement>;
  readonly #moduleByElementId: ReadonlyMap<string, ParsedModulePackage>;
  readonly #ruleEvaluator: ProjectModuleRuleEvaluator;

  constructor(
    store: EditorStore,
    packages: readonly ParsedExtensionPackage[],
    language: string,
  ) {
    this.#store = store;
    const availablePackages = packages.some(
      (item) => item.kind === "module" && item.artifactId === "tessera.basic",
    )
      ? packages
      : [BASIC_MODULE_PACKAGE, ...packages];
    validateActiveProjectModuleInstances(store, availablePackages);
    const enabled = enabledModuleVersions(store);
    const modules = availablePackages.filter(
      (item): item is ParsedModulePackage =>
        item.kind === "module" &&
        (item.artifactId === "tessera.basic" ||
          enabled.get(item.artifactId) === item.version),
    );
    this.#elements = Object.freeze(
      modules
        .flatMap((module) =>
          exposedElements(module).map((definition) => ({
            moduleId: module.artifactId,
            moduleVersion: module.version,
            moduleDisplayName: displayText(
              module.manifest.nameKey,
              language,
              module,
            ),
            categoryId: definition.categoryId,
            categoryDisplayName: categoryDisplayName(
              module,
              definition,
              language,
            ),
            category: categoryFor(definition),
            primitive: definition.primitive,
            elementId: definition.elementId,
            displayName: displayText(definition.nameKey, language, module),
            description: displayText(
              definition.descriptionKey,
              language,
              module,
            ),
            disabledReason: disabledReason(store, module, definition),
            definition,
          })),
        )
        .sort(
          (left, right) =>
            left.moduleId.localeCompare(right.moduleId) ||
            left.categoryId.localeCompare(right.categoryId) ||
            left.displayName.localeCompare(right.displayName) ||
            left.elementId.localeCompare(right.elementId),
        ),
    );
    // 目录只暴露可新建元素；解析表保留无 preset 的旧元素以继续渲染既有实例。
    this.#byId = new Map(
      modules.flatMap((module) =>
        module.elements.map(
          (definition) =>
            [
              definition.elementId,
              {
                moduleId: module.artifactId,
                moduleVersion: module.version,
                moduleDisplayName: displayText(
                  module.manifest.nameKey,
                  language,
                  module,
                ),
                categoryId: definition.categoryId,
                categoryDisplayName: categoryDisplayName(
                  module,
                  definition,
                  language,
                ),
                category: categoryFor(definition),
                primitive: definition.primitive,
                elementId: definition.elementId,
                displayName: displayText(definition.nameKey, language, module),
                description: displayText(
                  definition.descriptionKey,
                  language,
                  module,
                ),
                disabledReason: disabledReason(store, module, definition),
                definition,
              } satisfies ActiveProjectModuleElement,
            ] as const,
        ),
      ),
    );
    this.#moduleByElementId = new Map(
      modules.flatMap((module) =>
        module.elements.map((element) => [element.elementId, module] as const),
      ),
    );
    this.#ruleEvaluator = new ProjectModuleRuleEvaluator(
      store,
      modules,
      language,
    );
  }

  get elements(): readonly ActiveProjectModuleElement[] {
    return this.#elements.map((element) => this.#refreshElement(element));
  }

  get(elementId: string): ActiveProjectModuleElement | undefined {
    const element = this.#byId.get(elementId);
    return element === undefined ? undefined : this.#refreshElement(element);
  }

  ruleHintsForInstance(instanceId: string): readonly ProjectRuleHint[] {
    return this.#ruleEvaluator.hintsForInstance(instanceId);
  }

  initialAttributes(elementId: string): Readonly<Record<string, JsonValue>> {
    const element = this.#requireEnabled(elementId);
    return defaultsForSchema(element.definition.attributeSchema).attributes;
  }

  effectiveStyle(
    elementId: string,
    styleOverrides: Readonly<Record<string, unknown>>,
  ): Readonly<Record<string, JsonValue>> {
    const element = this.#requireElement(elementId);
    const declaredStyle =
      element.definition.primitive === "domain-object"
        ? (element.definition.defaultStyle.style as Readonly<
            Record<string, JsonValue>
          >)
        : element.definition.defaultStyle;
    return {
      ...this.#mapStyleFallback(element.definition),
      ...declaredStyle,
      ...normalizeStyleOverrides(element.definition, styleOverrides),
    };
  }

  #resourceIdentity(
    element: ActiveProjectModuleElement,
    style: Readonly<Record<string, JsonValue>>,
    key: "patternResourceId" | "resourceId" | "fontResourceId",
    allowedMimeTypes: readonly string[],
  ) {
    const resourceId = style[key];
    if (
      typeof resourceId !== "string" ||
      !element.definition.resourceIds.includes(resourceId)
    )
      return undefined;
    const module = this.#moduleByElementId.get(element.elementId);
    const resource = module?.manifest.resources.find(
      (candidate) => candidate.resourceId === resourceId,
    );
    if (
      module === undefined ||
      !allowedMimeTypes.includes(resource?.mimeType ?? "")
    )
      return undefined;
    return {
      moduleId: module.artifactId,
      version: module.version,
      resourceId,
    } as const;
  }

  resolveVisual(
    instance: Readonly<ModuleRuntimeInstance>,
  ): GenericModuleVisualDescriptor | null {
    const placeholder = (): GenericModuleVisualDescriptor | null =>
      instance.kind === "cell"
        ? {
            kind: "cell-style",
            fillColor: GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER.primaryColor,
            fillOpacity: 0.85,
          }
        : instance.kind === "edge"
          ? {
              kind: "edge-style",
              strokeColor:
                GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER.primaryColor,
              strokeOpacity: 0.8,
              strokeWidth: Math.max(2, this.#store.state.style.gridWidth),
              lineStyle: "dashed",
            }
          : instance.kind === "overlay"
            ? {
                kind: "marker",
                shape: "diamond",
                color: GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER.primaryColor,
                opacity: 0.8,
                displaySize: Math.max(
                  12,
                  this.#store.state.grid.cellSize * 0.45,
                ),
                rotation: 0,
                label: null,
              }
            : instance.kind === "connection"
              ? {
                  kind: "connection",
                  strokeColor:
                    GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER.primaryColor,
                  strokeOpacity: 0.8,
                  strokeWidth: Math.max(2, this.#store.state.style.gridWidth),
                  arrowStart: false,
                  arrowEnd: false,
                  arrowSize: Math.max(8, this.#store.state.grid.cellSize * 0.2),
                  lineStyle: "dashed",
                }
              : instance.kind === "domain-group"
                ? {
                    kind: "cell-style",
                    fillColor:
                      GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER.primaryColor,
                    fillOpacity: 0.85,
                  }
                : null;
    if (instance.runtimeStatus === "missing") return placeholder();
    const element = this.get(instance.elementId);
    if (
      element === undefined ||
      (element.disabledReason !== null &&
        element.disabledReason !== "layer-readonly")
    )
      return placeholder();
    const style = this.effectiveStyle(
      instance.elementId,
      instance.styleOverrides,
    );
    const visualPrimitive =
      element.definition.primitive === "domain-object"
        ? domainRepresentation(element.definition)
        : element.definition.primitive;
    if (instance.kind === "domain-group" && visualPrimitive === "map-shape") {
      const {
        shape,
        fillColor,
        fillOpacity,
        strokeColor,
        strokeOpacity,
        strokeWidth,
        sizeScale,
        rotation,
      } = style;
      return (shape === "circle" ||
        shape === "square" ||
        shape === "hexagon") &&
        typeof fillColor === "string" &&
        typeof fillOpacity === "number" &&
        typeof strokeColor === "string" &&
        typeof strokeOpacity === "number" &&
        typeof strokeWidth === "number" &&
        typeof sizeScale === "number" &&
        typeof rotation === "number"
        ? {
            kind: "map-shape",
            shape,
            fillColor,
            fillOpacity,
            strokeColor,
            strokeOpacity,
            strokeWidth,
            sizeScale,
            rotation,
          }
        : null;
    }
    if (
      (instance.kind === "cell" || instance.kind === "domain-group") &&
      visualPrimitive === "cell-style"
    ) {
      const fillColor = style.fillColor;
      const fillOpacity = style.fillOpacity;
      const pattern = this.#resourceIdentity(
        element,
        style,
        "patternResourceId",
        ["image/png", "image/webp"],
      );
      const patternScale = style.patternScale;
      return typeof fillColor === "string" && typeof fillOpacity === "number"
        ? {
            kind: "cell-style",
            fillColor,
            fillOpacity,
            ...(pattern === undefined
              ? {}
              : {
                  pattern: {
                    identity: pattern,
                    scale: typeof patternScale === "number" ? patternScale : 1,
                  },
                }),
          }
        : null;
    }
    if (
      (instance.kind === "edge" || instance.kind === "domain-group") &&
      visualPrimitive === "edge-style"
    ) {
      const { strokeColor, strokeOpacity, strokeWidth, dashPattern, lineCap } =
        style;
      const normalizedDash = normalizedDashPattern(dashPattern);
      return typeof strokeColor === "string" &&
        typeof strokeOpacity === "number" &&
        typeof strokeWidth === "number" &&
        (lineCap === "butt" || lineCap === "round" || lineCap === "square")
        ? {
            kind: "edge-style",
            strokeColor,
            strokeOpacity,
            strokeWidth,
            lineStyle: normalizedDash === undefined ? "solid" : "dashed",
            ...(normalizedDash === undefined
              ? {}
              : { dashPattern: normalizedDash }),
            lineCap,
          }
        : null;
    }
    if (
      (instance.kind === "overlay" || instance.kind === "domain-group") &&
      visualPrimitive === "marker"
    ) {
      const { shape, color, opacity, displaySize, rotation } = style;
      const image = this.#resourceIdentity(element, style, "resourceId", [
        "image/png",
        "image/webp",
      ]);
      return (image !== undefined ||
        shape === "circle" ||
        shape === "diamond" ||
        shape === "pin") &&
        typeof color === "string" &&
        typeof opacity === "number" &&
        typeof displaySize === "number" &&
        typeof rotation === "number"
        ? {
            kind: "marker",
            shape:
              shape === "circle" || shape === "diamond" || shape === "pin"
                ? shape
                : "diamond",
            color,
            opacity,
            displaySize,
            rotation,
            label: markerLabelValue(element.definition, instance.attributes),
            ...(image === undefined ? {} : { image }),
          }
        : null;
    }
    if (
      (instance.kind === "overlay" || instance.kind === "domain-group") &&
      visualPrimitive === "text"
    ) {
      const {
        color,
        opacity,
        fontSize,
        fontWeight,
        align,
        rotation,
        backgroundColor,
        wrapWidth,
      } = style;
      const text = instance.attributes.text;
      const font = this.#resourceIdentity(element, style, "fontResourceId", [
        "font/woff2",
      ]);
      return typeof text === "string" &&
        typeof color === "string" &&
        typeof opacity === "number" &&
        typeof fontSize === "number" &&
        (fontWeight === "normal" || fontWeight === "bold") &&
        (align === "left" || align === "center" || align === "right") &&
        typeof rotation === "number"
        ? {
            kind: "text",
            text,
            color,
            opacity,
            fontSize,
            fontWeight,
            align,
            rotation,
            backgroundColor:
              typeof backgroundColor === "string" ? backgroundColor : null,
            wrapWidth: typeof wrapWidth === "number" ? wrapWidth : null,
            ...(font === undefined ? {} : { font }),
          }
        : null;
    }
    if (instance.kind === "connection" && visualPrimitive === "connection") {
      const {
        strokeColor,
        strokeOpacity,
        strokeWidth,
        arrowStart,
        arrowEnd,
        arrowSize,
        dashPattern,
        lineCap,
      } = style;
      const normalizedDash = normalizedDashPattern(dashPattern);
      return typeof strokeColor === "string" &&
        typeof strokeOpacity === "number" &&
        typeof strokeWidth === "number" &&
        typeof arrowStart === "boolean" &&
        typeof arrowEnd === "boolean" &&
        typeof arrowSize === "number" &&
        (lineCap === "butt" || lineCap === "round" || lineCap === "square")
        ? {
            kind: "connection",
            strokeColor,
            strokeOpacity,
            strokeWidth,
            arrowStart,
            arrowEnd,
            arrowSize,
            lineStyle: normalizedDash === undefined ? "solid" : "dashed",
            ...(normalizedDash === undefined
              ? {}
              : { dashPattern: normalizedDash }),
            lineCap,
          }
        : null;
    }
    return null;
  }

  visualExportCaptureOptions(
    resourceRuntime?: ProjectModuleResourceRuntime,
  ): VisualExportCaptureOptions {
    const elementIds = [
      ...new Set(
        [...this.#store.state.moduleInstances.values()].map(
          (instance) => instance.elementId,
        ),
      ),
    ].sort();
    return {
      requiredExtensionElementIds: elementIds,
      extensionRenderers: elementIds.map((elementId) => ({
        elementId,
        capture: (state) => this.#captureElementVisuals(state, elementId),
      })),
      ...(resourceRuntime === undefined
        ? {}
        : {
            resolveResource: (identity) =>
              resourceRuntime.resolve(genericModuleResourceKey(identity)),
            prepareResource: (identity) => resourceRuntime.load(identity),
          }),
    };
  }

  placeCell(elementId: string, cellId: string): string {
    const element = this.#requirePrimitive(elementId, "cell-style");
    const existing = this.#store.state.moduleInstances
      .valuesForCarrier("cell", cellId)
      .find(
        (instance) =>
          instance.elementId === elementId &&
          instance.layerId === element.definition.layerId,
      );
    if (existing !== undefined) return existing.instanceId;
    return this.#store.addModuleInstance({
      ...this.#baseInstance(element),
      kind: "cell",
      cellId,
    });
  }

  placeEdge(
    elementId: string,
    edgeId: string,
    adjacentCellIds: readonly string[],
  ): string {
    const element = this.#requirePrimitive(elementId, "edge-style");
    const existing = this.#store.state.moduleInstances
      .valuesForCarrier("edge", edgeId)
      .find(
        (instance) =>
          instance.elementId === elementId &&
          instance.layerId === element.definition.layerId,
      );
    if (existing !== undefined) return existing.instanceId;
    return this.#store.addModuleInstance(
      {
        ...this.#baseInstance(element),
        kind: "edge",
        edgeId,
        adjacentCellIds: [...adjacentCellIds],
      },
      [{ edgeId, adjacentCellIds }],
    );
  }

  placeOverlay(
    elementId: string,
    target:
      | { readonly kind: "cell"; readonly cellId: string }
      | {
          readonly kind: "edge";
          readonly edgeId: string;
          readonly adjacentCellIds: readonly string[];
        }
      | {
          readonly kind: "map-point";
          readonly point: { readonly x: number; readonly y: number };
        },
    textContent?: string,
  ): string {
    const element = this.#requireEnabled(elementId);
    if (
      element.definition.primitive !== "marker" &&
      element.definition.primitive !== "text"
    )
      throw new ActiveProjectModuleError("primitive-unsupported", {
        elementId,
      });
    const targetSupported =
      element.definition.anchors.includes(target.kind) ||
      (target.kind === "cell" &&
        element.definition.anchors.includes("cell-center"));
    if (!targetSupported)
      throw new ActiveProjectModuleError("anchor-unsupported", {
        elementId,
        anchor: target.kind,
      });
    const base = this.#baseInstance(element);
    const attributes =
      element.definition.primitive === "text"
        ? { ...base.attributes, text: textContent ?? "" }
        : base.attributes;
    if (
      !attributesMatchSchema(attributes, element.definition.attributeSchema) ||
      !textContentValid(element.definition, attributes)
    )
      throw new ActiveProjectModuleError("attribute-invalid", { elementId });
    const instance = {
      ...base,
      attributes,
      kind: "overlay",
      objectKind:
        target.kind === "map-point" ? "free-overlay" : "anchored-overlay",
      overlayType: element.definition.primitive,
      ...(target.kind === "map-point"
        ? { point: { ...target.point } }
        : { anchor: { ...target, extensions: {} } }),
      orderInLayer: 0,
    } as const;
    return this.#store.addModuleInstance(
      instance,
      target.kind === "edge" ? [target] : [],
    );
  }

  placeConnection(
    elementId: string,
    start: ModuleConnectionEndpoint,
    end: ModuleConnectionEndpoint,
    structuralEdges: readonly {
      readonly edgeId: string;
      readonly adjacentCellIds: readonly string[];
    }[] = [],
    label: string | null = null,
  ): string {
    const element = this.#requirePrimitive(elementId, "connection");
    if (
      !endpointAnchorSupported(element.definition, start) ||
      !endpointAnchorSupported(element.definition, end)
    )
      throw new ActiveProjectModuleError("anchor-unsupported", { elementId });
    const style = element.definition.defaultStyle;
    const arrowStart = style.arrowStart === true;
    const arrowEnd = style.arrowEnd === true;
    const normalizedLabel = label === null || label === "" ? null : label;
    if (normalizedLabel !== null && !moduleTextContentValid(normalizedLabel))
      throw new ActiveProjectModuleError("attribute-invalid", { elementId });
    return this.#store.addModuleInstance(
      {
        ...this.#baseInstance(element),
        kind: "connection",
        objectKind: arrowStart || arrowEnd ? "arrow" : "line",
        start: structuredClone(start),
        end: structuredClone(end),
        label: normalizedLabel,
        ...(arrowStart || arrowEnd ? { arrowStart, arrowEnd } : {}),
      },
      structuralEdges,
    );
  }

  placeDomainGroup(
    elementId: string,
    memberCellIds: readonly string[],
  ): string {
    const element = this.#requirePrimitive(elementId, "domain-object");
    const group = element.definition.group;
    if (
      group === undefined ||
      group.placementPreset?.[this.#store.state.grid.type] === undefined
    )
      throw new ActiveProjectModuleError("primitive-unsupported", {
        elementId,
      });
    let geometry;
    try {
      geometry = domainGroupGeometry(this.#store.state.grid, memberCellIds, {
        minMembers: group.minMembers,
        maxMembers: group.maxMembers,
      });
    } catch (error) {
      if (error instanceof DomainGroupError)
        throw new ActiveProjectModuleError(error.code, error.details);
      throw error;
    }
    return this.#store.addModuleInstance({
      ...this.#baseInstance(element),
      kind: "domain-group",
      memberCellIds: geometry.memberCellIds,
    });
  }

  updateDomainGroupMembers(
    instanceId: string,
    memberCellIds: readonly string[],
  ): void {
    const instance = this.#store.state.moduleInstances.get(instanceId);
    if (instance === undefined || instance.kind !== "domain-group")
      throw new ActiveProjectModuleError("element-unavailable", { instanceId });
    const element = this.#requirePrimitive(instance.elementId, "domain-object");
    const group = element.definition.group;
    if (group === undefined)
      throw new ActiveProjectModuleError("primitive-unsupported", {
        elementId: instance.elementId,
      });
    let geometry;
    try {
      geometry = domainGroupGeometry(this.#store.state.grid, memberCellIds, {
        minMembers: group.minMembers,
        maxMembers: group.maxMembers,
      });
    } catch (error) {
      if (error instanceof DomainGroupError)
        throw new ActiveProjectModuleError(error.code, error.details);
      throw error;
    }
    this.#store.updateDomainGroupMembers(instanceId, geometry.memberCellIds);
  }

  updateInstance(
    instanceId: string,
    patch: {
      readonly attributes?: Readonly<Record<string, JsonValue>>;
      readonly styleOverrides?: Readonly<Record<string, unknown>>;
      readonly label?: string | null;
    },
  ): void {
    const instance = this.#store.state.moduleInstances.get(instanceId);
    if (instance === undefined)
      throw new ActiveProjectModuleError("element-unavailable", { instanceId });
    const element = this.#requireEnabled(instance.elementId);
    if (patch.label !== undefined && instance.kind !== "connection")
      throw new ActiveProjectModuleError("attribute-invalid", { instanceId });
    const label =
      instance.kind === "connection"
        ? patch.label === undefined
          ? instance.label
          : patch.label === ""
            ? null
            : patch.label
        : undefined;
    if (label !== undefined && label !== null && !moduleTextContentValid(label))
      throw new ActiveProjectModuleError("attribute-invalid", { instanceId });
    const attributes = patch.attributes ?? instance.attributes;
    if (
      !attributesMatchSchema(
        attributes as Readonly<Record<string, JsonValue>>,
        element.definition.attributeSchema,
      ) ||
      !textContentValid(
        element.definition,
        attributes as Readonly<Record<string, JsonValue>>,
      )
    )
      throw new ActiveProjectModuleError("attribute-invalid", { instanceId });
    this.#store.updateModuleInstance(instanceId, {
      attributes,
      styleOverrides:
        patch.styleOverrides === undefined
          ? instance.styleOverrides
          : normalizeStyleOverrides(element.definition, patch.styleOverrides),
      ...(label === undefined ? {} : { label }),
    });
  }

  restoreStyleDefaults(instanceId: string, keys: readonly string[]): void {
    const instance = this.#store.state.moduleInstances.get(instanceId);
    if (instance === undefined)
      throw new ActiveProjectModuleError("element-unavailable", { instanceId });
    const element = this.#requireEnabled(instance.elementId);
    const allowed = allowedStyleKeys(element.definition);
    if (keys.some((key) => !allowed.includes(key)))
      throw new ActiveProjectModuleError("style-override-invalid", {
        instanceId,
      });
    const omitted = new Set(keys);
    const styleOverrides = Object.fromEntries(
      Object.entries(instance.styleOverrides).filter(
        ([key]) => !omitted.has(key),
      ),
    );
    this.#store.updateModuleInstance(instanceId, { styleOverrides });
  }

  #requireElement(elementId: string): ActiveProjectModuleElement {
    const element = this.get(elementId);
    if (element === undefined)
      throw new ActiveProjectModuleError("element-unavailable", { elementId });
    return element;
  }

  #refreshElement(
    element: ActiveProjectModuleElement,
  ): ActiveProjectModuleElement {
    const module = this.#moduleByElementId.get(element.elementId);
    return module === undefined
      ? element
      : {
          ...element,
          disabledReason: disabledReason(
            this.#store,
            module,
            element.definition,
          ),
        };
  }

  #requireEnabled(elementId: string): ActiveProjectModuleElement {
    const element = this.#requireElement(elementId);
    if (element.disabledReason !== null)
      throw new ActiveProjectModuleError(element.disabledReason, { elementId });
    return element;
  }

  #requirePrimitive(
    elementId: string,
    primitive: ModuleElementDefinition["primitive"],
  ): ActiveProjectModuleElement {
    const element = this.#requireEnabled(elementId);
    if (element.definition.primitive !== primitive)
      throw new ActiveProjectModuleError("primitive-unsupported", {
        elementId,
      });
    return element;
  }

  #baseInstance(element: ActiveProjectModuleElement) {
    return {
      instanceId: crypto.randomUUID(),
      elementId: element.elementId,
      layerId: element.definition.layerId,
      attributes: structuredClone(this.initialAttributes(element.elementId)),
      // defaultStyle 属于模块事实，实例仅保存用户显式覆盖。
      styleOverrides: {},
      extensions: {},
      runtimeStatus: "available" as const,
    };
  }

  #mapStyleFallback(
    definition: ModuleElementDefinition,
  ): Readonly<Record<string, JsonValue>> {
    const primitive =
      definition.primitive === "domain-object"
        ? domainRepresentation(definition)
        : definition.primitive;
    if (primitive === "cell-style")
      return {
        fillColor: this.#store.state.style.defaultCellColor,
        fillOpacity: 1,
      };
    if (primitive === "edge-style" || primitive === "connection")
      return {
        strokeColor: this.#store.state.style.defaultEdgeColor,
        strokeOpacity: 1,
        strokeWidth: Math.max(1, this.#store.state.style.gridWidth),
        lineCap: "round",
      };
    return {};
  }

  #captureElementVisuals(
    state: Readonly<EditorStore["state"]>,
    elementId: string,
  ): readonly VisualPrimitive[] {
    const result: VisualPrimitive[] = [];
    for (const instance of state.moduleInstances.valuesForElement(elementId)) {
      const descriptor = this.resolveVisual(instance);
      const layer = state.layers.get(instance.layerId);
      if (descriptor === null || layer === undefined || !layer.visible)
        continue;
      const base = {
        layerId: instance.layerId,
        zIndex: layer.zIndex,
        orderInLayer: instance.kind === "overlay" ? instance.orderInLayer : 0,
        stableId: instance.instanceId,
        partRank: 0,
      } as const;
      const layerOpacity = layer.opacity;
      if (instance.kind === "cell" && descriptor.kind === "cell-style") {
        const coordinate = parseCellId(instance.cellId);
        result.push({
          ...base,
          kind: "polygon",
          points: cellPolygon(state.grid, coordinate.row, coordinate.column),
          fillColor: descriptor.fillColor,
          opacity: descriptor.fillOpacity * layerOpacity,
          ...(descriptor.pattern === undefined
            ? {}
            : { patternResource: descriptor.pattern }),
        });
      } else if (instance.kind === "edge" && descriptor.kind === "edge-style") {
        const segment = edgeSegment(
          state.grid,
          instance.edgeId,
          instance.adjacentCellIds,
        );
        if (segment === undefined) continue;
        result.push({
          ...base,
          kind: "stroke",
          originalStart: segment[0],
          originalEnd: segment[1],
          start: segment[0],
          end: segment[1],
          strokeColor: descriptor.strokeColor,
          strokeWidth: descriptor.strokeWidth,
          opacity: descriptor.strokeOpacity * layerOpacity,
          lineStyle: descriptor.lineStyle,
          ...(descriptor.dashPattern === undefined
            ? {}
            : { dashPattern: descriptor.dashPattern }),
          ...(descriptor.lineCap === undefined
            ? {}
            : { lineCap: descriptor.lineCap }),
        });
      } else if (instance.kind === "overlay") {
        const point = genericOverlayPoint(state, instance);
        if (point === undefined) continue;
        if (descriptor.kind === "marker") {
          result.push({
            ...base,
            kind: "marker",
            point,
            shape: descriptor.shape,
            size: descriptor.displaySize,
            rotation: descriptor.rotation,
            color: descriptor.color,
            opacity: descriptor.opacity * layerOpacity,
            ...(descriptor.image === undefined
              ? {}
              : { imageResource: descriptor.image }),
          });
          if (descriptor.label != null) {
            const fontSize = markerLabelFontSize(descriptor.displaySize);
            result.push({
              ...base,
              kind: "text",
              point: markerLabelPoint(point, descriptor.displaySize, fontSize),
              text: descriptor.label,
              fontSize,
              fontWeight: "normal",
              align: "center",
              rotation: 0,
              color: descriptor.color,
              opacity: descriptor.opacity * layerOpacity,
              backgroundColor: null,
              stableId: `${instance.instanceId}:label`,
              partRank: 1,
            });
          }
        } else if (descriptor.kind === "text")
          result.push({
            ...base,
            kind: "text",
            point,
            text: descriptor.text,
            fontSize: descriptor.fontSize,
            fontWeight: descriptor.fontWeight,
            align: descriptor.align,
            rotation: descriptor.rotation,
            color: descriptor.color,
            opacity: descriptor.opacity * layerOpacity,
            backgroundColor: descriptor.backgroundColor,
            ...(descriptor.wrapWidth === null
              ? {}
              : { wrapWidth: descriptor.wrapWidth }),
            ...(descriptor.font === undefined
              ? {}
              : { fontResource: descriptor.font }),
          });
      } else if (
        instance.kind === "connection" &&
        descriptor.kind === "connection"
      ) {
        const start = projectConnectionEndpointPoint(state, instance.start);
        const end = projectConnectionEndpointPoint(state, instance.end);
        if (start === undefined || end === undefined) continue;
        const shaft = arrowShaftSegment(
          start,
          end,
          descriptor.arrowStart,
          descriptor.arrowEnd,
          descriptor.arrowSize,
        );
        if (shaft !== null)
          result.push({
            ...base,
            kind: "stroke",
            originalStart: shaft[0],
            originalEnd: shaft[1],
            start: shaft[0],
            end: shaft[1],
            strokeColor: descriptor.strokeColor,
            strokeWidth: descriptor.strokeWidth,
            opacity: descriptor.strokeOpacity * layerOpacity,
            lineStyle: descriptor.lineStyle,
            ...(descriptor.dashPattern === undefined
              ? {}
              : { dashPattern: descriptor.dashPattern }),
            ...(descriptor.arrowStart || descriptor.arrowEnd
              ? { lineCap: "butt" as const }
              : descriptor.lineCap === undefined
                ? {}
                : { lineCap: descriptor.lineCap }),
          });
        if (descriptor.arrowStart)
          result.push({
            ...base,
            kind: "polygon",
            points: arrowPolygon(end, start, descriptor.arrowSize),
            fillColor: descriptor.strokeColor,
            opacity: descriptor.strokeOpacity * layerOpacity,
            stableId: `${instance.instanceId}:arrow-start`,
            partRank: 1,
          });
        if (descriptor.arrowEnd)
          result.push({
            ...base,
            kind: "polygon",
            points: arrowPolygon(start, end, descriptor.arrowSize),
            fillColor: descriptor.strokeColor,
            opacity: descriptor.strokeOpacity * layerOpacity,
            stableId: `${instance.instanceId}:arrow-end`,
            partRank: 2,
          });
        if (instance.label !== null)
          result.push({
            ...base,
            kind: "text",
            point: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
            text: instance.label,
            fontSize: Math.max(10, state.grid.cellSize * 0.35),
            fontWeight: "normal",
            align: "center",
            rotation: 0,
            color: descriptor.strokeColor,
            opacity: descriptor.strokeOpacity * layerOpacity,
            backgroundColor: null,
            stableId: `${instance.instanceId}:label`,
            partRank: 3,
          });
      } else if (instance.kind === "domain-group") {
        const geometry = domainGroupGeometry(
          state.grid,
          instance.memberCellIds,
        );
        if (descriptor.kind === "map-shape") {
          const points = domainMapShapeGeometry(
            state,
            instance,
            descriptor.shape,
            descriptor.sizeScale,
            descriptor.rotation,
          ).points;
          result.push({
            ...base,
            kind: "polygon",
            points,
            fillColor: descriptor.fillColor,
            opacity: descriptor.fillOpacity * layerOpacity,
          });
          result.push({
            ...base,
            kind: "outline",
            points,
            closed: true,
            strokeColor: descriptor.strokeColor,
            strokeWidth: descriptor.strokeWidth,
            opacity: descriptor.strokeOpacity * layerOpacity,
            lineStyle: "solid",
            stableId: `${instance.instanceId}:outline`,
            partRank: 1,
          });
        } else if (descriptor.kind === "cell-style") {
          geometry.memberCellIds.forEach((cellId, index) => {
            const coordinate = parseCellId(cellId);
            result.push({
              ...base,
              kind: "polygon",
              points: cellPolygon(
                state.grid,
                coordinate.row,
                coordinate.column,
              ),
              fillColor: descriptor.fillColor,
              opacity: descriptor.fillOpacity * layerOpacity,
              ...(descriptor.pattern === undefined
                ? {}
                : { patternResource: descriptor.pattern }),
              stableId: `${instance.instanceId}:cell:${cellId}`,
              partRank: index,
            });
          });
        } else if (descriptor.kind === "edge-style") {
          geometry.boundaryEdges.forEach((edge, index) => {
            const segment = edgeSegment(
              state.grid,
              edge.edgeId,
              edge.adjacentCellIds,
            );
            if (segment === undefined) return;
            result.push({
              ...base,
              kind: "stroke",
              originalStart: segment[0],
              originalEnd: segment[1],
              start: segment[0],
              end: segment[1],
              strokeColor: descriptor.strokeColor,
              strokeWidth: descriptor.strokeWidth,
              opacity: descriptor.strokeOpacity * layerOpacity,
              lineStyle: descriptor.lineStyle,
              ...(descriptor.dashPattern === undefined
                ? {}
                : { dashPattern: descriptor.dashPattern }),
              ...(descriptor.lineCap === undefined
                ? {}
                : { lineCap: descriptor.lineCap }),
              stableId: `${instance.instanceId}:edge:${edge.edgeId}`,
              partRank: index,
            });
          });
        } else if (descriptor.kind === "marker") {
          result.push({
            ...base,
            kind: "marker",
            point: geometry.center,
            shape: descriptor.shape,
            size: descriptor.displaySize,
            rotation: descriptor.rotation,
            color: descriptor.color,
            opacity: descriptor.opacity * layerOpacity,
            ...(descriptor.image === undefined
              ? {}
              : { imageResource: descriptor.image }),
          });
          if (descriptor.label != null) {
            const fontSize = markerLabelFontSize(descriptor.displaySize);
            result.push({
              ...base,
              kind: "text",
              point: markerLabelPoint(
                geometry.center,
                descriptor.displaySize,
                fontSize,
              ),
              text: descriptor.label,
              fontSize,
              fontWeight: "normal",
              align: "center",
              rotation: 0,
              color: descriptor.color,
              opacity: descriptor.opacity * layerOpacity,
              backgroundColor: null,
              stableId: `${instance.instanceId}:label`,
              partRank: 1,
            });
          }
        } else if (descriptor.kind === "text") {
          result.push({
            ...base,
            kind: "text",
            point: geometry.center,
            text: descriptor.text,
            fontSize: descriptor.fontSize,
            fontWeight: descriptor.fontWeight,
            align: descriptor.align,
            rotation: descriptor.rotation,
            color: descriptor.color,
            opacity: descriptor.opacity * layerOpacity,
            backgroundColor: descriptor.backgroundColor,
            ...(descriptor.wrapWidth === null
              ? {}
              : { wrapWidth: descriptor.wrapWidth }),
            ...(descriptor.font === undefined
              ? {}
              : { fontResource: descriptor.font }),
          });
        }
      }
    }
    return result;
  }
}

import { compare, intersects, lt, satisfies, valid, validRange } from "semver";
import { runtimeError } from "./errors.js";
import type {
  AttributePropertySchema,
  AttributeSchema,
  Civ6SourceManifest,
  ConstraintCondition,
  ContentCatalogManifest,
  LocalizedText,
  ModuleConstraintDefinition,
  ModuleElementDefinition,
  ModuleManifest,
  ModuleMigrationManifest,
  PresetManifest,
} from "./types.js";

const CURRENT_LABELS = new Set([
  "latest",
  "current",
  String.fromCodePoint(0x6700, 0x65b0, 0x7248),
  String.fromCodePoint(0x5f53, 0x524d, 0x7248, 0x672c),
]);
const CORE_PROPERTY_PATHS = new Set([
  "grid.type",
  "anchor.kind",
  "cell.row",
  "cell.column",
  "edge.side",
]);

export function assertSemVer(value: string, path: string): void {
  if (valid(value) === null)
    runtimeError("package-version-invalid", path, { value });
}

export function assertSemVerRange(value: string, path: string): void {
  if (validRange(value) === null)
    runtimeError("package-version-invalid", path, { value });
}

/** 统一比较已验证的 SemVer，避免调用方自行实现先行版本排序。 */
export function compareSemanticVersions(left: string, right: string): number {
  assertSemVer(left, "version.left");
  assertSemVer(right, "version.right");
  return compare(left, right);
}

function assertAppVersionRange(
  range: { readonly min: string; readonly maxExclusive?: string },
  path: string,
): void {
  assertSemVer(range.min, `${path}/min`);
  if (range.maxExclusive === undefined) return;
  assertSemVer(range.maxExclusive, `${path}/maxExclusive`);
  if (!lt(range.min, range.maxExclusive)) {
    runtimeError("package-version-invalid", `${path}/maxExclusive`, {
      min: range.min,
      maxExclusive: range.maxExclusive,
    });
  }
}

export function appVersionCompatible(
  appVersion: string,
  range: { readonly min: string; readonly maxExclusive?: string },
): boolean {
  assertSemVer(appVersion, "options.currentAppVersion");
  assertAppVersionRange(range, "appVersion");
  return (
    compare(appVersion, range.min) >= 0 &&
    (range.maxExclusive === undefined ||
      compare(appVersion, range.maxExclusive) < 0)
  );
}

function assertLanguage(value: string, path: string): void {
  try {
    if (Intl.getCanonicalLocales(value).length !== 1) throw new Error();
  } catch {
    runtimeError("package-locale-invalid", path, { language: value });
  }
}

function canonicalLanguage(value: string, path: string): string {
  assertLanguage(value, path);
  return Intl.getCanonicalLocales(value)[0] as string;
}

export function resolveLocalizedText(
  text: LocalizedText,
  requestedLanguage: string,
  locales: Readonly<Record<string, Readonly<Record<string, string>>>>,
  defaultLanguage: string,
): string {
  const requested = canonicalLanguage(
    requestedLanguage,
    "localizedText/requestedLanguage",
  );
  const fallback = canonicalLanguage(defaultLanguage, "defaultLanguage");
  if (text.kind === "literal") {
    if (
      canonicalLanguage(text.language, "localizedText/language") === requested
    ) {
      return text.text;
    }
    runtimeError("package-localized-key-missing", "localizedText/literal", {
      requestedLanguage: requested,
      literalLanguage: text.language,
    });
  }
  const requestedLocale = Object.entries(locales).find(
    ([language]) =>
      canonicalLanguage(language, `locales/${language}`) === requested,
  )?.[1];
  const defaultLocale = Object.entries(locales).find(
    ([language]) =>
      canonicalLanguage(language, `locales/${language}`) === fallback,
  )?.[1];
  const resolved = requestedLocale?.[text.key] ?? defaultLocale?.[text.key];
  if (resolved === undefined) {
    runtimeError("package-localized-key-missing", `localizedText/${text.key}`, {
      requestedLanguage: requested,
      defaultLanguage: fallback,
    });
  }
  return resolved;
}

export function validateLocalizedTexts(
  manifest: ModuleManifest | PresetManifest,
  locales: Readonly<Record<string, Readonly<Record<string, string>>>>,
  additionalTexts: readonly LocalizedText[],
): void {
  assertLanguage(manifest.defaultLanguage, "defaultLanguage");
  for (const language of Object.keys(manifest.locales)) {
    assertLanguage(language, `locales/${language}`);
  }
  const texts: readonly LocalizedText[] = [
    manifest.nameKey,
    manifest.descriptionKey,
    ...(manifest.kind === "module"
      ? manifest.layers.map((layer) => layer.nameKey)
      : []),
    ...additionalTexts,
  ];
  const keyed = texts.filter((text) => text.kind === "key");
  const defaultLocale = locales[manifest.defaultLanguage];
  if (keyed.length > 0 && defaultLocale === undefined) {
    runtimeError(
      "package-localized-key-missing",
      `locales/${manifest.defaultLanguage}`,
      { reason: "default-locale-missing" },
    );
  }
  for (const text of texts) {
    if (text.kind === "literal") {
      assertLanguage(text.language, "localizedText/language");
    } else if (defaultLocale?.[text.key] === undefined) {
      runtimeError(
        "package-localized-key-missing",
        `localizedText/${text.key}`,
        {
          defaultLanguage: manifest.defaultLanguage,
        },
      );
    }
  }
}

function assertUnique(values: readonly string[], path: string): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value))
      runtimeError("package-duplicate-id", `${path}/${index}`, { id: value });
    seen.add(value);
  });
}

function assertNamespaced(value: string, moduleId: string, path: string): void {
  if (!value.startsWith(`${moduleId}:`)) {
    runtimeError("package-id-namespace-invalid", path, { value, moduleId });
  }
}

function assertDefault(
  schema: AttributePropertySchema,
  value: unknown,
  path: string,
): void {
  switch (schema.type) {
    case "boolean":
      if (typeof value !== "boolean")
        runtimeError("package-attribute-schema-invalid", path);
      break;
    case "integer":
    case "number":
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        (schema.type === "integer" && !Number.isSafeInteger(value)) ||
        value < schema.minimum ||
        value > schema.maximum
      ) {
        runtimeError("package-attribute-schema-invalid", path);
      }
      break;
    case "string":
      if (
        typeof value !== "string" ||
        value.length < schema.minLength ||
        value.length > schema.maxLength ||
        (schema.enum !== undefined && !schema.enum.includes(value))
      ) {
        runtimeError("package-attribute-schema-invalid", path);
      }
      break;
    case "array":
      if (
        !Array.isArray(value) ||
        value.length < schema.minItems ||
        value.length > schema.maxItems
      ) {
        runtimeError("package-attribute-schema-invalid", path);
      }
      value.forEach((item, index) =>
        assertDefault(schema.items, item, `${path}/${index}`),
      );
      break;
    case "object":
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        runtimeError("package-attribute-schema-invalid", path);
      }
      for (const required of schema.required) {
        if (!(required in value)) {
          runtimeError(
            "package-attribute-schema-invalid",
            `${path}/${required}`,
            {
              reason: "required-property-missing",
            },
          );
        }
      }
      for (const [key, child] of Object.entries(value)) {
        const property = schema.properties[key];
        if (property === undefined) {
          runtimeError("package-attribute-schema-invalid", `${path}/${key}`, {
            reason: "unknown-property",
          });
        }
        assertDefault(property, child, `${path}/${key}`);
      }
      break;
  }
}

function validateAttributeSchema(
  schema: AttributeSchema,
  path: string,
  depth = 0,
): void {
  if (depth > 16)
    runtimeError("package-attribute-schema-invalid", path, { maxDepth: 16 });
  const propertyIds = Object.keys(schema.properties);
  assertUnique(schema.required, `${path}/required`);
  for (const required of schema.required) {
    const property = schema.properties[required];
    if (property === undefined || !("default" in property)) {
      runtimeError(
        "package-attribute-schema-invalid",
        `${path}/required/${required}`,
        {
          reason: "required-property-needs-default",
        },
      );
    }
  }
  propertyIds.forEach((key) => {
    const property = schema.properties[key];
    if (property === undefined) return;
    if ("minimum" in property && property.minimum > property.maximum) {
      runtimeError(
        "package-attribute-schema-invalid",
        `${path}/properties/${key}`,
      );
    }
    if ("minLength" in property && property.minLength > property.maxLength) {
      runtimeError(
        "package-attribute-schema-invalid",
        `${path}/properties/${key}`,
      );
    }
    if ("minItems" in property && property.minItems > property.maxItems) {
      runtimeError(
        "package-attribute-schema-invalid",
        `${path}/properties/${key}`,
      );
    }
    if (property.type === "object") {
      validateAttributeSchema(property, `${path}/properties/${key}`, depth + 1);
    }
    if ("default" in property) {
      assertDefault(
        property,
        property.default,
        `${path}/properties/${key}/default`,
      );
    }
  });
}

const STYLE_KEYS: Readonly<Record<string, ReadonlySet<string>>> = {
  "cell-style": new Set([
    "fillColor",
    "fillOpacity",
    "patternResourceId",
    "patternScale",
  ]),
  "edge-style": new Set([
    "strokeColor",
    "strokeOpacity",
    "strokeWidth",
    "dashPattern",
    "lineCap",
  ]),
  marker: new Set([
    "shape",
    "resourceId",
    "color",
    "opacity",
    "displaySize",
    "rotation",
  ]),
  text: new Set([
    "color",
    "opacity",
    "fontResourceId",
    "fontSize",
    "fontWeight",
    "align",
    "rotation",
    "backgroundColor",
    "wrapWidth",
  ]),
  connection: new Set([
    "strokeColor",
    "strokeOpacity",
    "strokeWidth",
    "dashPattern",
    "lineCap",
    "arrowStart",
    "arrowEnd",
    "arrowSize",
  ]),
};

function validateStyle(element: ModuleElementDefinition, path: string): void {
  if (element.primitive === "domain-object") {
    const style = element.defaultStyle as {
      readonly representation?: string;
      readonly style?: Readonly<Record<string, unknown>>;
    };
    const allowed =
      style.representation === undefined
        ? undefined
        : STYLE_KEYS[style.representation];
    if (allowed === undefined || style.style === undefined) {
      runtimeError("package-style-invalid", path);
    }
    for (const key of Object.keys(style.style)) {
      if (!allowed.has(key))
        runtimeError("package-style-invalid", `${path}/style/${key}`);
    }
    return;
  }
  const allowed = STYLE_KEYS[element.primitive];
  if (allowed === undefined) runtimeError("package-style-invalid", path);
  for (const key of Object.keys(element.defaultStyle)) {
    if (!allowed.has(key))
      runtimeError("package-style-invalid", `${path}/${key}`);
  }
}

function styleResourceIds(element: ModuleElementDefinition): readonly string[] {
  const style =
    element.primitive === "domain-object"
      ? ((
          element.defaultStyle as {
            readonly style?: Readonly<Record<string, unknown>>;
          }
        ).style ?? {})
      : (element.defaultStyle as Readonly<Record<string, unknown>>);
  return ["patternResourceId", "resourceId", "fontResourceId"].flatMap(
    (key) => {
      const value = style[key];
      return typeof value === "string" ? [value] : [];
    },
  );
}

function validateConstraintCondition(
  condition: ConstraintCondition,
  constraint: ModuleConstraintDefinition,
  elements: ReadonlyMap<string, ModuleElementDefinition>,
  slotIds: ReadonlySet<string>,
  path: string,
  depth = 1,
  counter: { value: number } = { value: 0 },
): void {
  counter.value += 1;
  if (depth > 16 || counter.value > 256) {
    runtimeError("package-constraint-invalid", path, {
      maxDepth: 16,
      maxNodes: 256,
    });
  }
  if (condition.op === "all" || condition.op === "any") {
    condition.conditions.forEach((child, index) =>
      validateConstraintCondition(
        child,
        constraint,
        elements,
        slotIds,
        `${path}/conditions/${index}`,
        depth + 1,
        counter,
      ),
    );
    return;
  }
  if (condition.op === "not") {
    validateConstraintCondition(
      condition.condition,
      constraint,
      elements,
      slotIds,
      `${path}/condition`,
      depth + 1,
      counter,
    );
    return;
  }
  if (
    "min" in condition &&
    "max" in condition &&
    condition.min > condition.max
  ) {
    runtimeError("package-constraint-invalid", path, {
      reason: "min-greater-than-max",
    });
  }
  if (
    condition.op === "neighbor-count" &&
    condition.radius > constraint.maxRadius
  ) {
    runtimeError("package-constraint-invalid", `${path}/radius`, {
      maxRadius: constraint.maxRadius,
    });
  }
  if (
    condition.op === "property-equals" ||
    condition.op === "property-in" ||
    condition.op === "number-range"
  ) {
    if (CORE_PROPERTY_PATHS.has(condition.path)) return;
    if (!condition.path.startsWith("attributes.")) {
      runtimeError("package-constraint-invalid", `${path}/path`, {
        propertyPath: condition.path,
      });
    }
    const key = condition.path.slice("attributes.".length);
    for (const elementId of constraint.appliesTo) {
      if (
        elements.get(elementId)?.attributeSchema.properties[key] === undefined
      ) {
        runtimeError("package-constraint-invalid", `${path}/path`, {
          propertyPath: condition.path,
          elementId,
        });
      }
    }
  }
  if (condition.op === "occupancy-count" && !slotIds.has(condition.slotId)) {
    runtimeError("package-reference-missing", `${path}/slotId`, {
      slotId: condition.slotId,
    });
  }
  if (condition.op === "neighbor-count") {
    const hasElement = condition.elementId !== undefined;
    const hasSlot = condition.slotId !== undefined;
    if (hasElement === hasSlot) {
      runtimeError("package-constraint-invalid", path, {
        reason: "neighbor-target-must-be-exclusive",
      });
    }
    if (
      condition.elementId !== undefined &&
      !elements.has(condition.elementId)
    ) {
      runtimeError("package-reference-missing", `${path}/elementId`, {
        elementId: condition.elementId,
      });
    }
    if (condition.slotId !== undefined && !slotIds.has(condition.slotId)) {
      runtimeError("package-reference-missing", `${path}/slotId`, {
        slotId: condition.slotId,
      });
    }
  }
}

export function validateModuleSemantics(
  manifest: ModuleManifest,
  elements: readonly ModuleElementDefinition[],
  constraints: readonly ModuleConstraintDefinition[],
): void {
  assertSemVer(manifest.version, "module.json/version");
  assertAppVersionRange(manifest.appVersion, "module.json/appVersion");
  manifest.dependencies.forEach((dependency, index) => {
    assertSemVerRange(
      dependency.versionRange,
      `module.json/dependencies/${index}/versionRange`,
    );
    if (dependency.moduleId === manifest.moduleId) {
      runtimeError(
        "package-dependency-cycle",
        `module.json/dependencies/${index}/moduleId`,
        {
          chain: [manifest.moduleId, manifest.moduleId],
        },
      );
    }
  });
  assertUnique(
    manifest.dependencies.map((dependency) => dependency.moduleId),
    "module.json/dependencies",
  );
  assertUnique(
    manifest.layers.map((layer) => layer.layerId),
    "module.json/layers",
  );
  assertUnique(
    manifest.resources.map((resource) => resource.resourceId),
    "module.json/resources",
  );
  const layers = new Map(
    manifest.layers.map((layer) => [layer.layerId, layer]),
  );
  const resources = new Set(
    manifest.resources.map((resource) => resource.resourceId),
  );
  const elementMap = new Map<string, ModuleElementDefinition>();
  const constraintMap = new Map<string, ModuleConstraintDefinition>();

  constraints.forEach((constraint, index) => {
    assertNamespaced(
      constraint.constraintId,
      manifest.moduleId,
      `constraints/${index}/constraintId`,
    );
    if (constraintMap.has(constraint.constraintId)) {
      runtimeError(
        "package-duplicate-id",
        `constraints/${index}/constraintId`,
        {
          id: constraint.constraintId,
        },
      );
    }
    constraintMap.set(constraint.constraintId, constraint);
  });

  elements.forEach((element, index) => {
    const path = `elements/${index}`;
    assertNamespaced(element.elementId, manifest.moduleId, `${path}/elementId`);
    assertNamespaced(
      element.categoryId,
      manifest.moduleId,
      `${path}/categoryId`,
    );
    assertNamespaced(
      element.source.sourceId,
      manifest.moduleId,
      `${path}/source/sourceId`,
    );
    if (elementMap.has(element.elementId)) {
      runtimeError("package-duplicate-id", `${path}/elementId`, {
        id: element.elementId,
      });
    }
    elementMap.set(element.elementId, element);
    const layer = layers.get(element.layerId);
    if (layer === undefined) {
      runtimeError("package-reference-cross-module", `${path}/layerId`, {
        layerId: element.layerId,
      });
    }
    if (!layer.allowedPrimitives.includes(element.primitive)) {
      runtimeError("package-style-invalid", `${path}/primitive`, {
        primitive: element.primitive,
        layerId: element.layerId,
      });
    }
    for (const anchor of element.anchors) {
      if (!layer.allowedAnchors.includes(anchor)) {
        runtimeError("package-reference-missing", `${path}/anchors`, {
          anchor,
          layerId: element.layerId,
        });
      }
    }
    for (const grid of element.supportedGrids) {
      if (!manifest.supportedGrids.includes(grid)) {
        runtimeError("package-grid-incompatible", `${path}/supportedGrids`, {
          grid,
        });
      }
    }
    element.constraintIds.forEach((id) => {
      if (!constraintMap.has(id)) {
        runtimeError("package-reference-missing", `${path}/constraintIds`, {
          id,
        });
      }
    });
    element.resourceIds.forEach((id) => {
      if (!resources.has(id)) {
        runtimeError("package-reference-missing", `${path}/resourceIds`, {
          id,
        });
      }
    });
    const declaredElementResources = new Set(element.resourceIds);
    styleResourceIds(element).forEach((id) => {
      if (!resources.has(id) || !declaredElementResources.has(id)) {
        runtimeError("package-reference-missing", `${path}/defaultStyle`, {
          id,
          reason: "style-resource-not-declared",
        });
      }
    });
    assertUnique(
      element.occupancy.map((occupancy) => occupancy.slotId),
      `${path}/occupancy`,
    );
    element.occupancy.forEach((occupancy, occupancyIndex) => {
      assertNamespaced(
        occupancy.slotId,
        manifest.moduleId,
        `${path}/occupancy/${occupancyIndex}/slotId`,
      );
      if (occupancy.min > occupancy.max) {
        runtimeError(
          "package-reference-missing",
          `${path}/occupancy/${occupancyIndex}`,
        );
      }
    });
    if (
      (element.primitive === "domain-object") !==
      (element.group !== undefined)
    ) {
      runtimeError("package-style-invalid", `${path}/group`);
    }
    if (
      element.group !== undefined &&
      element.group.minMembers > element.group.maxMembers
    ) {
      runtimeError("package-style-invalid", `${path}/group`);
    }
    validateStyle(element, `${path}/defaultStyle`);
    validateAttributeSchema(element.attributeSchema, `${path}/attributeSchema`);
  });

  const slotIds = new Set(
    elements.flatMap((element) =>
      element.occupancy.map((occupancy) => occupancy.slotId),
    ),
  );

  constraints.forEach((constraint, index) => {
    constraint.appliesTo.forEach((elementId) => {
      if (!elementMap.has(elementId)) {
        runtimeError(
          "package-reference-missing",
          `constraints/${index}/appliesTo`,
          {
            elementId,
          },
        );
      }
    });
    validateConstraintCondition(
      constraint.condition,
      constraint,
      elementMap,
      slotIds,
      `constraints/${index}/condition`,
    );
  });
}

export function validatePresetSemantics(manifest: PresetManifest): void {
  assertSemVer(manifest.version, "preset.json/version");
  assertAppVersionRange(manifest.appVersion, "preset.json/appVersion");
  assertUnique(
    manifest.modules.map((requirement) => requirement.moduleId),
    "preset.json/modules",
  );
  manifest.modules.forEach((requirement, index) =>
    assertSemVerRange(
      requirement.versionRange,
      `preset.json/modules/${index}/versionRange`,
    ),
  );
  const basic = manifest.modules.find(
    (requirement) => requirement.moduleId === "tessera.basic",
  );
  if (basic?.required !== true) {
    runtimeError("package-basic-required", "preset.json/modules", {
      presetId: manifest.presetId,
    });
  }
  if (!manifest.grid.supportedGrids.includes(manifest.grid.defaultGrid)) {
    runtimeError("package-grid-incompatible", "preset.json/grid/defaultGrid");
  }
  if (
    manifest.grid.minWidth > manifest.grid.maxWidth ||
    manifest.grid.minHeight > manifest.grid.maxHeight
  ) {
    runtimeError("package-grid-incompatible", "preset.json/grid");
  }
  assertUnique(
    manifest.layerStates.map((state) => state.layerId),
    "preset.json/layerStates",
  );
}

export function validateMigrations(
  manifest: ModuleManifest,
  migrations: readonly ModuleMigrationManifest[],
): void {
  const ids = migrations.map((migration) => migration.migrationId);
  assertUnique(ids, "migrations");
  migrations.forEach((migration, index) => {
    const path = `migrations/${index}`;
    if (migration.moduleId !== manifest.moduleId) {
      runtimeError("package-migration-invalid", `${path}/moduleId`, {
        expected: manifest.moduleId,
      });
    }
    assertNamespaced(
      migration.migrationId,
      manifest.moduleId,
      `${path}/migrationId`,
    );
    assertSemVerRange(migration.fromVersionRange, `${path}/fromVersionRange`);
    assertSemVer(migration.toVersion, `${path}/toVersion`);
    if (migration.toVersion !== manifest.version) {
      runtimeError("package-migration-invalid", `${path}/toVersion`, {
        expected: manifest.version,
      });
    }
    if (
      satisfies(migration.toVersion, migration.fromVersionRange, {
        includePrerelease: true,
      })
    ) {
      runtimeError("package-migration-cycle", `${path}/fromVersionRange`, {
        toVersion: migration.toVersion,
      });
    }
    migration.operations.forEach((operation, operationIndex) => {
      const operationPath = `${path}/operations/${operationIndex}`;
      if ("elementId" in operation) {
        assertNamespaced(
          operation.elementId,
          manifest.moduleId,
          `${operationPath}/elementId`,
        );
      }
      if (operation.op === "rename-element-id") {
        assertNamespaced(
          operation.fromElementId,
          manifest.moduleId,
          `${operationPath}/fromElementId`,
        );
        assertNamespaced(
          operation.toElementId,
          manifest.moduleId,
          `${operationPath}/toElementId`,
        );
      }
    });
  });
  for (let left = 0; left < migrations.length; left += 1) {
    for (let right = left + 1; right < migrations.length; right += 1) {
      const first = migrations[left];
      const second = migrations[right];
      if (
        first !== undefined &&
        second !== undefined &&
        intersects(first.fromVersionRange, second.fromVersionRange, {
          includePrerelease: true,
        })
      ) {
        runtimeError("package-migration-ambiguous", "migrations", {
          migrationIds: [first.migrationId, second.migrationId],
        });
      }
    }
  }
}

export function validateCatalogSemantics(
  manifest: ModuleManifest,
  catalog: ContentCatalogManifest,
  elements: readonly ModuleElementDefinition[],
): void {
  if (
    catalog.moduleId !== manifest.moduleId ||
    catalog.moduleVersion !== manifest.version
  ) {
    runtimeError("package-catalog-invalid", "catalog/moduleId", {
      expectedModuleId: manifest.moduleId,
      expectedVersion: manifest.version,
    });
  }
  assertNamespaced(catalog.catalogId, manifest.moduleId, "catalog/catalogId");
  assertSemVer(catalog.catalogVersion, "catalog/catalogVersion");
  const categoryIds = catalog.categories.map((category) => category.categoryId);
  const entryIds = catalog.entries.map((entry) => entry.elementId);
  assertUnique(categoryIds, "catalog/categories");
  assertUnique(entryIds, "catalog/entries");
  if (
    [...categoryIds].sort().join("\0") !== categoryIds.join("\0") ||
    [...entryIds].sort().join("\0") !== entryIds.join("\0")
  ) {
    runtimeError("package-catalog-invalid", "catalog", {
      reason: "not-sorted",
    });
  }
  const categories = new Set(categoryIds);
  const resources = new Set(
    manifest.resources.map((resource) => resource.resourceId),
  );
  const elementsById = new Map(
    elements.map((element) => [element.elementId, element]),
  );
  const elementIds = elements.map((element) => element.elementId).sort();
  if (elementIds.join("\0") !== [...entryIds].sort().join("\0")) {
    runtimeError("package-catalog-invalid", "catalog/entries", {
      reason: "element-closure-mismatch",
    });
  }
  catalog.categories.forEach((category, index) => {
    const count = catalog.entries.filter(
      (entry) => entry.categoryId === category.categoryId,
    ).length;
    if (count !== category.count) {
      runtimeError(
        "package-catalog-invalid",
        `catalog/categories/${index}/count`,
        {
          expected: count,
        },
      );
    }
  });
  catalog.entries.forEach((entry, index) => {
    if (!categories.has(entry.categoryId)) {
      runtimeError(
        "package-reference-missing",
        `catalog/entries/${index}/categoryId`,
      );
    }
    entry.resourceIds.forEach((resourceId) => {
      if (!resources.has(resourceId)) {
        runtimeError(
          "package-reference-missing",
          `catalog/entries/${index}/resourceIds`,
          {
            resourceId,
          },
        );
      }
    });
    const element = elementsById.get(entry.elementId);
    if (
      element === undefined ||
      entry.categoryId !== element.categoryId ||
      entry.sourceId !== element.source.sourceId ||
      entry.contentVersion !== element.source.contentVersion ||
      [...entry.resourceIds].sort().join("\0") !==
        [...element.resourceIds].sort().join("\0")
    ) {
      runtimeError("package-catalog-invalid", `catalog/entries/${index}`, {
        reason: "element-metadata-mismatch",
      });
    }
  });
}

function scanSensitiveMetadata(value: unknown, path: string): void {
  if (typeof value === "string") {
    if (
      /^[A-Za-z]:[\\/]/u.test(value) ||
      /^\\\\/u.test(value) ||
      /^file:/iu.test(value) ||
      /^\//u.test(value)
    ) {
      runtimeError("package-source-path-leak", path);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      scanSensitiveMetadata(child, `${path}/${index}`),
    );
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replaceAll(/[-_]/gu, "");
      if (
        normalizedKey.includes("hash") ||
        normalizedKey.includes("digest") ||
        normalizedKey.includes("checksum") ||
        normalizedKey.includes("sha1") ||
        normalizedKey.includes("sha256") ||
        normalizedKey.includes("sha512")
      ) {
        runtimeError("package-content-hash-forbidden", `${path}/${key}`);
      }
      scanSensitiveMetadata(child, `${path}/${key}`);
    }
  }
}

export function validateGeneratedLocalProfile(
  manifest: ModuleManifest,
  sourceManifest: Civ6SourceManifest | null,
): void {
  if (manifest.packageSource.kind !== "generated-local") return;
  const source = manifest.packageSource;
  scanSensitiveMetadata(source, "module.json/packageSource");
  if (source.generatorId !== "tessera.civ6-extractor") {
    runtimeError(
      "package-profile-unknown",
      "module.json/packageSource/generatorId",
      {
        generatorId: source.generatorId,
      },
    );
  }
  if (
    manifest.moduleId !== "tessera.civ6" ||
    source.sourceProduct !== "Sid Meier's Civilization VI" ||
    source.sourceManifestPath === null ||
    sourceManifest === null
  ) {
    runtimeError("package-profile-unknown", "module.json/packageSource");
  }
  const metadata = source.sourceMetadata;
  const expectedKeys = [
    "artDefVersion",
    "dlcIds",
    "extensions",
    "rulesetId",
    "sourceBuild",
  ];
  if (Object.keys(metadata).sort().join("\0") !== expectedKeys.join("\0")) {
    runtimeError(
      "package-profile-unknown",
      "module.json/packageSource/sourceMetadata",
    );
  }
  const { sourceBuild, rulesetId, dlcIds, artDefVersion } = metadata;
  if (
    typeof sourceBuild !== "string" ||
    sourceBuild.length === 0 ||
    CURRENT_LABELS.has(sourceBuild.toLowerCase()) ||
    typeof rulesetId !== "string" ||
    rulesetId.length === 0 ||
    typeof artDefVersion !== "string" ||
    artDefVersion.length === 0 ||
    !Array.isArray(dlcIds) ||
    !dlcIds.every((id) => typeof id === "string") ||
    [...dlcIds].sort().join("\0") !== dlcIds.join("\0") ||
    new Set(dlcIds).size !== dlcIds.length
  ) {
    runtimeError(
      "package-profile-unknown",
      "module.json/packageSource/sourceMetadata",
    );
  }
  if (sourceManifest.generatorId !== source.generatorId) {
    runtimeError("package-profile-unknown", "provenance/generatorId");
  }
  scanSensitiveMetadata(sourceManifest, "provenance");
}

export function validateCatalogProfileConsistency(
  manifest: ModuleManifest,
  catalog: ContentCatalogManifest | null,
): void {
  if (manifest.packageSource.kind !== "generated-local" || catalog === null)
    return;
  const catalogSource = catalog.catalogSource;
  if (catalogSource?.profileId !== manifest.packageSource.generatorId) {
    runtimeError("package-catalog-invalid", "catalog/catalogSource/profileId");
  }
  const metadata = manifest.packageSource.sourceMetadata;
  if (
    catalogSource.metadata.sourceBuild !== metadata.sourceBuild ||
    catalogSource.metadata.rulesetId !== metadata.rulesetId
  ) {
    runtimeError("package-catalog-invalid", "catalog/catalogSource/metadata");
  }
}

export function moduleVersionSatisfies(
  version: string,
  range: string,
): boolean {
  return satisfies(version, range, { includePrerelease: true });
}

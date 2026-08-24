export type GenericModuleResourceMimeType =
  "image/png" | "image/webp" | "font/woff2" | "application/json";

export interface GenericModuleResourceIdentity {
  readonly moduleId: string;
  readonly version: string;
  readonly resourceId: string;
}

const moduleIdPattern = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u;
const resourceIdPattern =
  /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+:[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/u;
const versionPattern = /^[0-9A-Za-z][0-9A-Za-z.+-]*$/u;

function identityValid(identity: GenericModuleResourceIdentity): boolean {
  return (
    moduleIdPattern.test(identity.moduleId) &&
    versionPattern.test(identity.version) &&
    resourceIdPattern.test(identity.resourceId) &&
    identity.resourceId.startsWith(`${identity.moduleId}:`)
  );
}

/** 资源键只包含已验证的精确模块身份，不接受包路径或模糊版本。 */
export function genericModuleResourceKey(
  identity: GenericModuleResourceIdentity,
): string {
  if (!identityValid(identity)) {
    throw new Error("generic-module-resource-identity-invalid");
  }
  return `${identity.moduleId}@${identity.version}/${identity.resourceId}`;
}

export function parseGenericModuleResourceKey(
  key: string,
): GenericModuleResourceIdentity | null {
  const separator = key.indexOf("@");
  const slash = key.indexOf("/", separator + 1);
  if (
    separator <= 0 ||
    slash <= separator + 1 ||
    key.indexOf("@", separator + 1) >= 0 ||
    key.indexOf("/", slash + 1) >= 0
  ) {
    return null;
  }
  const identity = {
    moduleId: key.slice(0, separator),
    version: key.slice(separator + 1, slash),
    resourceId: key.slice(slash + 1),
  };
  return identityValid(identity) ? Object.freeze(identity) : null;
}

export interface GenericModuleImageResource<ImageHandle = unknown> {
  readonly kind: "image";
  readonly mimeType: "image/png" | "image/webp";
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly handle: ImageHandle;
}

export interface GenericModuleFontResource<FontHandle = unknown> {
  readonly kind: "font";
  readonly mimeType: "font/woff2";
  readonly bytes: Uint8Array;
  /** 由 runtime 生成的安全内部名称，不直接拼接不可信 manifest 文本。 */
  readonly family: string;
  readonly handle: FontHandle;
}

export interface GenericModuleJsonResource {
  readonly kind: "json";
  readonly mimeType: "application/json";
  readonly bytes: Uint8Array;
  /** JSON 只作为冻结声明数据传递，不赋予脚本、着色器或路径执行语义。 */
  readonly value: unknown;
}

export type GenericModuleReadyResource<
  ImageHandle = unknown,
  FontHandle = unknown,
> =
  | GenericModuleImageResource<ImageHandle>
  | GenericModuleFontResource<FontHandle>
  | GenericModuleJsonResource;

export const GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER = Object.freeze({
  kind: "warning-checker" as const,
  label: "resource-unavailable" as const,
  primaryColor: "#FF00FFFF",
  secondaryColor: "#202020FF",
  strokeWidth: 2,
  strokeDashPattern: Object.freeze([4, 3] as const),
  markerCrossRatio: 1 / 3,
  textBackgroundColor: "#FF00FFFF",
});

export type GenericModuleResourceFailureCode =
  | "resource-not-found"
  | "resource-read-failed"
  | "resource-byte-count-mismatch"
  | "resource-decode-failed"
  | "resource-aborted";

interface GenericModuleResourceStateBase {
  readonly key: string;
  readonly identity: GenericModuleResourceIdentity;
}

export type GenericModuleResourceState<
  ImageHandle = unknown,
  FontHandle = unknown,
> =
  | (GenericModuleResourceStateBase & {
      readonly status: "loading";
    })
  | (GenericModuleResourceStateBase & {
      readonly status: "ready";
      readonly resource: GenericModuleReadyResource<ImageHandle, FontHandle>;
    })
  | (GenericModuleResourceStateBase & {
      readonly status: "failed";
      readonly code: GenericModuleResourceFailureCode;
      readonly placeholder: typeof GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER;
    })
  | (GenericModuleResourceStateBase & {
      readonly status: "disposed";
    });

export interface GenericModuleResourceInvalidation {
  readonly key: string;
  readonly status: GenericModuleResourceState["status"];
}

export interface GenericModuleResourceResolver<
  ImageHandle = unknown,
  FontHandle = unknown,
> {
  resolve(
    key: string,
  ): GenericModuleResourceState<ImageHandle, FontHandle> | undefined;
  subscribe(
    listener: (event: GenericModuleResourceInvalidation) => void,
  ): () => void;
}

/** 为 Web runtime 与 Pixi 接线提供不依赖平台 API 的同步状态面。 */
export class GenericModuleResourceStateRegistry<
  ImageHandle = unknown,
  FontHandle = unknown,
> implements GenericModuleResourceResolver<ImageHandle, FontHandle> {
  readonly #states = new Map<
    string,
    GenericModuleResourceState<ImageHandle, FontHandle>
  >();
  readonly #listeners = new Set<
    (event: GenericModuleResourceInvalidation) => void
  >();

  resolve(
    key: string,
  ): GenericModuleResourceState<ImageHandle, FontHandle> | undefined {
    return this.#states.get(key);
  }

  publish(state: GenericModuleResourceState<ImageHandle, FontHandle>): void {
    if (this.#states.get(state.key) === state) return;
    this.#states.set(state.key, state);
    const event = Object.freeze({ key: state.key, status: state.status });
    for (const listener of [...this.#listeners]) listener(event);
  }

  subscribe(
    listener: (event: GenericModuleResourceInvalidation) => void,
  ): () => void {
    this.#listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.#listeners.delete(listener);
    };
  }
}

/** 图片 marker 以 displaySize 约束最长边，始终保持资源原始宽高比。 */
export function genericModuleMarkerImageSize(
  width: number,
  height: number,
  displaySize: number,
): Readonly<{ width: number; height: number }> {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(displaySize) ||
    width <= 0 ||
    height <= 0 ||
    displaySize <= 0
  ) {
    throw new Error("generic-module-image-size-invalid");
  }
  const scale = displaySize / Math.max(width, height);
  return Object.freeze({ width: width * scale, height: height * scale });
}

export const GENERIC_MODULE_PATTERN_ORIGIN = Object.freeze({ x: 0, y: 0 });

export interface GenericModuleCellPatternPlan {
  readonly clipPolygon: readonly Readonly<{ x: number; y: number }>[];
  readonly origin: typeof GENERIC_MODULE_PATTERN_ORIGIN;
  readonly tileSize: Readonly<{ width: number; height: number }>;
}

/** patternScale 是无量纲倍率；图案相位固定锚定地图全局原点。 */
export function genericModulePatternTileSize(
  width: number,
  height: number,
  patternScale: number,
): Readonly<{ width: number; height: number }> {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(patternScale) ||
    width <= 0 ||
    height <= 0 ||
    patternScale <= 0
  ) {
    throw new Error("generic-module-pattern-scale-invalid");
  }
  return Object.freeze({
    width: width * patternScale,
    height: height * patternScale,
  });
}

/** 方形与尖顶六边形共用同一规划：保留完整多边形裁剪，纹理相位固定在地图原点。 */
export function genericModuleCellPatternPlan(
  polygon: readonly Readonly<{ x: number; y: number }>[],
  width: number,
  height: number,
  patternScale: number,
): GenericModuleCellPatternPlan {
  if (polygon.length < 3)
    throw new Error("generic-module-pattern-polygon-invalid");
  return Object.freeze({
    clipPolygon: Object.freeze(
      polygon.map((point) => Object.freeze({ x: point.x, y: point.y })),
    ),
    origin: GENERIC_MODULE_PATTERN_ORIGIN,
    tileSize: genericModulePatternTileSize(width, height, patternScale),
  });
}

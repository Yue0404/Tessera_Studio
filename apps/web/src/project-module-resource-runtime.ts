import type {
  ModuleResource,
  ParsedModulePackage,
} from "@tessera/module-runtime";
import {
  GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER,
  GenericModuleResourceStateRegistry,
  genericModuleResourceKey,
  type GenericModuleResourceFailureCode,
  type GenericModuleResourceIdentity,
  type GenericModuleResourceInvalidation,
  type GenericModuleResourceResolver,
  type GenericModuleResourceState,
} from "@tessera/renderer/generic-module-assets";

export interface ProjectModuleDecodedImage<ImageHandle> {
  readonly handle: ImageHandle;
  readonly width: number;
  readonly height: number;
}

export interface ProjectModuleResourceEnvironment<ImageHandle, FontHandle> {
  decodeImage(
    request: Readonly<{
      bytes: Uint8Array;
      mimeType: "image/png" | "image/webp";
      signal: AbortSignal;
    }>,
  ): Promise<ProjectModuleDecodedImage<ImageHandle>>;
  loadFont(
    request: Readonly<{
      bytes: Uint8Array;
      family: string;
      signal: AbortSignal;
    }>,
  ): Promise<FontHandle>;
  releaseImage(handle: ImageHandle): void;
  releaseFont(handle: FontHandle): void;
}

function copiedBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function abortError(): DOMException {
  return new DOMException("模块资源加载已取消", "AbortError");
}

/** 浏览器实现只消费字节和 Blob，不创建任何 object URL。 */
export function createBrowserProjectModuleResourceEnvironment(): ProjectModuleResourceEnvironment<
  ImageBitmap,
  FontFace
> {
  return {
    async decodeImage(request) {
      if (request.signal.aborted) throw abortError();
      if (typeof createImageBitmap !== "function") {
        throw new Error("module-resource-image-decoder-unavailable");
      }
      const bitmap = await createImageBitmap(
        new Blob([copiedBuffer(request.bytes)], { type: request.mimeType }),
      );
      if (request.signal.aborted) {
        bitmap.close();
        throw abortError();
      }
      return { handle: bitmap, width: bitmap.width, height: bitmap.height };
    },
    async loadFont(request) {
      if (
        request.signal.aborted ||
        typeof FontFace !== "function" ||
        typeof document === "undefined"
      ) {
        if (request.signal.aborted) throw abortError();
        throw new Error("module-resource-font-decoder-unavailable");
      }
      const face = await new FontFace(
        request.family,
        copiedBuffer(request.bytes),
      ).load();
      if (request.signal.aborted) throw abortError();
      document.fonts.add(face);
      if (request.signal.aborted) {
        document.fonts.delete(face);
        throw abortError();
      }
      return face;
    },
    releaseImage(handle) {
      handle.close();
    },
    releaseFont(handle) {
      document.fonts.delete(handle);
    },
  };
}

interface ResourceTarget {
  readonly package: ParsedModulePackage;
  readonly resource: ModuleResource;
  readonly identity: GenericModuleResourceIdentity;
}

class ResourceLoadFailure extends Error {
  constructor(readonly code: GenericModuleResourceFailureCode) {
    super(code);
  }
}

async function readExactResourceBytes(
  target: ResourceTarget,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const result = new Uint8Array(target.resource.bytes);
  let offset = 0;
  try {
    for await (const chunk of target.package.resources.openFile(
      target.resource.path,
      signal,
    )) {
      if (signal.aborted) throw new ResourceLoadFailure("resource-aborted");
      if (offset + chunk.byteLength > result.byteLength) {
        throw new ResourceLoadFailure("resource-byte-count-mismatch");
      }
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
  } catch (error) {
    if (error instanceof ResourceLoadFailure) throw error;
    if (signal.aborted) throw new ResourceLoadFailure("resource-aborted");
    throw new ResourceLoadFailure("resource-read-failed");
  }
  if (offset !== result.byteLength) {
    throw new ResourceLoadFailure("resource-byte-count-mismatch");
  }
  return result;
}

function deepFreezeJson(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreezeJson(child, seen);
  return Object.freeze(value);
}

function safeFontFamily(key: string): string {
  const encoded = [...new TextEncoder().encode(key)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `TesseraModule_${encoded}`;
}

function frozenIdentity(
  identity: GenericModuleResourceIdentity,
): GenericModuleResourceIdentity {
  return Object.freeze({ ...identity });
}

/**
 * 工程级模块资源 runtime。所有读取均从已解析包的 resourceId 清单反查路径，
 * 调用方不能传入 ZIP/OPFS 路径；删除或换代时旧异步结果不会复活。
 */
export class ProjectModuleResourceRuntime<
  ImageHandle = ImageBitmap,
  FontHandle = FontFace,
> implements GenericModuleResourceResolver<ImageHandle, FontHandle> {
  readonly #environment: ProjectModuleResourceEnvironment<
    ImageHandle,
    FontHandle
  >;
  readonly #targets = new Map<string, ResourceTarget>();
  readonly #states = new GenericModuleResourceStateRegistry<
    ImageHandle,
    FontHandle
  >();
  readonly #operations = new Map<
    string,
    Promise<GenericModuleResourceState<ImageHandle, FontHandle>>
  >();
  readonly #controllers = new Map<string, AbortController>();
  readonly #knownKeys = new Set<string>();
  #generation = 0;
  #disposed = false;

  constructor(
    packages: readonly ParsedModulePackage[],
    environment: ProjectModuleResourceEnvironment<
      ImageHandle,
      FontHandle
    > = createBrowserProjectModuleResourceEnvironment() as ProjectModuleResourceEnvironment<
      ImageHandle,
      FontHandle
    >,
  ) {
    this.#environment = environment;
    for (const currentPackage of packages) {
      for (const resource of currentPackage.manifest.resources) {
        const identity = frozenIdentity({
          moduleId: currentPackage.manifest.moduleId,
          version: currentPackage.manifest.version,
          resourceId: resource.resourceId,
        });
        const key = genericModuleResourceKey(identity);
        if (this.#targets.has(key)) {
          throw new Error("module-resource-exact-identity-duplicate");
        }
        this.#targets.set(
          key,
          Object.freeze({
            package: currentPackage,
            resource,
            identity,
          }),
        );
      }
    }
  }

  resolve(
    key: string,
  ): GenericModuleResourceState<ImageHandle, FontHandle> | undefined {
    return this.#states.resolve(key);
  }

  subscribe(
    listener: (event: GenericModuleResourceInvalidation) => void,
  ): () => void {
    return this.#states.subscribe(listener);
  }

  load(
    identity: GenericModuleResourceIdentity,
  ): Promise<GenericModuleResourceState<ImageHandle, FontHandle>> {
    const normalizedIdentity = frozenIdentity(identity);
    const key = genericModuleResourceKey(normalizedIdentity);
    this.#knownKeys.add(key);
    if (this.#disposed) {
      const state = Object.freeze({
        key,
        identity: normalizedIdentity,
        status: "disposed" as const,
      });
      this.#states.publish(state);
      return Promise.resolve(state);
    }
    const operation = this.#operations.get(key);
    if (operation !== undefined) return operation;
    const existing = this.#states.resolve(key);
    if (existing !== undefined && existing.status !== "loading") {
      return Promise.resolve(existing);
    }
    const target = this.#targets.get(key);
    if (target === undefined) {
      const state = this.#failedState(
        key,
        normalizedIdentity,
        "resource-not-found",
      );
      this.#states.publish(state);
      return Promise.resolve(state);
    }

    const generation = this.#generation;
    const controller = new AbortController();
    this.#controllers.set(key, controller);
    this.#states.publish(
      Object.freeze({
        key,
        identity: target.identity,
        status: "loading" as const,
      }),
    );
    const pending = this.#loadTarget(
      key,
      target,
      generation,
      controller.signal,
    ).finally(() => {
      if (this.#operations.get(key) === pending) this.#operations.delete(key);
      if (this.#controllers.get(key) === controller)
        this.#controllers.delete(key);
    });
    this.#operations.set(key, pending);
    return pending;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#generation += 1;
    for (const controller of this.#controllers.values()) controller.abort();
    this.#controllers.clear();
    for (const key of this.#knownKeys) {
      const current = this.#states.resolve(key);
      if (current?.status === "ready") this.#release(current.resource);
      const identity = current?.identity ?? this.#targets.get(key)?.identity;
      if (identity !== undefined) {
        this.#states.publish(
          Object.freeze({ key, identity, status: "disposed" as const }),
        );
      }
    }
  }

  async #loadTarget(
    key: string,
    target: ResourceTarget,
    generation: number,
    signal: AbortSignal,
  ): Promise<GenericModuleResourceState<ImageHandle, FontHandle>> {
    try {
      const bytes = await readExactResourceBytes(target, signal);
      if (!this.#active(generation, signal))
        return this.#disposedState(key, target.identity);
      if (target.resource.mimeType === "application/json") {
        let value: unknown;
        try {
          value = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          );
        } catch {
          throw new ResourceLoadFailure("resource-decode-failed");
        }
        const state = Object.freeze({
          key,
          identity: target.identity,
          status: "ready" as const,
          resource: Object.freeze({
            kind: "json" as const,
            mimeType: target.resource.mimeType,
            bytes,
            value: deepFreezeJson(value),
          }),
        });
        return this.#commit(generation, signal, state);
      }
      if (
        target.resource.mimeType === "image/png" ||
        target.resource.mimeType === "image/webp"
      ) {
        let decoded: ProjectModuleDecodedImage<ImageHandle>;
        try {
          decoded = await this.#environment.decodeImage({
            bytes,
            mimeType: target.resource.mimeType,
            signal,
          });
        } catch {
          if (!this.#active(generation, signal))
            return this.#disposedState(key, target.identity);
          throw new ResourceLoadFailure("resource-decode-failed");
        }
        const state = Object.freeze({
          key,
          identity: target.identity,
          status: "ready" as const,
          resource: Object.freeze({
            kind: "image" as const,
            mimeType: target.resource.mimeType,
            bytes,
            width: decoded.width,
            height: decoded.height,
            handle: decoded.handle,
          }),
        });
        if (!this.#active(generation, signal)) {
          this.#environment.releaseImage(decoded.handle);
          return this.#disposedState(key, target.identity);
        }
        this.#states.publish(state);
        return state;
      }

      const family = safeFontFamily(key);
      let handle: FontHandle;
      try {
        handle = await this.#environment.loadFont({ bytes, family, signal });
      } catch {
        if (!this.#active(generation, signal))
          return this.#disposedState(key, target.identity);
        throw new ResourceLoadFailure("resource-decode-failed");
      }
      const state = Object.freeze({
        key,
        identity: target.identity,
        status: "ready" as const,
        resource: Object.freeze({
          kind: "font" as const,
          mimeType: target.resource.mimeType,
          bytes,
          family,
          handle,
        }),
      });
      if (!this.#active(generation, signal)) {
        this.#environment.releaseFont(handle);
        return this.#disposedState(key, target.identity);
      }
      this.#states.publish(state);
      return state;
    } catch (error) {
      const code =
        error instanceof ResourceLoadFailure
          ? error.code
          : ("resource-read-failed" as const);
      if (!this.#active(generation, signal))
        return this.#disposedState(key, target.identity);
      const failed = this.#failedState(key, target.identity, code);
      this.#states.publish(failed);
      return failed;
    }
  }

  #commit(
    generation: number,
    signal: AbortSignal,
    state: GenericModuleResourceState<ImageHandle, FontHandle>,
  ): GenericModuleResourceState<ImageHandle, FontHandle> {
    if (!this.#active(generation, signal)) {
      return this.#disposedState(state.key, state.identity);
    }
    this.#states.publish(state);
    return state;
  }

  #active(generation: number, signal: AbortSignal): boolean {
    return (
      !this.#disposed && !signal.aborted && generation === this.#generation
    );
  }

  #failedState(
    key: string,
    identity: GenericModuleResourceIdentity,
    code: GenericModuleResourceFailureCode,
  ): GenericModuleResourceState<ImageHandle, FontHandle> {
    return Object.freeze({
      key,
      identity,
      status: "failed" as const,
      code,
      placeholder: GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER,
    });
  }

  #disposedState(
    key: string,
    identity: GenericModuleResourceIdentity,
  ): GenericModuleResourceState<ImageHandle, FontHandle> {
    const existing = this.#states.resolve(key);
    if (existing?.status === "disposed") return existing;
    const state = Object.freeze({
      key,
      identity,
      status: "disposed" as const,
    });
    this.#states.publish(state);
    return state;
  }

  #release(
    resource: Extract<
      GenericModuleResourceState<ImageHandle, FontHandle>,
      { readonly status: "ready" }
    >["resource"],
  ): void {
    try {
      if (resource.kind === "image") {
        this.#environment.releaseImage(resource.handle);
      } else if (resource.kind === "font") {
        this.#environment.releaseFont(resource.handle);
      }
    } catch {
      // 释放失败不能阻断其余资源；runtime 已进入不可复活的 disposed 状态。
    }
  }
}

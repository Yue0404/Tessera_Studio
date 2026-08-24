import type {
  ModuleResource,
  PackageResourceAccess,
  ParsedModulePackage,
} from "@tessera/module-runtime";
import {
  genericModuleResourceKey,
  type GenericModuleResourceIdentity,
} from "@tessera/renderer";
import { describe, expect, it, vi } from "vitest";
import {
  ProjectModuleResourceRuntime,
  type ProjectModuleResourceEnvironment,
} from "./project-module-resource-runtime.js";

interface FakeImage {
  readonly id: string;
}

interface FakeFont {
  readonly id: string;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function moduleResource(
  resourceId: string,
  path: string,
  mimeType: ModuleResource["mimeType"],
  bytes: number,
): ModuleResource {
  return {
    resourceId,
    path,
    mimeType,
    bytes,
    license: { status: "redistributable", sourceName: "测试夹具" },
  };
}

function parsedPackage(
  resources: readonly ModuleResource[],
  contents: ReadonlyMap<string, Uint8Array>,
  version = "1.2.3",
) {
  const openFile = vi.fn(
    (path: string, signal?: AbortSignal): AsyncIterable<Uint8Array> =>
      (async function* () {
        const bytes = contents.get(path);
        if (bytes === undefined) throw new Error("missing");
        signal?.throwIfAborted();
        const split = Math.max(1, Math.floor(bytes.byteLength / 2));
        yield bytes.slice(0, split);
        if (split < bytes.byteLength) yield bytes.slice(split);
        signal?.throwIfAborted();
      })(),
  );
  const access: PackageResourceAccess = {
    origin: "user-file",
    files: resources.map((item) => ({
      path: item.path,
      bytes: contents.get(item.path)?.byteLength ?? item.bytes,
    })),
    openFile,
  };
  const parsed = {
    kind: "module",
    artifactId: "example.module",
    version,
    manifest: {
      moduleId: "example.module",
      version,
      resources,
    },
    resources: access,
  } as unknown as ParsedModulePackage;
  return { parsed, openFile };
}

function fakeEnvironment(): ProjectModuleResourceEnvironment<
  FakeImage,
  FakeFont
> {
  return {
    decodeImage: vi.fn(async () => ({
      handle: { id: "image" },
      width: 64,
      height: 32,
    })),
    loadFont: vi.fn(async () => ({ id: "font" })),
    releaseImage: vi.fn(),
    releaseFont: vi.fn(),
  };
}

function identity(
  resourceId: string,
  version = "1.2.3",
): GenericModuleResourceIdentity {
  return {
    moduleId: "example.module",
    version,
    resourceId,
  };
}

describe("ProjectModuleResourceRuntime", () => {
  it("按精确 resourceId 反查已验证路径并去重并发读取", async () => {
    const asset = moduleResource(
      "example.module:marker",
      "assets/marker.png",
      "image/png",
      4,
    );
    const fixture = parsedPackage(
      [asset],
      new Map([[asset.path, new Uint8Array([1, 2, 3, 4])]]),
    );
    const decoded = deferred<{
      handle: FakeImage;
      width: number;
      height: number;
    }>();
    const environment = fakeEnvironment();
    vi.mocked(environment.decodeImage).mockReturnValue(decoded.promise);
    const runtime = new ProjectModuleResourceRuntime(
      [fixture.parsed],
      environment,
    );
    const events = vi.fn();
    runtime.subscribe(events);

    const first = runtime.load(identity(asset.resourceId));
    const second = runtime.load(identity(asset.resourceId));
    expect(second).toBe(first);
    expect(
      runtime.resolve(genericModuleResourceKey(identity(asset.resourceId))),
    ).toMatchObject({ status: "loading" });

    decoded.resolve({
      handle: { id: "decoded-image" },
      width: 80,
      height: 40,
    });
    const ready = await first;

    expect(ready).toMatchObject({
      status: "ready",
      resource: {
        kind: "image",
        mimeType: "image/png",
        width: 80,
        height: 40,
      },
    });
    expect(fixture.openFile).toHaveBeenCalledTimes(1);
    expect(fixture.openFile).toHaveBeenCalledWith(
      "assets/marker.png",
      expect.any(AbortSignal),
    );
    expect(environment.decodeImage).toHaveBeenCalledTimes(1);
    expect(events.mock.calls.map(([event]) => event.status)).toEqual([
      "loading",
      "ready",
    ]);
  });

  it("精确字节数不闭合时失败且不进入解码器", async () => {
    const asset = moduleResource(
      "example.module:marker",
      "assets/marker.webp",
      "image/webp",
      5,
    );
    const fixture = parsedPackage(
      [asset],
      new Map([[asset.path, new Uint8Array([1, 2, 3, 4])]]),
    );
    const environment = fakeEnvironment();
    const runtime = new ProjectModuleResourceRuntime(
      [fixture.parsed],
      environment,
    );

    await expect(
      runtime.load(identity(asset.resourceId)),
    ).resolves.toMatchObject({
      status: "failed",
      code: "resource-byte-count-mismatch",
      identity: { resourceId: asset.resourceId },
      placeholder: { kind: "warning-checker" },
    });
    expect(environment.decodeImage).not.toHaveBeenCalled();
  });

  it("错误精确版本或未知 resourceId 不会打开包内任意路径", async () => {
    const asset = moduleResource(
      "example.module:marker",
      "assets/marker.png",
      "image/png",
      1,
    );
    const fixture = parsedPackage(
      [asset],
      new Map([[asset.path, new Uint8Array([1])]]),
    );
    const runtime = new ProjectModuleResourceRuntime(
      [fixture.parsed],
      fakeEnvironment(),
    );

    await expect(
      runtime.load({ ...identity(asset.resourceId), version: "1.2.4" }),
    ).resolves.toMatchObject({
      status: "failed",
      code: "resource-not-found",
    });
    await expect(
      runtime.load(identity("example.module:unknown")),
    ).resolves.toMatchObject({
      status: "failed",
      code: "resource-not-found",
    });
    expect(fixture.openFile).not.toHaveBeenCalled();
  });

  it("同 moduleId 的不同版本保持资源读取与缓存完全隔离", async () => {
    const asset = moduleResource(
      "example.module:marker",
      "assets/marker.png",
      "image/png",
      1,
    );
    const oldPackage = parsedPackage(
      [asset],
      new Map([[asset.path, new Uint8Array([1])]]),
      "1.2.3",
    );
    const newPackage = parsedPackage(
      [asset],
      new Map([[asset.path, new Uint8Array([2])]]),
      "1.2.4",
    );
    const runtime = new ProjectModuleResourceRuntime(
      [oldPackage.parsed, newPackage.parsed],
      fakeEnvironment(),
    );

    const [oldState, newState] = await Promise.all([
      runtime.load(identity(asset.resourceId, "1.2.3")),
      runtime.load(identity(asset.resourceId, "1.2.4")),
    ]);

    expect(oldState).toMatchObject({
      status: "ready",
      identity: { version: "1.2.3" },
    });
    expect(newState).toMatchObject({
      status: "ready",
      identity: { version: "1.2.4" },
    });
    if (oldState.status !== "ready" || newState.status !== "ready") return;
    expect(oldState.resource.bytes[0]).toBe(1);
    expect(newState.resource.bytes[0]).toBe(2);
    expect(oldPackage.openFile).toHaveBeenCalledTimes(1);
    expect(newPackage.openFile).toHaveBeenCalledTimes(1);
  });

  it("JSON 只形成深冻结声明数据且不调用媒体环境", async () => {
    const asset = moduleResource(
      "example.module:data",
      "assets/data.json",
      "application/json",
      27,
    );
    const bytes = new TextEncoder().encode('{"nested":{"values":[1,2]}}');
    expect(bytes.byteLength).toBe(asset.bytes);
    const fixture = parsedPackage([asset], new Map([[asset.path, bytes]]));
    const environment = fakeEnvironment();
    const runtime = new ProjectModuleResourceRuntime(
      [fixture.parsed],
      environment,
    );

    const state = await runtime.load(identity(asset.resourceId));

    expect(state.status).toBe("ready");
    if (state.status !== "ready" || state.resource.kind !== "json") return;
    expect(state.resource.value).toEqual({ nested: { values: [1, 2] } });
    expect(Object.isFrozen(state.resource.value)).toBe(true);
    const nested = (state.resource.value as { nested: { values: number[] } })
      .nested;
    expect(Object.isFrozen(nested)).toBe(true);
    expect(Object.isFrozen(nested.values)).toBe(true);
    expect(environment.decodeImage).not.toHaveBeenCalled();
    expect(environment.loadFont).not.toHaveBeenCalled();
  });

  it("字体使用稳定安全 family，并在 dispose 时只释放一次", async () => {
    const asset = moduleResource(
      "example.module:font",
      "assets/font.woff2",
      "font/woff2",
      4,
    );
    const fixture = parsedPackage(
      [asset],
      new Map([[asset.path, new Uint8Array([1, 2, 3, 4])]]),
    );
    const environment = fakeEnvironment();
    const runtime = new ProjectModuleResourceRuntime(
      [fixture.parsed],
      environment,
    );
    const ready = await runtime.load(identity(asset.resourceId));

    expect(ready).toMatchObject({
      status: "ready",
      resource: {
        kind: "font",
        family: expect.stringMatching(/^TesseraModule_[0-9a-f]+$/u),
      },
    });
    const family = vi.mocked(environment.loadFont).mock.calls[0]?.[0].family;
    expect(family).not.toContain(asset.resourceId);

    runtime.dispose();
    runtime.dispose();
    expect(environment.releaseFont).toHaveBeenCalledTimes(1);
    expect(
      runtime.resolve(genericModuleResourceKey(identity(asset.resourceId))),
    ).toMatchObject({ status: "disposed" });
  });

  it("dispose 会取消换代，晚到图片不复活且只释放一次", async () => {
    const asset = moduleResource(
      "example.module:marker",
      "assets/marker.png",
      "image/png",
      4,
    );
    const fixture = parsedPackage(
      [asset],
      new Map([[asset.path, new Uint8Array([1, 2, 3, 4])]]),
    );
    const decoded = deferred<{
      handle: FakeImage;
      width: number;
      height: number;
    }>();
    const environment = fakeEnvironment();
    vi.mocked(environment.decodeImage).mockReturnValue(decoded.promise);
    const runtime = new ProjectModuleResourceRuntime(
      [fixture.parsed],
      environment,
    );
    const events = vi.fn();
    runtime.subscribe(events);
    const pending = runtime.load(identity(asset.resourceId));
    await vi.waitFor(() =>
      expect(environment.decodeImage).toHaveBeenCalledTimes(1),
    );

    runtime.dispose();
    decoded.resolve({
      handle: { id: "late-image" },
      width: 64,
      height: 32,
    });

    await expect(pending).resolves.toMatchObject({ status: "disposed" });
    expect(environment.releaseImage).toHaveBeenCalledTimes(1);
    expect(events.mock.calls.map(([event]) => event.status)).toEqual([
      "loading",
      "disposed",
    ]);
    runtime.dispose();
    expect(environment.releaseImage).toHaveBeenCalledTimes(1);
  });

  it("已就绪图片在重复 dispose 时只释放一次", async () => {
    const asset = moduleResource(
      "example.module:marker",
      "assets/marker.png",
      "image/png",
      1,
    );
    const fixture = parsedPackage(
      [asset],
      new Map([[asset.path, new Uint8Array([1])]]),
    );
    const environment = fakeEnvironment();
    const runtime = new ProjectModuleResourceRuntime(
      [fixture.parsed],
      environment,
    );

    await expect(
      runtime.load(identity(asset.resourceId)),
    ).resolves.toMatchObject({
      status: "ready",
    });
    runtime.dispose();
    runtime.dispose();

    expect(environment.releaseImage).toHaveBeenCalledTimes(1);
  });

  it("dispose 后晚到字体不复活且只释放一次", async () => {
    const asset = moduleResource(
      "example.module:font",
      "assets/font.woff2",
      "font/woff2",
      1,
    );
    const fixture = parsedPackage(
      [asset],
      new Map([[asset.path, new Uint8Array([1])]]),
    );
    const loaded = deferred<FakeFont>();
    const environment = fakeEnvironment();
    vi.mocked(environment.loadFont).mockReturnValue(loaded.promise);
    const runtime = new ProjectModuleResourceRuntime(
      [fixture.parsed],
      environment,
    );
    const pending = runtime.load(identity(asset.resourceId));
    await vi.waitFor(() =>
      expect(environment.loadFont).toHaveBeenCalledTimes(1),
    );

    runtime.dispose();
    loaded.resolve({ id: "late-font" });

    await expect(pending).resolves.toMatchObject({ status: "disposed" });
    expect(environment.releaseFont).toHaveBeenCalledTimes(1);
    runtime.dispose();
    expect(environment.releaseFont).toHaveBeenCalledTimes(1);
  });
});

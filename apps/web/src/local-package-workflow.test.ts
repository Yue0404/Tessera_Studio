import { describe, expect, it } from "vitest";
import {
  BASIC_MODULE_PACKAGE,
  BLANK_PRESET_PACKAGE,
  buildPackageRegistry,
  readPackageFileBytes,
  type ExtensionPackageSource,
  type ResourceDecodeGateway,
} from "@tessera/module-runtime";
import {
  FixedStorageEstimateGateway,
  LocalPackageRepository,
  MemoryOpfsGateway,
  MemoryRepositoryLockGateway,
  type InstalledLocalPackage,
} from "@tessera/storage";
import {
  StoredLocalPackageSource,
  assertPackageArchiveKind,
  installPackageFile,
} from "./local-package-workflow.js";

const installed: InstalledLocalPackage = {
  identity: {
    kind: "module",
    artifactId: "example.package",
    version: "1.0.0",
  },
  sourceKind: "user-file",
  installedAt: "2026-08-22T00:00:00Z",
  archive: { fileName: "example.tessera-module.zip", bytes: 10 },
  files: [{ path: "module.json", bytes: 2 }],
};

async function presetSource(): Promise<ExtensionPackageSource> {
  const files = new Map<string, Uint8Array>();
  for (const descriptor of BLANK_PRESET_PACKAGE.resources.files) {
    let bytes = await readPackageFileBytes(
      BLANK_PRESET_PACKAGE.resources,
      descriptor.path,
      1024 * 1024,
    );
    if (descriptor.path === "preset.json") {
      const value = JSON.parse(new TextDecoder().decode(bytes)) as Record<
        string,
        unknown
      >;
      value.packageSource = {
        kind: "user-file",
        publisher: "测试发布者",
        publishedAt: "2026-08-22T00:00:00Z",
      };
      bytes = new TextEncoder().encode(JSON.stringify(value));
    }
    files.set(descriptor.path, bytes);
  }
  return {
    origin: "user-file",
    async *listFiles() {
      for (const [path, bytes] of files) {
        yield { path, bytes: bytes.byteLength };
      }
    },
    async *openFile(path) {
      const bytes = files.get(path);
      if (bytes === undefined) throw new Error("测试文件不存在");
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      yield copy;
    },
  };
}

function packageRepository() {
  return new LocalPackageRepository({
    databaseName: "package-workflow-" + crypto.randomUUID(),
    opfs: new MemoryOpfsGateway(),
    lockGateway: new MemoryRepositoryLockGateway(),
    estimateGateway: new FixedStorageEstimateGateway({
      quota: 4 * 1024 ** 3,
      usage: 0,
    }),
  });
}

const decoder: ResourceDecodeGateway = {
  async validate() {
    return undefined;
  },
};

function archiveFile(name: string): File {
  const file = new File([new Uint8Array([80, 75])], name);
  Object.defineProperty(file, "stream", {
    value: () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([80, 75]));
          controller.close();
        },
      }),
  });
  return file;
}

describe("StoredLocalPackageSource", () => {
  it("从仓库按需重开文件且不复制全部资源", async () => {
    const source = new StoredLocalPackageSource(installed, {
      async openFile(identity, path) {
        expect(identity).toEqual(installed.identity);
        expect(path).toBe("module.json");
        return new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2]));
            controller.close();
          },
        });
      },
    });
    const listed = [];
    for await (const descriptor of source.listFiles()) listed.push(descriptor);
    const bytes: number[] = [];
    for await (const chunk of source.openFile("module.json")) {
      bytes.push(...chunk);
    }
    expect(listed).toEqual([{ path: "module.json", bytes: 2 }]);
    expect(bytes).toEqual([1, 2]);
  });

  it("归档扩展名必须与解析 kind 一致", () => {
    expect(() =>
      assertPackageArchiveKind("wrong.tessera-preset.zip", "module"),
    ).toThrowError(
      expect.objectContaining({
        code: "package-resource-invalid",
        details: expect.objectContaining({
          reason: "archive-extension-kind-mismatch",
        }),
      }),
    );
    expect(() =>
      assertPackageArchiveKind("ok.tessera-module.zip", "module"),
    ).not.toThrow();
  });

  it("安装后返回持久源 ParsedPackage，可重开资源并构建 Registry", async () => {
    const repository = packageRepository();
    try {
      const result = await installPackageFile(
        repository,
        archiveFile("blank.tessera-preset.zip"),
        { decoder, createSource: () => presetSource() },
      );
      expect(result.status).toBe("installed");
      const bytes = await readPackageFileBytes(
        result.parsed.resources,
        "preset.json",
        1024 * 1024,
      );
      expect(bytes.byteLength).toBeGreaterThan(0);
      const registry = await buildPackageRegistry(
        [BASIC_MODULE_PACKAGE, result.parsed],
        { currentAppVersion: "1.0.0", grid: "square" },
      );
      expect(registry.presets.has(result.parsed.artifactId)).toBe(true);
    } finally {
      repository.close();
    }
  });

  it("kind 与扩展名不一致时不产生本地指针", async () => {
    const repository = packageRepository();
    try {
      await expect(
        installPackageFile(
          repository,
          archiveFile("wrong.tessera-module.zip"),
          { decoder, createSource: () => presetSource() },
        ),
      ).rejects.toMatchObject({ code: "package-resource-invalid" });
      expect(await repository.list()).toEqual([]);
    } finally {
      repository.close();
    }
  });
});

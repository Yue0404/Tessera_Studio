import { describe, expect, it, vi } from "vitest";
import catalogText from "../public/extractor-releases.json?raw";
import {
  ExtractorReleaseCatalogError,
  fetchExtractorReleaseCatalog,
  parseExtractorReleaseCatalog,
  selectCiv6ExtractorRelease,
  type ExtractorRelease,
} from "./extractor-release-catalog.js";

function release(
  version = "0.1.0-preview.1",
  overrides: Partial<ExtractorRelease> = {},
): ExtractorRelease {
  return {
    extractorId: "tessera.civ6-extractor",
    version,
    os: "windows",
    arch: "x64",
    minOsBuild: 26100,
    artifactType: "portable-zip",
    entrypoint: "TesseraCiv6Extractor.exe",
    bytes: 51_549_893,
    sha256: "1".repeat(64),
    outputModuleId: "tessera.civ6",
    outputModuleVersion: "1.0.0",
    minAppVersion: "0.1.0",
    assetUrl: `https://github.com/Yue0404/Tessera_Studio/releases/download/extractor-v${version}/tessera-civ6-extractor-v${version}-windows-x64.zip`,
    ...overrides,
  };
}

function text(...releases: readonly ExtractorRelease[]): string {
  return JSON.stringify({ schemaVersion: "1", releases });
}

function expectCode(run: () => unknown, code: string) {
  try {
    run();
    throw new Error("预期解析失败");
  } catch (error) {
    expect(error).toBeInstanceOf(ExtractorReleaseCatalogError);
    expect((error as ExtractorReleaseCatalogError).code).toBe(code);
  }
}

describe("extractor release catalog", () => {
  it("版本控制的初始目录为空且可由统一解析器读取", () => {
    expect(parseExtractorReleaseCatalog(catalogText)).toEqual({
      schemaVersion: "1",
      releases: [],
    });
  });

  it("严格排序版本并匹配当前应用与已安装模块精确版本", () => {
    const old = release("0.1.0-preview.1");
    const current = release("0.2.0", { outputModuleVersion: "1.1.0" });
    const catalog = parseExtractorReleaseCatalog(text(old, current));
    expect(catalog.releases.map((item) => item.version)).toEqual([
      "0.2.0",
      "0.1.0-preview.1",
    ]);
    expect(selectCiv6ExtractorRelease(catalog, "0.1.0")?.version).toBe("0.2.0");
    expect(
      selectCiv6ExtractorRelease(catalog, "0.1.0", new Set(["1.0.0"]))?.version,
    ).toBe("0.1.0-preview.1");
    expect(
      selectCiv6ExtractorRelease(catalog, "0.0.9", new Set(["1.0.0"])),
    ).toBeUndefined();
  });

  it("Schema 拒绝未知字段、平台漂移、非法大小和大写哈希", () => {
    const cases: unknown[] = [
      { schemaVersion: "1", releases: [], unknown: true },
      { ...release(), os: "linux" },
      { ...release(), arch: "arm64" },
      { ...release(), minOsBuild: 26099 },
      { ...release(), bytes: 0 },
      { ...release(), sha256: "A".repeat(64) },
      { ...release(), entrypoint: "bin/TesseraCiv6Extractor.exe" },
    ];
    for (const value of cases) {
      const catalog =
        "schemaVersion" in (value as Record<string, unknown>)
          ? value
          : { schemaVersion: "1", releases: [value] };
      expectCode(
        () => parseExtractorReleaseCatalog(JSON.stringify(catalog)),
        "extractor-catalog-schema-invalid",
      );
    }
  });

  it("同一提取器版本即使字段不同也按冲突拒绝", () => {
    expectCode(
      () =>
        parseExtractorReleaseCatalog(
          text(release(), release(undefined, { bytes: 51_549_894 })),
        ),
      "extractor-catalog-release-conflict",
    );
  });

  it("只接受文件名与版本闭合的 GitHub Release HTTPS 资产", () => {
    for (const assetUrl of [
      "http://github.com/Yue0404/Tessera_Studio/releases/download/v1/file.zip",
      "https://example.com/Yue0404/Tessera_Studio/releases/download/v1/file.zip",
      "https://github.com/Yue0404/Tessera_Studio/releases/download/v1/wrong.zip",
    ]) {
      expectCode(
        () =>
          parseExtractorReleaseCatalog(text(release(undefined, { assetUrl }))),
        assetUrl.startsWith("https://github.com/")
          ? "extractor-catalog-url-invalid"
          : "extractor-catalog-schema-invalid",
      );
    }
  });

  it("fetch 预检响应大小并把网络失败映射为稳定错误", async () => {
    const oversized = vi.fn(
      async () =>
        new Response("{}", {
          headers: { "content-length": String(1024 * 1024 + 1) },
        }),
    );
    await expect(
      fetchExtractorReleaseCatalog({
        url: new URL("https://example.test/catalog.json"),
        fetcher: oversized,
      }),
    ).rejects.toMatchObject({ code: "extractor-catalog-size-invalid" });

    await expect(
      fetchExtractorReleaseCatalog({
        url: new URL("https://example.test/catalog.json"),
        fetcher: vi.fn(async () => {
          throw new TypeError("offline");
        }),
      }),
    ).rejects.toMatchObject({ code: "extractor-catalog-fetch-failed" });
  });
});

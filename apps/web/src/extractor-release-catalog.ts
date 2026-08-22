import {
  appVersionCompatible,
  compareSemanticVersions,
} from "@tessera/module-runtime";
import validateCatalog from "./extractor-release-validator.generated.js";

const MAX_CATALOG_BYTES = 1024 * 1024;
const EXPECTED_ARTIFACT_PREFIX = "tessera-civ6-extractor-v";

export interface ExtractorRelease {
  readonly extractorId: "tessera.civ6-extractor";
  readonly version: string;
  readonly os: "windows";
  readonly arch: "x64";
  readonly minOsBuild: number;
  readonly artifactType: "portable-zip";
  readonly entrypoint: "TesseraCiv6Extractor.exe";
  readonly bytes: number;
  readonly sha256: string;
  readonly outputModuleId: "tessera.civ6";
  readonly outputModuleVersion: string;
  readonly minAppVersion: string;
  readonly assetUrl: string;
}

export interface ExtractorReleaseCatalog {
  readonly schemaVersion: "1";
  readonly releases: readonly ExtractorRelease[];
}

export type ExtractorReleaseCatalogErrorCode =
  | "extractor-catalog-fetch-failed"
  | "extractor-catalog-size-invalid"
  | "extractor-catalog-json-invalid"
  | "extractor-catalog-schema-invalid"
  | "extractor-catalog-release-conflict"
  | "extractor-catalog-url-invalid";

export class ExtractorReleaseCatalogError extends Error {
  constructor(
    readonly code: ExtractorReleaseCatalogErrorCode,
    readonly fieldPath: string,
    readonly details: Readonly<Record<string, unknown>> = {},
    override readonly cause?: unknown,
  ) {
    super(code);
    this.name = "ExtractorReleaseCatalogError";
  }
}

interface GeneratedValidator {
  (value: unknown): boolean;
  readonly errors?:
    | readonly {
        readonly instancePath?: string;
        readonly keyword?: string;
      }[]
    | null;
}

function assertGitHubReleaseUrl(release: ExtractorRelease, index: number) {
  const fieldPath = `/releases/${index}/assetUrl`;
  let url: URL;
  try {
    url = new URL(release.assetUrl);
  } catch (error) {
    throw new ExtractorReleaseCatalogError(
      "extractor-catalog-url-invalid",
      fieldPath,
      {},
      error,
    );
  }
  const segments = url.pathname.split("/").filter(Boolean);
  let decoded: string[];
  try {
    decoded = segments.map((segment) => decodeURIComponent(segment));
  } catch (error) {
    throw new ExtractorReleaseCatalogError(
      "extractor-catalog-url-invalid",
      fieldPath,
      { reason: "url-encoding-invalid" },
      error,
    );
  }
  const expectedAsset = `${EXPECTED_ARTIFACT_PREFIX}${release.version}-windows-x64.zip`;
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    decoded.length !== 6 ||
    decoded[2] !== "releases" ||
    decoded[3] !== "download" ||
    decoded.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment.includes("/") ||
        segment.includes("\\") ||
        segment.includes("\0"),
    ) ||
    decoded[5] !== expectedAsset
  ) {
    throw new ExtractorReleaseCatalogError(
      "extractor-catalog-url-invalid",
      fieldPath,
      { reason: "github-release-asset-required" },
    );
  }
}

/** Schema 校验后再闭合 URL 与同版本唯一性，失败不返回半目录。 */
export function parseExtractorReleaseCatalog(
  text: string,
): ExtractorReleaseCatalog {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new ExtractorReleaseCatalogError(
      "extractor-catalog-json-invalid",
      "",
      {},
      error,
    );
  }
  const validator = validateCatalog as GeneratedValidator;
  if (!validator(value)) {
    const first = validator.errors?.[0];
    throw new ExtractorReleaseCatalogError(
      "extractor-catalog-schema-invalid",
      first?.instancePath ?? "",
      { keyword: first?.keyword ?? "unknown" },
    );
  }
  const catalog = value as ExtractorReleaseCatalog;
  const versions = new Map<string, number>();
  for (const [index, release] of catalog.releases.entries()) {
    assertGitHubReleaseUrl(release, index);
    const previous = versions.get(release.version);
    if (previous !== undefined) {
      throw new ExtractorReleaseCatalogError(
        "extractor-catalog-release-conflict",
        `/releases/${index}/version`,
        { version: release.version, previousIndex: previous },
      );
    }
    versions.set(release.version, index);
  }
  const releases = catalog.releases
    .map((release) => Object.freeze({ ...release }))
    .sort((left, right) =>
      compareSemanticVersions(right.version, left.version),
    );
  return Object.freeze({
    schemaVersion: "1",
    releases: Object.freeze(releases),
  });
}

async function readCatalogResponse(
  response: Response,
  signal?: AbortSignal,
): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const bytes = Number(declared);
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      bytes > MAX_CATALOG_BYTES
    ) {
      throw new ExtractorReleaseCatalogError(
        "extractor-catalog-size-invalid",
        "response/content-length",
        { maxBytes: MAX_CATALOG_BYTES, actualBytes: declared },
      );
    }
  }
  if (response.body === null) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_CATALOG_BYTES) {
      throw new ExtractorReleaseCatalogError(
        "extractor-catalog-size-invalid",
        "response/body",
        { maxBytes: MAX_CATALOG_BYTES },
      );
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal?.aborted === true) throw signal.reason;
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_CATALOG_BYTES) {
        throw new ExtractorReleaseCatalogError(
          "extractor-catalog-size-invalid",
          "response/body",
          { maxBytes: MAX_CATALOG_BYTES, actualBytes: total },
        );
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new ExtractorReleaseCatalogError(
      "extractor-catalog-json-invalid",
      "response/body",
      { reason: "utf8-invalid" },
      error,
    );
  }
}

export interface FetchExtractorReleaseCatalogOptions {
  readonly signal?: AbortSignal;
  readonly url?: URL;
  readonly fetcher?: typeof fetch;
}

/** 仅由包设置动态入口调用；基础启动路径不会加载或请求该目录。 */
export async function fetchExtractorReleaseCatalog(
  options: FetchExtractorReleaseCatalogOptions = {},
): Promise<ExtractorReleaseCatalog> {
  const url =
    options.url ?? new URL("extractor-releases.json", document.baseURI);
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(url, {
      method: "GET",
      credentials: "omit",
      cache: "no-cache",
      redirect: "follow",
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error) {
    if (options.signal?.aborted === true) throw error;
    throw new ExtractorReleaseCatalogError(
      "extractor-catalog-fetch-failed",
      "response",
      {},
      error,
    );
  }
  if (!response.ok) {
    throw new ExtractorReleaseCatalogError(
      "extractor-catalog-fetch-failed",
      "response/status",
      { status: response.status },
    );
  }
  return parseExtractorReleaseCatalog(
    await readCatalogResponse(response, options.signal),
  );
}

export function selectCiv6ExtractorRelease(
  catalog: ExtractorReleaseCatalog,
  currentAppVersion: string,
  installedModuleVersions: ReadonlySet<string> = new Set(),
): ExtractorRelease | undefined {
  return catalog.releases.find(
    (release) =>
      appVersionCompatible(currentAppVersion, {
        min: release.minAppVersion,
      }) &&
      (installedModuleVersions.size === 0 ||
        installedModuleVersions.has(release.outputModuleVersion)),
  );
}

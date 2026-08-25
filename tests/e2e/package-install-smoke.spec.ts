import { expect, test } from "@playwright/test";
const encoder = new TextEncoder();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/** 生成只使用 Store 与 UTF-8 文件名的最小合法 ZIP，避免测试额外引入打包器。 */
function storeZip(files: Readonly<Record<string, string>>): Uint8Array {
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let localOffset = 0;
  for (const [path, text] of Object.entries(files)) {
    const name = encoder.encode(path);
    const data = encoder.encode(text);
    const checksum = crc32(data);
    const local = new Uint8Array(30 + name.byteLength);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, data.byteLength, true);
    localView.setUint32(22, data.byteLength, true);
    localView.setUint16(26, name.byteLength, true);
    local.set(name, 30);
    localChunks.push(local, data);

    const central = new Uint8Array(46 + name.byteLength);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, data.byteLength, true);
    centralView.setUint32(24, data.byteLength, true);
    centralView.setUint16(28, name.byteLength, true);
    centralView.setUint32(42, localOffset, true);
    central.set(name, 46);
    centralChunks.push(central);
    localOffset += local.byteLength + data.byteLength;
  }
  const central = concat(centralChunks);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, centralChunks.length, true);
  endView.setUint16(10, centralChunks.length, true);
  endView.setUint32(12, central.byteLength, true);
  endView.setUint32(16, localOffset, true);
  return concat([...localChunks, central, end]);
}

async function moduleArchive(moduleId: string): Promise<Uint8Array> {
  const manifest = {
    formatVersion: "1",
    kind: "module",
    moduleId,
    version: "1.0.0",
    nameKey: { kind: "key", key: "module.name" },
    descriptionKey: { kind: "key", key: "module.description" },
    authors: ["Tessera E2E"],
    appVersion: { min: "0.1.0" },
    supportedGrids: ["square", "hex-pointy"],
    dependencies: [],
    layers: [
      {
        layerId: `${moduleId}.surface`,
        nameKey: { kind: "key", key: "layer.surface" },
        zIndex: 2500,
        allowedPrimitives: ["cell-style"],
        allowedAnchors: ["cell"],
        defaultVisible: true,
        defaultLocked: false,
        defaultOpacity: 1,
        extensions: {},
      },
    ],
    elementFiles: ["elements/surface.json"],
    constraintFiles: [],
    migrationFiles: [],
    catalogManifestPath: null,
    defaultLanguage: "zh-CN",
    locales: { "zh-CN": "locales/zh-CN.json" },
    resources: [],
    capabilities: ["cell-style"],
    packageSource: {
      kind: "user-file" as const,
      publisher: "Tessera E2E",
      publishedAt: "2026-08-22T00:00:00Z",
    },
    extensions: {},
  };
  const elements = [
    {
      elementId: `${moduleId}:cell.surface`,
      categoryId: `${moduleId}:category.surface`,
      nameKey: { kind: "key", key: "element.surface.name" },
      descriptionKey: {
        kind: "key",
        key: "element.surface.description",
      },
      primitive: "cell-style",
      layerId: `${moduleId}.surface`,
      anchors: ["cell"],
      supportedGrids: ["square", "hex-pointy"],
      defaultStyle: { fillColor: "#406080FF", fillOpacity: 1 },
      attributeSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
      occupancy: [],
      constraintIds: [],
      resourceIds: [],
      source: {
        sourceId: `${moduleId}:source.e2e`,
        rulesetId: `${moduleId}.rules.v1`,
        contentVersion: "1.0.0",
        retrievedAt: "2026-08-22T00:00:00Z",
      },
    },
  ];
  const locale = {
    "module.name": "E2E 测试模块",
    "module.description": "真实 ZIP Worker 与 OPFS 测试",
    "layer.surface": "测试地表层",
    "element.surface.name": "测试地表",
    "element.surface.description": "仅用于浏览器回归",
  };
  return storeZip({
    "module.json": JSON.stringify(manifest),
    "elements/surface.json": JSON.stringify(elements),
    "locales/zh-CN.json": JSON.stringify(locale),
  });
}

function extractorCatalog(
  overrides: Readonly<Record<string, unknown>> = {},
): string {
  const version = "0.1.0-preview.1";
  return JSON.stringify({
    schemaVersion: "1",
    releases: [
      {
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
      },
    ],
  });
}

test("真实 ZIP Worker 安装到 OPFS，刷新后仍按精确身份可用", async ({
  page,
}) => {
  const moduleId = `example.e2e-${crypto.randomUUID().slice(0, 8)}`;
  const archive = await moduleArchive(moduleId);
  await page.goto("/");
  await page.getByRole("button", { name: "管理模块与预设包" }).click();
  const dialog = page.getByRole("dialog", { name: "包设置" });
  await expect(dialog.getByText("提取器版本：0.1.0-preview.1")).toBeVisible();
  await expect(dialog.getByText("下载大小：51,560,434 字节")).toBeVisible();
  await expect(
    dialog.getByRole("link", { name: "下载匹配版本提取器" }),
  ).toHaveAttribute(
    "href",
    "https://github.com/Yue0404/Tessera_Studio/releases/download/extractor-v0.1.0-preview.1/tessera-civ6-extractor-v0.1.0-preview.1-windows-x64.zip",
  );
  await dialog.locator('input[type="file"]').setInputFiles({
    name: `${moduleId}.tessera-module.zip`,
    mimeType: "application/zip",
    buffer: Buffer.from(archive),
  });
  const installedArticle = dialog
    .locator("article")
    .filter({ hasText: moduleId });
  await expect(installedArticle).toBeVisible({
    timeout: 30_000,
  });
  await expect(installedArticle).toContainText("已就绪");

  await page.reload();
  await expect(page.getByRole("heading", { name: "新建地图" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "管理模块与预设包" }).click();
  const reopened = page.getByRole("dialog", { name: "包设置" });
  const recoveredArticle = reopened
    .locator("article")
    .filter({ hasText: moduleId });
  await expect(recoveredArticle).toBeVisible({
    timeout: 30_000,
  });
  await expect(recoveredArticle).toContainText("1.0.0");
  await expect(recoveredArticle).toContainText("已就绪");

  // 清理本用例创建的本地包，避免同一浏览器 profile 污染后续用例。
  await reopened.getByRole("button", { name: "删除本地包" }).click();
  await expect(reopened.getByText(moduleId, { exact: false })).toHaveCount(0);
});

test("提取器目录仅在打开包设置后请求并呈现安全下载链接", async ({ page }) => {
  let requests = 0;
  await page.route("**/extractor-releases.json", async (route) => {
    requests += 1;
    await route.fulfill({
      contentType: "application/json; charset=utf-8",
      body: extractorCatalog(),
    });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "新建地图" })).toBeVisible();
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "管理模块与预设包" }).click();
  const dialog = page.getByRole("dialog", { name: "包设置" });
  const link = dialog.getByRole("link", { name: "下载匹配版本提取器" });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute(
    "href",
    /github\.com\/Yue0404\/Tessera_Studio\/releases\/download\//,
  );
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(dialog.getByText(/Windows 11 24H2.*26100/)).toBeVisible();
  await expect(dialog.getByText(/SmartScreen/)).toBeVisible();
  expect(requests).toBe(1);
});

test("损坏或不匹配的提取器目录可诊断且不影响本地包入口", async ({ page }) => {
  await page.route("**/extractor-releases.json", async (route) => {
    await route.fulfill({
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({ schemaVersion: "1", releases: [], unknown: true }),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "管理模块与预设包" }).click();
  const dialog = page.getByRole("dialog", { name: "包设置" });
  await expect(dialog.getByText(/无法读取提取器版本目录/)).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "导入已有文明 6 模块包" }),
  ).toBeEnabled();

  await page.unroute("**/extractor-releases.json");
  await page.route("**/extractor-releases.json", async (route) => {
    await route.fulfill({
      contentType: "application/json; charset=utf-8",
      body: extractorCatalog({ minAppVersion: "9.0.0" }),
    });
  });
  await dialog.getByRole("button", { name: "关闭" }).click();
  await page.getByRole("button", { name: "管理模块与预设包" }).click();
  await expect(
    page.getByRole("dialog", { name: "包设置" }).getByText(/当前没有与应用/),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "下载匹配版本提取器" }),
  ).toHaveCount(0);
});

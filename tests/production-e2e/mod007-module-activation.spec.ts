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

/** 与包安装 smoke 相同：生成无压缩、UTF-8 文件名的真实最小 ZIP。 */
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

function moduleArchive(moduleId: string): Uint8Array {
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
        layerId: moduleId + ".surface",
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
      kind: "user-file",
      publisher: "Tessera E2E",
      publishedAt: "2026-08-24T00:00:00Z",
    },
    extensions: {},
  };
  const elements = [
    {
      elementId: moduleId + ":cell.surface",
      categoryId: moduleId + ":category.surface",
      nameKey: { kind: "key", key: "element.surface.name" },
      descriptionKey: { kind: "key", key: "element.surface.description" },
      primitive: "cell-style",
      layerId: moduleId + ".surface",
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
        sourceId: moduleId + ":source.e2e",
        rulesetId: moduleId + ".rules.v1",
        contentVersion: "1.0.0",
        retrievedAt: "2026-08-24T00:00:00Z",
      },
    },
  ];
  return storeZip({
    "module.json": JSON.stringify(manifest),
    "elements/surface.json": JSON.stringify(elements),
    "locales/zh-CN.json": JSON.stringify({
      "module.name": "MOD-007 测试模块",
      "module.description": "工程启停与本地安装分离回归",
      "layer.surface": "MOD-007 地表层",
      "element.surface.name": "MOD-007 地表",
      "element.surface.description": "仅用于生产浏览器回归",
    }),
  });
}

test("本地安装与工程启停分离，刷新后保持精确版本启用", async ({ page }) => {
  const moduleId = "example.mod007-" + crypto.randomUUID().slice(0, 8);
  const archive = moduleArchive(moduleId);
  await page.goto("/");
  await page.getByRole("button", { name: "管理模块与预设包" }).click();
  let dialog = page.getByRole("dialog", { name: "包设置" });
  await dialog.locator("input[type=file]").setInputFiles({
    name: moduleId + ".tessera-module.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(archive),
  });
  let article = dialog.locator("article").filter({ hasText: moduleId });
  await expect(article).toContainText("已就绪", { timeout: 30_000 });
  await expect(article).toContainText("当前工程未启用");
  await dialog.getByRole("button", { name: "关闭" }).click();

  await page.getByLabel("工程名称").fill("MOD-007 工程");
  await page.getByLabel("MOD-007 测试模块").check();
  await page.getByRole("button", { name: "创建" }).click();
  await expect(page.getByTestId("map-canvas")).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole("button", { name: "管理模块与预设包" }).click();
  dialog = page.getByRole("dialog", { name: "包设置" });
  article = dialog.locator("article").filter({ hasText: moduleId });
  await expect(article).toContainText("当前工程已启用");
  await article.getByRole("button", { name: "在当前工程停用" }).click();
  await expect(article).toContainText("当前工程未启用");
  await expect(article).toContainText("已就绪");
  await expect(
    article.getByRole("button", { name: "删除本地包" }),
  ).toBeVisible();

  await article.getByRole("button", { name: "在当前工程启用" }).click();
  await expect(article).toContainText("当前工程已启用");
  await expect(article).toContainText("1.0.0");
  await dialog.getByRole("button", { name: "关闭" }).click();

  await page.reload();
  await expect(page.getByTestId("map-canvas")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "管理模块与预设包" }).click();
  dialog = page.getByRole("dialog", { name: "包设置" });
  article = dialog.locator("article").filter({ hasText: moduleId });
  await expect(article).toContainText("当前工程已启用");
  await expect(article).toContainText("1.0.0");

  await article.getByRole("button", { name: "删除本地包" }).click();
  await article.getByRole("button", { name: "确认删除并转为只读占位" }).click();
  await expect(article).toContainText("本地包缺失");
  await expect(article).toContainText("当前工程已启用");
  await expect(article.getByRole("button", { name: "删除本地包" })).toHaveCount(
    0,
  );

  await page.reload();
  await expect(page.getByTestId("map-canvas")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "管理模块与预设包" }).click();
  dialog = page.getByRole("dialog", { name: "包设置" });
  article = dialog.locator("article").filter({ hasText: moduleId });
  await expect(article).toContainText("本地包缺失");
  await expect(article).toContainText("当前工程已启用");
  await article.getByRole("button", { name: "在当前工程停用" }).click();
  await expect(dialog.getByText(moduleId, { exact: false })).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("map-canvas")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "管理模块与预设包" }).click();
  dialog = page.getByRole("dialog", { name: "包设置" });
  await expect(dialog.getByText(moduleId, { exact: false })).toHaveCount(0);
});

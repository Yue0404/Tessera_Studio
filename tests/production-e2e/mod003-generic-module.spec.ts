import {
  expect,
  test,
  type Download,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  MOD003_CATEGORY_NAME,
  MOD003_MODULE_NAME,
  MOD003_MODULE_VERSION,
  mod003ElementIds,
  mod003PackageFiles,
} from "./fixtures/mod003-generic-module.js";
import { storeZip } from "./helpers/store-zip.js";
import {
  canvasFeaturePixelCount,
  canvasPixelDiff,
  canvasPng,
  settleCanvas,
} from "./helpers/canvas-pixel-diff.js";
import { validate as validateProjectSchema } from "../../packages/formats/src/project-validator.generated.js";
import {
  validateProjectDocumentV1,
  type ProjectV1Document,
} from "../../packages/formats/src/index.js";

interface ModuleInstanceDocument {
  readonly instanceId?: string;
  readonly overlayId?: string;
  readonly connectionId?: string;
  readonly elementId: string;
  readonly attributes?: Readonly<Record<string, unknown>>;
  readonly styleOverrides?: Readonly<Record<string, unknown>>;
}

interface ModuleProjectDocument {
  readonly kind: string;
  readonly exportScope?: string;
  readonly isComplete?: boolean;
  readonly modules?: readonly {
    readonly moduleId: string;
    readonly version: string;
  }[];
  readonly requiredModules?: readonly {
    readonly moduleId: string;
    readonly version: string;
  }[];
  readonly chunks?: readonly {
    readonly cellOverrides: readonly {
      readonly layerInstances: readonly ModuleInstanceDocument[];
    }[];
  }[];
  readonly managers?: {
    readonly edgeManager: {
      readonly edges: readonly {
        readonly layerInstances: readonly ModuleInstanceDocument[];
      }[];
    };
    readonly overlayManager: {
      readonly overlays: readonly ModuleInstanceDocument[];
    };
    readonly connectionManager: {
      readonly connections: readonly ModuleInstanceDocument[];
    };
  };
  readonly objects?: {
    readonly cellOverrides: readonly {
      readonly layerInstances: readonly ModuleInstanceDocument[];
    }[];
    readonly edges: readonly {
      readonly layerInstances: readonly ModuleInstanceDocument[];
    }[];
    readonly overlays: readonly ModuleInstanceDocument[];
    readonly connections: readonly ModuleInstanceDocument[];
  };
}

async function drag(
  page: Page,
  canvas: Locator,
  start: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number },
): Promise<void> {
  const bounds = await canvas.boundingBox();
  if (bounds === null) throw new Error("canvas-bounds-missing");
  await page.mouse.move(bounds.x + start.x, bounds.y + start.y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + end.x, bounds.y + end.y, { steps: 4 });
  await page.mouse.up();
}

interface VisualExportBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

async function readDownload(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function exportVisual(
  page: Page,
  format: "PNG" | "SVG",
  bounds?: VisualExportBounds,
): Promise<Buffer> {
  await page.getByRole("button", { name: "导出" }).click();
  await page.getByRole("button", { name: "图片导出" }).click();
  await page.getByLabel(format).check();
  if (bounds !== undefined) {
    await page.getByLabel("图片范围").selectOption("custom");
    const labels = {
      minX: "最小 X",
      minY: "最小 Y",
      maxX: "最大 X",
      maxY: "最大 Y",
    } as const;
    for (const key of Object.keys(labels) as (keyof VisualExportBounds)[]) {
      await page.getByLabel(labels[key]).fill(String(bounds[key]));
    }
  }
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "开始生成" }).click();
  return readDownload(await downloading);
}

async function exportData(
  page: Page,
  kind: "full" | "partial" | "fragment" = "full",
): Promise<ModuleProjectDocument> {
  await page.getByRole("button", { name: "导出" }).click();
  await page.getByRole("button", { name: "数据导出" }).click();
  if (kind !== "full") {
    await page
      .getByLabel(
        kind === "partial" ? "部分 Tessera Project" : "Tessera Fragment",
      )
      .check();
    await page.getByLabel("自定义地图矩形").check();
  }
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "生成并下载" }).click();
  const bytes = await readDownload(await downloading);
  return JSON.parse(bytes.toString("utf8")) as ModuleProjectDocument;
}

function projectModuleInstances(
  document: ModuleProjectDocument,
): readonly ModuleInstanceDocument[] {
  return [
    ...(document.chunks ?? []).flatMap((chunk) =>
      chunk.cellOverrides.flatMap((cell) => cell.layerInstances),
    ),
    ...(document.managers?.edgeManager.edges ?? []).flatMap(
      (edge) => edge.layerInstances,
    ),
    ...(document.managers?.overlayManager.overlays ?? []),
    ...(document.managers?.connectionManager.connections ?? []),
    ...(document.objects?.cellOverrides ?? []).flatMap(
      (cell) => cell.layerInstances,
    ),
    ...(document.objects?.edges ?? []).flatMap((edge) => edge.layerInstances),
    ...(document.objects?.overlays ?? []),
    ...(document.objects?.connections ?? []),
  ];
}

function projectElementIds(document: ModuleProjectDocument): readonly string[] {
  return [
    ...projectModuleInstances(document).map((instance) => instance.elementId),
    ...(document.domainGroups ?? []).map((group) => group.elementId),
    ...(document.objects?.domainGroups ?? []).map((group) => group.elementId),
  ].sort();
}

function moduleInstanceId(instance: ModuleInstanceDocument | undefined) {
  return instance?.instanceId ?? instance?.overlayId ?? instance?.connectionId;
}

async function openPackageSettings(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "管理模块与预设包" }).click();
  return page.getByRole("dialog", { name: "包设置" });
}

async function uploadModule(
  dialog: Locator,
  moduleId: string,
  archive: Uint8Array,
): Promise<Locator> {
  await dialog.locator("input[type=file]").setInputFiles({
    name: `${moduleId}.tessera-module.zip`,
    mimeType: "application/zip",
    buffer: Buffer.from(archive),
  });
  const article = dialog.locator("article").filter({ hasText: moduleId });
  await expect(article).toContainText("已就绪", { timeout: 30_000 });
  return article;
}

async function selectModuleElement(
  page: Page,
  elementId: string,
): Promise<void> {
  await page
    .getByRole("button", {
      name: `使用目录元素 ${elementId}`,
      exact: true,
    })
    .click();
}

function expectExactModule(
  document: ModuleProjectDocument,
  moduleId: string,
): void {
  expect(document.modules ?? document.requiredModules).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        moduleId,
        version: MOD003_MODULE_VERSION,
      }),
    ]),
  );
}

test("真实非 Civ6 模块 ZIP 完成五种 primitive 与领域对象、缺包占位及精确恢复闭环", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const moduleId = `example.mod003-e2e-${crypto.randomUUID().slice(0, 8)}`;
  const ids = mod003ElementIds(moduleId);
  const expectedIds = Object.values(ids).sort();
  const packageFiles = mod003PackageFiles(moduleId);
  const archive = storeZip(packageFiles);

  await page.goto("/");
  let dialog = await openPackageSettings(page);
  let article = await uploadModule(dialog, moduleId, archive);
  await expect(article).toContainText(MOD003_MODULE_NAME);
  await expect(article).toContainText("当前工程未启用");
  await dialog.getByRole("button", { name: "关闭" }).click();

  await page.reload();
  await expect(page.getByRole("heading", { name: "新建地图" })).toBeVisible({
    timeout: 30_000,
  });
  dialog = await openPackageSettings(page);
  article = dialog.locator("article").filter({ hasText: moduleId });
  await expect(article).toContainText("已就绪", { timeout: 30_000 });
  await expect(article).toContainText(MOD003_MODULE_VERSION);
  await dialog.getByRole("button", { name: "关闭" }).click();

  await page.getByLabel("工程名称").fill("MOD-003 通用扩展工程");
  await page.getByText("正方形", { exact: true }).click();
  await page.getByLabel(MOD003_MODULE_NAME).check();
  await page.getByRole("button", { name: "创建" }).click();
  const canvas = page.getByLabel("地图编辑画布");
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  const resourceRegions = {
    pattern: { left: 425, top: 225, right: 495, bottom: 295 },
    marker: { left: 575, top: 215, right: 665, bottom: 305 },
    font: { left: 635, top: 300, right: 765, bottom: 380 },
  } as const;

  const moduleSelect = page.getByRole("combobox").filter({
    has: page.locator(`option[value="${moduleId}"]`),
  });
  await moduleSelect.selectOption(moduleId);
  await expect(
    page.getByText(MOD003_MODULE_NAME, { exact: true }),
  ).toBeVisible();
  const categoryId = `${moduleId}:category.weather`;
  const categorySelect = page.getByRole("combobox").filter({
    has: page.locator(`option[value="${categoryId}"]`),
  });
  await categorySelect.selectOption(categoryId);
  await expect(categorySelect).toHaveValue(categoryId);
  await expect(categorySelect.locator("option:checked")).toHaveText(
    MOD003_CATEGORY_NAME,
  );
  const results = page.getByRole("list", { name: "元素搜索结果" });
  await expect(results.getByRole("listitem")).toHaveCount(5);
  const search = page.getByRole("searchbox", { name: "搜索元素" });
  await search.fill("流向");
  await expect(results.getByRole("listitem")).toHaveCount(1);
  await expect(
    page.getByRole("button", {
      name: `使用目录元素 ${ids.connection}`,
      exact: true,
    }),
  ).toBeVisible();
  await search.fill("");
  const emptyPng = await exportVisual(page, "PNG");
  const activeSettings = page.getByRole("region", { name: "当前元素设置" });

  await selectModuleElement(page, ids.cell);
  await expect(activeSettings).toContainText(
    "使用模块默认样式，放置后选择对象编辑。",
  );
  await expect(activeSettings.getByLabel("填充颜色")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "画刷" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await canvas.click({ position: { x: 460, y: 260 } });

  await selectModuleElement(page, ids.edge);
  await expect(activeSettings).toContainText(
    "使用模块默认样式，放置后选择对象编辑。",
  );
  await expect(activeSettings.getByLabel("边颜色")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "边" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await canvas.click({ position: { x: 520, y: 300 } });

  await selectModuleElement(page, ids.marker);
  await expect(activeSettings.getByLabel("锚定方式")).toBeVisible();
  await expect(activeSettings.getByLabel("标记形状")).toHaveCount(0);
  await expect(activeSettings.getByLabel("标记颜色")).toHaveCount(0);
  await canvas.click({ position: { x: 620, y: 260 } });

  await selectModuleElement(page, ids.text);
  await expect(activeSettings.getByLabel("锚定方式")).toBeVisible();
  await expect(activeSettings.getByLabel("字号")).toHaveCount(0);
  await expect(activeSettings.getByLabel("文字颜色")).toHaveCount(0);
  await activeSettings.getByLabel("文字内容").fill("风暴前线");
  await canvas.click({ position: { x: 700, y: 340 } });

  await selectModuleElement(page, ids.connection);
  await expect(activeSettings.getByLabel("端点类型")).toBeVisible();
  await expect(activeSettings.getByLabel("连线类型")).toHaveCount(0);
  await expect(activeSettings.getByLabel("箭头模式")).toHaveCount(0);
  await activeSettings.getByLabel("短标签").fill("扩展流向");
  await canvas.click({ position: { x: 440, y: 400 } });
  await canvas.click({ position: { x: 640, y: 400 } });
  // 连续创建第二条扩展连接，验证首次成功后 FSM 已回到 choosing-start。
  await canvas.click({ position: { x: 440, y: 440 } });
  await expect(page.getByTestId("connection-notice")).toHaveCount(0);
  await canvas.click({ position: { x: 640, y: 440 } });
  await expect(page.getByTestId("connection-notice")).toHaveCount(0);
  await page.keyboard.press("Control+z");

  await categorySelect.selectOption("object");
  await expect(categorySelect.locator("option:checked")).toHaveText("物体");
  await expect(results.getByRole("listitem")).toHaveCount(1);
  await selectModuleElement(page, ids.domain);
  await expect(activeSettings).toContainText(
    "使用模块默认样式，放置后选择对象编辑。",
  );
  await expect(activeSettings).toContainText(
    "单击地图中的中心格，按当前预设一次性放置完整物体。",
  );
  await drag(page, canvas, { x: 780, y: 260 }, { x: 812, y: 260 });

  let document = await exportData(page);
  expectExactModule(document, moduleId);
  expect(projectElementIds(document)).toEqual(expectedIds);
  const domain = (
    document.domainGroups as
      | readonly {
          readonly groupId: string;
          readonly memberCellIds: readonly string[];
        }[]
      | undefined
  )?.find((group) => group.groupId.length > 0);
  expect(domain?.memberCellIds).toHaveLength(2);
  const domainInstanceId = domain?.groupId;
  expect(domainInstanceId).toEqual(expect.any(String));
  const createdDomainMembers = [...(domain?.memberCellIds ?? [])];

  const updatedDomainMembers = createdDomainMembers;

  await page.getByRole("button", { name: "选择" }).click();
  await canvas.click({ position: { x: 700, y: 340 } });
  await expect(
    page.getByText("已选择 1 个对象", { exact: true }),
  ).toBeVisible();
  const attributesEditor = page.getByLabel("模块属性（JSON）");
  await expect(attributesEditor).toHaveValue(/风暴前线/u);
  await attributesEditor.fill('{"text":"风暴注记已编辑"}');
  await attributesEditor.blur();

  await canvas.click({ position: { x: 620, y: 260 } });
  const styleEditor = page.getByLabel("样式覆盖（JSON）");
  await styleEditor.fill('{"color":"#7C3AEDFF","displaySize":42}');
  await styleEditor.blur();
  document = await exportData(page);
  const editedText = projectModuleInstances(document).find(
    (instance) => instance.elementId === ids.text,
  );
  const editedMarker = projectModuleInstances(document).find(
    (instance) => instance.elementId === ids.marker,
  );
  expect(editedText?.attributes).toEqual({ text: "风暴注记已编辑" });
  expect(editedMarker?.styleOverrides).toEqual({
    color: "#7C3AEDFF",
    displaySize: 42,
  });
  expect(moduleInstanceId(editedMarker)).toEqual(expect.any(String));
  const markerInstanceId = moduleInstanceId(editedMarker);

  await page.getByRole("button", { name: "删除所选对象" }).click();
  document = await exportData(page);
  expect(projectElementIds(document)).toEqual(
    expectedIds.filter((elementId) => elementId !== ids.marker),
  );
  await page.getByRole("button", { name: "撤销" }).click();
  document = await exportData(page);
  expect(projectElementIds(document)).toEqual(expectedIds);
  await page.getByRole("button", { name: "重做" }).click();
  document = await exportData(page);
  expect(projectElementIds(document)).toEqual(
    expectedIds.filter((elementId) => elementId !== ids.marker),
  );
  await page.getByRole("button", { name: "撤销" }).click();

  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByTestId("status-save")).toHaveText("已保存");
  await page.reload();
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await expect(canvas).toHaveAttribute("data-module-resource-ready-count", "3");
  await settleCanvas(canvas);
  const readyResourceCanvas = await canvasPng(canvas);
  expect(
    await canvasFeaturePixelCount(
      page,
      readyResourceCanvas,
      resourceRegions.pattern,
      "magenta",
    ),
  ).toBeGreaterThan(0);
  expect(
    await canvasFeaturePixelCount(
      page,
      readyResourceCanvas,
      resourceRegions.marker,
      "cyan",
    ),
  ).toBeGreaterThan(10);
  expect(
    await canvasFeaturePixelCount(
      page,
      readyResourceCanvas,
      resourceRegions.font,
      "white",
    ),
  ).toBeGreaterThan(10);
  document = await exportData(page);
  expect(
    (
      document.domainGroups as
        | readonly {
            readonly groupId: string;
            readonly memberCellIds: readonly string[];
          }[]
        | undefined
    )?.find((group) => group.groupId === domainInstanceId),
  ).toMatchObject({ memberCellIds: updatedDomainMembers });
  expect(projectElementIds(document)).toEqual(expectedIds);
  expect(
    projectModuleInstances(document).find(
      (instance) => instance.elementId === ids.text,
    )?.attributes,
  ).toEqual({ text: "风暴注记已编辑" });
  expect(
    projectModuleInstances(document).find(
      (instance) => instance.elementId === ids.marker,
    ),
  ).toMatchObject({
    styleOverrides: { color: "#7C3AEDFF", displaySize: 42 },
  });
  expect(
    moduleInstanceId(
      projectModuleInstances(document).find(
        (instance) => instance.elementId === ids.marker,
      ),
    ),
  ).toBe(markerInstanceId);

  // 重载后命中同一领域中心，删除与撤销必须保持同一 ID 和已更新成员。
  await page.getByRole("button", { name: "选择" }).click();
  await canvas.click({ position: { x: 796, y: 260 } });
  await expect(
    page.getByText("当前领域成员：2 格", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "删除所选对象" }).click();
  document = await exportData(page);
  expect(
    (document.domainGroups as readonly { readonly groupId: string }[]).some(
      (group) => group.groupId === domainInstanceId,
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "撤销" }).click();
  document = await exportData(page);
  expect(
    (
      document.domainGroups as readonly {
        readonly groupId: string;
        readonly memberCellIds: readonly string[];
      }[]
    ).find((group) => group.groupId === domainInstanceId),
  ).toMatchObject({ memberCellIds: updatedDomainMembers });

  const partial = await exportData(page, "partial");
  expect(partial).toMatchObject({
    kind: "tessera-project",
    exportScope: "partial",
    isComplete: false,
  });
  expectExactModule(partial, moduleId);
  expect(projectElementIds(partial)).toEqual(
    expect.arrayContaining(expectedIds),
  );

  const fragment = await exportData(page, "fragment");
  expect(fragment.kind).toBe("tessera-fragment");
  expectExactModule(fragment, moduleId);
  expect(projectElementIds(fragment)).toEqual(
    expect.arrayContaining(expectedIds),
  );

  const png = await exportVisual(page, "PNG");
  expect([...png.subarray(0, 8)]).toEqual([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  // 相同视口与网格下，实例版必须与放置前基线产生真实像素制品差异。
  expect(png.equals(emptyPng)).toBe(false);

  const svg = (await exportVisual(page, "SVG")).toString("utf8");
  expect(svg).toContain("<svg");
  expect(svg).toContain("风暴注记已编辑");
  expect(svg).toContain("扩展流向");
  expect(svg).toContain('stroke-dasharray="8 4"');
  expect(svg).toContain('<use href="#asset-resource-');
  expect(svg).toContain(
    'width="42" height="21" transform="translate(620 260) rotate(15)"',
  );
  expect(svg).toContain("data:image/png;base64,");
  expect(svg).toContain("data:image/webp;base64,");
  expect(svg).toContain("data:font/woff2;base64,");
  expect(svg).toMatch(/<line[^>]+stroke="#42a5f5"/iu);
  // connection 的同色 polygon 是 arrowEnd 生成的箭头头部，不只是主线。
  expect(svg).toMatch(/<polygon[^>]+fill="#42a5f5"/iu);

  dialog = await openPackageSettings(page);
  article = dialog.locator("article").filter({ hasText: moduleId });
  await article.getByRole("button", { name: "删除本地包" }).click();
  await article.getByRole("button", { name: "确认删除并转为只读占位" }).click();
  await expect(article).toContainText("本地包缺失");
  await dialog.getByRole("button", { name: "关闭" }).click();

  await expect(canvas).toHaveAttribute("data-module-resource-ready-count", "0");
  // 整包缺失时没有 exact resource descriptor；洋红缺包占位由下方像素断言验证。
  await expect(canvas).toHaveAttribute(
    "data-module-resource-placeholder-count",
    "0",
  );
  await settleCanvas(canvas);
  const missingResourceCanvas = await canvasPng(canvas);
  for (const region of Object.values(resourceRegions)) {
    expect(
      await canvasPixelDiff(
        page,
        readyResourceCanvas,
        missingResourceCanvas,
        region,
      ),
    ).toBeGreaterThan(10);
    expect(
      await canvasFeaturePixelCount(
        page,
        missingResourceCanvas,
        region,
        "magenta",
      ),
    ).toBeGreaterThan(10);
  }
  await page.getByRole("button", { name: "图层" }).click();
  const missingLayer = page
    .getByRole("listitem")
    .filter({ hasText: `${moduleId}.runtime` });
  await expect(missingLayer).toContainText(
    "所需模块缺失；图层数据已保留并强制只读",
  );
  await expect(
    missingLayer.getByRole("checkbox", { name: "锁定" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "选择" }).click();
  await canvas.click({ position: { x: 620, y: 260 } });
  await expect(
    page.getByText("所需模块缺失；实例只读且不可删除", { exact: true }),
  ).toBeVisible();
  await expect(attributesEditor).toBeDisabled();
  await expect(styleEditor).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "删除所选对象" }),
  ).toBeDisabled();
  document = await exportData(page);
  expectExactModule(document, moduleId);
  expect(projectElementIds(document)).toEqual(expectedIds);
  expect(
    moduleInstanceId(
      projectModuleInstances(document).find(
        (instance) => instance.elementId === ids.marker,
      ),
    ),
  ).toBe(markerInstanceId);

  dialog = await openPackageSettings(page);
  article = await uploadModule(dialog, moduleId, archive);
  await expect(article).toContainText("当前工程已启用");
  await expect(article).toContainText(MOD003_MODULE_VERSION);
  await dialog.getByRole("button", { name: "关闭" }).click();
  await expect(canvas).toHaveAttribute("data-module-resource-ready-count", "3");
  await expect(canvas).toHaveAttribute(
    "data-module-resource-placeholder-count",
    "0",
  );
  await settleCanvas(canvas);
  const restoredResourceCanvas = await canvasPng(canvas);
  for (const region of Object.values(resourceRegions))
    expect(
      await canvasPixelDiff(
        page,
        readyResourceCanvas,
        restoredResourceCanvas,
        region,
      ),
    ).toBe(0);
  await moduleSelect.selectOption(moduleId);
  await expect(
    page.getByText(MOD003_MODULE_NAME, { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "图层" }).click();
  const restoredLayer = page
    .getByRole("listitem")
    .filter({ hasText: `${moduleId}.runtime` });
  const restoredLayerLock = restoredLayer.getByRole("checkbox", {
    name: "锁定",
  });
  await expect(restoredLayerLock).toBeEnabled();
  await expect(restoredLayerLock).not.toBeChecked();
  await page.getByRole("button", { name: "选择" }).click();
  await canvas.click({ position: { x: 620, y: 260 } });
  await expect(
    page.getByText("已选择 1 个对象", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("所需模块缺失；实例只读且不可删除", { exact: true }),
  ).toHaveCount(0);
  await expect(attributesEditor).toBeEnabled();
  await expect(styleEditor).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "删除所选对象" }),
  ).toBeEnabled();
  document = await exportData(page);
  expectExactModule(document, moduleId);
  expect(projectElementIds(document)).toEqual(expectedIds);
  expect(
    projectModuleInstances(document).find(
      (instance) => instance.elementId === ids.marker,
    ),
  ).toMatchObject({
    styleOverrides: { color: "#7C3AEDFF", displaySize: 42 },
  });
  expect(
    moduleInstanceId(
      projectModuleInstances(document).find(
        (instance) => instance.elementId === ids.marker,
      ),
    ),
  ).toBe(markerInstanceId);

  await styleEditor.fill('{"color":"#0EA5E9FF","displaySize":48}');
  await styleEditor.blur();
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByTestId("status-save")).toHaveText("已保存");
  await page.reload();
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  document = await exportData(page);
  expect(
    projectModuleInstances(document).find(
      (instance) => instance.elementId === ids.marker,
    ),
  ).toMatchObject({
    styleOverrides: { color: "#0EA5E9FF", displaySize: 48 },
  });
  expect(
    moduleInstanceId(
      projectModuleInstances(document).find(
        (instance) => instance.elementId === ids.marker,
      ),
    ),
  ).toBe(markerInstanceId);
});

test("真实 ZIP 的远处资源未进入视口也能由自定义导出精确预取", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const moduleId = `example.mod003-far-${crypto.randomUUID().slice(0, 8)}`;
  const ids = mod003ElementIds(moduleId);
  const layerId = `${moduleId}.runtime`;
  const archive = storeZip(mod003PackageFiles(moduleId));
  const projectName = "MOD-003 远处资源基线";
  const importedProjectName = "MOD-003 远处资源已导入";

  await page.goto("/");
  const packageDialog = await openPackageSettings(page);
  await uploadModule(packageDialog, moduleId, archive);
  await packageDialog.getByRole("button", { name: "关闭" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "新建地图" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByLabel("工程名称").fill(projectName);
  await page.getByText("正方形", { exact: true }).click();
  await page.getByLabel("宽度").fill("400");
  await page.getByLabel("高度").fill("400");
  await page.getByLabel(MOD003_MODULE_NAME).check();
  await page.getByRole("button", { name: "创建" }).click();

  const canvas = page.getByLabel("地图编辑画布");
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  const baseline = await exportData(page);
  const farProject = structuredClone(baseline) as unknown as {
    projectId: string;
    name: string;
    contentBounds: VisualExportBounds | null;
    chunks: {
      chunkRow: number;
      chunkColumn: number;
      cellOverrides: Record<string, unknown>[];
      ownedEdgeIds: string[];
      ownedOverlayIds: string[];
      ownedDomainGroupIds: string[];
      extensions: Record<string, unknown>;
    }[];
    managers: {
      overlayManager: { overlays: Record<string, unknown>[] };
    };
  };
  const cellInstanceId = crypto.randomUUID();
  const markerOverlayId = crypto.randomUUID();
  const textOverlayId = crypto.randomUUID();
  const farCellId = "cell:square:300:300";
  const farBounds = { minX: 10_750, minY: 10_750, maxX: 11_200, maxY: 11_050 };
  farProject.projectId = crypto.randomUUID();
  farProject.name = importedProjectName;
  farProject.chunks.push({
    chunkRow: 4,
    chunkColumn: 4,
    cellOverrides: [
      {
        cellId: farCellId,
        layerInstances: [
          {
            instanceId: cellInstanceId,
            elementId: ids.cell,
            layerId,
            styleOverrides: {},
            attributes: {},
            extensions: {},
          },
        ],
        extensions: {},
      },
    ],
    ownedEdgeIds: [],
    // free-overlay 由 OverlayManager 自持有；chunk owner 只登记 anchored overlay。
    ownedOverlayIds: [],
    ownedDomainGroupIds: [],
    extensions: {},
  });
  farProject.managers.overlayManager.overlays.push(
    {
      kind: "free-overlay",
      overlayId: markerOverlayId,
      elementId: ids.marker,
      layerId,
      overlayType: "marker",
      point: { x: 10_950, y: 10_850 },
      styleOverrides: {},
      attributes: {},
      orderInLayer: 0,
      extensions: {},
    },
    {
      kind: "free-overlay",
      overlayId: textOverlayId,
      elementId: ids.text,
      layerId,
      overlayType: "text",
      point: { x: 11_080, y: 10_950 },
      styleOverrides: {},
      attributes: { text: "远处字体资源" },
      orderInLayer: 1,
      extensions: {},
    },
  );
  farProject.managers.overlayManager.overlays.sort((left, right) =>
    String(left.overlayId).localeCompare(String(right.overlayId)),
  );
  // formats 的 v1 摘要按 cell polygon 与 generic free-overlay 锚点计算；这里保持精确值。
  farProject.contentBounds = {
    minX: 10_800,
    minY: 10_800,
    maxX: 11_080,
    maxY: 10_950,
  };
  if (!validateProjectSchema(farProject)) {
    throw new Error(
      `far-project-schema-invalid:${JSON.stringify(validateProjectSchema.errors)}`,
    );
  }
  try {
    validateProjectDocumentV1(farProject as unknown as ProjectV1Document);
  } catch (error) {
    throw new Error(
      `far-project-semantic-invalid:${JSON.stringify(error, Object.getOwnPropertyNames(error))}`,
      { cause: error },
    );
  }
  await page
    .locator('input[type="file"][accept=".tessera-project.json"]')
    .setInputFiles({
      name: "mod003-far-resource.tessera-project.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(farProject)),
    });
  await expect(
    page.getByText(importedProjectName, { exact: true }),
  ).toBeVisible();
  await settleCanvas(canvas);
  await expect(canvas).toHaveAttribute(
    "data-module-resource-requested-count",
    "0",
  );
  await expect(canvas).toHaveAttribute("data-module-resource-ready-count", "0");
  await expect(canvas).toHaveAttribute(
    "data-module-resource-placeholder-count",
    "0",
  );

  const png = await exportVisual(page, "PNG", farBounds);
  // PNG 本身就是固定的远处 custom ROI；三类特征都只能来自从未进入实时视口的实例。
  const farPngRoi = { left: 0, top: 0, right: 449, bottom: 299 };
  const farFeatures = {
    magenta: await canvasFeaturePixelCount(page, png, farPngRoi, "magenta"),
    cyan: await canvasFeaturePixelCount(page, png, farPngRoi, "cyan"),
    white: await canvasFeaturePixelCount(page, png, farPngRoi, "white"),
  };
  expect.soft(farFeatures.magenta).toBeGreaterThan(0);
  expect.soft(farFeatures.cyan).toBeGreaterThan(10);
  expect.soft(farFeatures.white).toBeGreaterThan(10);
  await expect(canvas).toHaveAttribute(
    "data-module-resource-requested-count",
    "0",
  );

  const svg = (await exportVisual(page, "SVG", farBounds)).toString("utf8");
  expect(svg).toContain("data:image/png;base64,");
  expect(svg).toContain("data:image/webp;base64,");
  expect(svg).toContain("data:font/woff2;base64,");
  expect(svg).toContain('<use href="#asset-resource-');
  expect(svg).toContain("远处字体资源");
  expect(svg.toLowerCase()).not.toContain("#ff00ff");
  await expect(canvas).toHaveAttribute(
    "data-module-resource-requested-count",
    "0",
  );
});

import { spawnSync } from "node:child_process";
import console from "node:console";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  existsSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { chromium } from "@playwright/test";
import { createServer } from "vite";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../..");
const solutionPath = "tools/civ6-extractor/TesseraCiv6Extractor.slnx";
const cliPath =
  "tools/civ6-extractor/src/Tessera.Civ6.Extractor.Cli/bin/Release/net10.0/TesseraCiv6Extractor.dll";
const dotnetPath = process.env.TESSERA_DOTNET_PATH?.trim() || "dotnet";

function runDotnet(arguments_, label) {
  const result = spawnSync(dotnetPath, arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error !== undefined) {
    throw new Error(`${label} 无法启动 .NET：${result.error.message}`, {
      cause: result.error,
    });
  }
  if (result.status !== 0) {
    throw new Error(
      `${label} 失败（exit ${String(result.status)}）\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout.trim();
}

function writeFixture(root, path, value) {
  const target = join(root, ...path.split("/"));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, value);
}

function entityFile(table, primaryKey, rows) {
  const types = rows.map((row) => `<Row Type="${row.id}"/>`).join("");
  const entities = rows
    .map(
      (row) =>
        `<Row ${primaryKey}="${row.id}" Name="${row.name}"${row.description ? ` Description="${row.description}"` : ""}${row.extra ? ` ${row.extra}` : ""}/>`,
    )
    .join("");
  return `<GameInfo><Types>${types}</Types><${table}>${entities}</${table}></GameInfo>`;
}

function emptyArtDef(collection) {
  return `<AssetObjects..ArtDefSet><m_Version><major>4</major><minor>0</minor></m_Version><m_TemplateName text="${collection}"/><m_RootCollections><Element><m_CollectionName text="${collection}"/><m_ReplaceMergedCollectionElements>false</m_ReplaceMergedCollectionElements></Element></m_RootCollections></AssetObjects..ArtDefSet>`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function canonicalExistingPath(path) {
  const canonical = realpathSync.native(path);
  // Windows runner 可能在临时目录中混用短路径、大小写或分隔符；文件身份应按文件系统语义比较。
  return process.platform === "win32"
    ? canonical.toLocaleLowerCase("en-US")
    : canonical;
}

async function validateArchiveInBrowser(vite, archivePath) {
  await vite.listen();
  const address = vite.httpServer?.address();
  assert(
    address !== null && typeof address === "object",
    "Vite 未返回监听地址。",
  );
  const origin = `http://127.0.0.1:${String(address.port)}`;
  const browser = await chromium.launch({
    ...(process.platform === "win32" ? { channel: "msedge" } : {}),
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.route(`${origin}/__civ6_contract__`, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><meta charset=utf-8><title>contract</title>",
      }),
    );
    await page.route(`${origin}/__civ6_archive__`, (route) =>
      route.fulfill({
        path: archivePath,
        contentType: "application/zip",
      }),
    );
    await page.goto(`${origin}/__civ6_contract__`);
    return await page.evaluate(async () => {
      const [{ UserFilePackageSource }, runtime, media] = await Promise.all([
        import("/packages/module-runtime/src/user-file.ts"),
        import("/packages/module-runtime/src/index.ts"),
        import("/apps/web/src/package-media-decoder.ts"),
      ]);
      const response = await globalThis.fetch("/__civ6_archive__");
      if (!response.ok)
        throw new Error(`归档下载失败：${String(response.status)}`);
      const file = new globalThis.File(
        [await response.blob()],
        "tessera.civ6.tessera-module.zip",
        { type: "application/zip" },
      );
      const source = new UserFilePackageSource(file);
      const archivePaths = [];
      for await (const descriptor of source.listFiles())
        archivePaths.push(descriptor.path);
      let decodedResourceCount = 0;
      const decoder = new media.BrowserResourceDecodeGateway();
      try {
        const parsed = await runtime.parseExtensionPackageSource(source, {
          resourceDecoder: {
            async validate(request) {
              await decoder.validate(request);
              decodedResourceCount += 1;
            },
          },
        });
        return {
          kind: parsed.kind,
          artifactId: parsed.artifactId,
          version: parsed.version,
          elements: parsed.elements.length,
          resources: parsed.manifest.resources.length,
          catalogEntries: parsed.catalog?.entries.length ?? 0,
          decodedResourceCount,
          archiveBytes: file.size,
          archiveFileCount: archivePaths.length,
          railroadResourceId: parsed.elements.find(
            (value) =>
              value.elementId === "tessera.civ6:object.route.route-railroad",
          )?.resourceIds?.[0],
        };
      } finally {
        source.dispose();
      }
    });
  } finally {
    await browser.close();
  }
}

async function main() {
  const realMode = process.argv.includes("--real");
  const realInput = process.env.TESSERA_CIV6_GAME_PATH?.trim();
  if (realMode && !realInput)
    throw new Error("真实兼容验证必须显式设置 TESSERA_CIV6_GAME_PATH。");
  const temporaryRoot = mkdtempSync(
    join(tmpdir(), "tessera-civ6-package-contract-"),
  );
  let vite;
  try {
    runDotnet(["restore", solutionPath, "--locked-mode"], "锁定还原");
    runDotnet(
      ["build", solutionPath, "--configuration", "Release", "--no-restore"],
      "Release 构建",
    );

    const input = realMode ? realInput : join(temporaryRoot, "CivilizationVI");
    const output = join(temporaryRoot, "generated", "tessera.civ6");
    if (!realMode) {
      const baselineText = `<AssetObjects..GameDependencyData />`;
      writeFixture(
        input,
        "Base/Civ6.dep",
        `<AssetObjects..GameDependencyData><ID><name text="Civ6"/><id text="cb2f71b7-843e-4af3-9ca7-992acda9c195"/></ID></AssetObjects..GameDependencyData>`,
      );
      writeFixture(input, "DLC/Expansion1/Expansion1.dep", baselineText);
      writeFixture(input, "DLC/Expansion2/Expansion2.dep", baselineText);
      writeFixture(
        input,
        "DLC/Expansion1/Expansion1.modinfo",
        `<Mod id="1B28771A-C749-434B-9053-D1380C553DE9" version="1" />`,
      );
      writeFixture(
        input,
        "DLC/Expansion2/Expansion2.modinfo",
        `<Mod id="4873eb62-8ccc-4574-b784-dda455e74e68" version="1" />`,
      );
      writeFixture(
        input,
        "DLC/Expansion1/Data/Expansion1_Districts.xml",
        `<GameInfo><Districts/></GameInfo>`,
      );
      writeFixture(
        input,
        "DLC/Expansion1/ArtDefs/Districts.artdef",
        `<AssetObjects..ArtDefSet />`,
      );
      writeFixture(
        input,
        "DLC/Expansion2/Data/Expansion2_Districts.xml",
        `<GameInfo><Districts/></GameInfo>`,
      );
      writeFixture(
        input,
        "DLC/Expansion2/ArtDefs/Districts.artdef",
        `<AssetObjects..ArtDefSet />`,
      );
      const baseRows = [
        [
          "Terrains",
          "TerrainType",
          "TERRAIN_GRASS",
          "LOC_TERRAIN_GRASS_NAME",
          "",
        ],
        [
          "Features",
          "FeatureType",
          "FEATURE_FOREST",
          "LOC_FEATURE_FOREST_NAME",
          "",
        ],
        [
          "Resources",
          "ResourceType",
          "RESOURCE_WHEAT",
          "LOC_RESOURCE_WHEAT_NAME",
          "",
        ],
        [
          "Improvements",
          "ImprovementType",
          "IMPROVEMENT_FARM",
          "LOC_IMPROVEMENT_FARM_NAME",
          "",
        ],
        [
          "Routes",
          "RouteType",
          "ROUTE_ANCIENT_ROAD",
          "LOC_ROUTE_ANCIENT_ROAD_NAME",
          "",
        ],
      ];
      for (const [table, primaryKey, id, name, description] of baseRows) {
        writeFixture(
          input,
          `Base/Assets/Gameplay/Data/${table}.xml`,
          entityFile(table, primaryKey, [{ id, name, description }]),
        );
      }
      writeFixture(
        input,
        "Base/Assets/Gameplay/Data/Districts.xml",
        entityFile("Districts", "DistrictType", [
          {
            id: "DISTRICT_CITY_CENTER",
            name: "LOC_DISTRICT_CITY_CENTER_NAME",
            description: "",
            extra: 'CityCenter="true"',
          },
          {
            id: "DISTRICT_CAMPUS",
            name: "LOC_DISTRICT_CAMPUS_NAME",
            description: "",
          },
        ]),
      );
      writeFixture(
        input,
        "Base/Assets/Gameplay/Data/Buildings.xml",
        entityFile("Buildings", "BuildingType", [
          {
            id: "BUILDING_PYRAMIDS",
            name: "LOC_BUILDING_PYRAMIDS_NAME",
            description: "",
            extra: 'IsWonder="true"',
          },
        ]),
      );
      const emptyExpansionFiles = [
        ["DLC/Expansion1/Data/Expansion1_Features.xml", "Features"],
        ["DLC/Expansion1/Data/Expansion1_Resources.xml", "Resources"],
        ["DLC/Expansion1/Data/Expansion1_Improvements.xml", "Improvements"],
        ["DLC/Expansion1/Data/Expansion1_Buildings.xml", "Buildings"],
        ["DLC/Expansion2/Data/Expansion2_Features.xml", "Features"],
        ["DLC/Expansion2/Data/Expansion2_Resources.xml", "Resources"],
        ["DLC/Expansion2/Data/Expansion2_Improvements.xml", "Improvements"],
        ["DLC/Expansion2/Data/Expansion2_Routes.xml", "Routes"],
        ["DLC/Expansion2/Data/Expansion2_Buildings.xml", "Buildings"],
      ];
      for (const [path, table] of emptyExpansionFiles)
        writeFixture(input, path, `<GameInfo><${table}/></GameInfo>`);
      const emptyIconTables = [
        "Base/Assets/UI/Icons/Icons_Terrain.xml",
        "Base/Assets/UI/Icons/Icons_Features.xml",
        "Base/Assets/UI/Icons/Icons_Resources.xml",
        "Base/Assets/UI/Icons/Icons_UnitActions.xml",
        "Base/Assets/UI/Icons/Icons_Districts.xml",
        "Base/Assets/UI/Icons/Icons_Routes.xml",
        "Base/Assets/UI/Icons/Icons_Wonders.xml",
        "DLC/Expansion1/Data/Expansion1_Icons_Features.xml",
        "DLC/Expansion1/Data/Expansion1_Icons_Resources.xml",
        "DLC/Expansion1/Data/Expansion1_Icons_Improvements.xml",
        "DLC/Expansion1/Data/Expansion1_Icons_Districts.xml",
        "DLC/Expansion1/Data/Expansion1_Icons_Wonders.xml",
        "DLC/Expansion2/Data/Expansion2_Icons_Features.xml",
        "DLC/Expansion2/Data/Expansion2_Icons_Districts.xml",
        "DLC/Expansion2/Data/Expansion2_Icons_Wonders.xml",
      ];
      for (const path of emptyIconTables)
        writeFixture(
          input,
          path,
          "<GameInfo><IconTextureAtlases/><IconDefinitions/></GameInfo>",
        );
      const localizedKeys = [
        "LOC_TERRAIN_GRASS_NAME",
        "LOC_FEATURE_FOREST_NAME",
        "LOC_RESOURCE_WHEAT_NAME",
        "LOC_IMPROVEMENT_FARM_NAME",
        "LOC_DISTRICT_CITY_CENTER_NAME",
        "LOC_DISTRICT_CAMPUS_NAME",
        "LOC_ROUTE_ANCIENT_ROAD_NAME",
        "LOC_BUILDING_PYRAMIDS_NAME",
      ];
      writeFixture(
        input,
        "Base/Assets/Text/Vanilla_zh_Hans_CN.xml",
        `<GameData><LocalizedText>${localizedKeys.map((key) => `<Replace Tag="${key}" Language="zh_Hans_CN"><Text>${key}</Text></Replace>`).join("")}</LocalizedText></GameData>`,
      );
      for (const path of [
        "DLC/Expansion1/Text/Expansion1_Translations_Text.xml",
        "DLC/Expansion1/Text/Expansion1_Translations_Major_Text.xml",
        "DLC/Expansion2/Text/Expansion2_Translations_Text.xml",
      ])
        writeFixture(input, path, `<GameData><LocalizedText/></GameData>`);
      for (const [path, collection] of [
        ["Base/ArtDefs/Terrains.artdef", "Terrain"],
        ["DLC/Expansion2/ArtDefs/Terrains.artdef", "Terrain"],
        ["Base/ArtDefs/Features.artdef", "Feature"],
        ["DLC/Expansion1/ArtDefs/Features.artdef", "Feature"],
        ["DLC/Expansion2/ArtDefs/Features.artdef", "Feature"],
        ["Base/ArtDefs/Resources.artdef", "Resource"],
        ["DLC/Expansion1/ArtDefs/Resources.artdef", "Resource"],
        ["DLC/Expansion2/ArtDefs/Resources.artdef", "Resource"],
        ["Base/ArtDefs/Improvements.artdef", "Improvement"],
        ["DLC/Expansion1/ArtDefs/Improvements.artdef", "Improvement"],
        ["DLC/Expansion2/ArtDefs/Improvements.artdef", "Improvement"],
        ["Base/ArtDefs/Districts.artdef", "District"],
        ["DLC/Expansion1/ArtDefs/Districts.artdef", "District"],
        ["DLC/Expansion2/ArtDefs/Districts.artdef", "District"],
        ["Base/ArtDefs/Routes.artdef", "Route"],
        ["DLC/Expansion2/ArtDefs/Routes.artdef", "Route"],
        ["Base/ArtDefs/Buildings.artdef", "Building"],
        ["DLC/Expansion1/ArtDefs/Buildings.artdef", "Building"],
        ["DLC/Expansion2/ArtDefs/Buildings.artdef", "Building"],
      ])
        writeFixture(input, path, emptyArtDef(collection));
      const cliExecutable = resolve(
        repositoryRoot,
        "tools/civ6-extractor/src/Tessera.Civ6.Extractor.Cli/bin/Release/net10.0/TesseraCiv6Extractor.exe",
      );
      const syntheticExecutable = join(
        input,
        "Base/Binaries/Win64Steam/CivilizationVI.exe",
      );
      mkdirSync(dirname(syntheticExecutable), { recursive: true });
      copyFileSync(cliExecutable, syntheticExecutable);
    }
    const inspection = JSON.parse(
      runDotnet([cliPath, "inspect", "--input", input], "合成安装检查"),
    );
    assert(inspection.ok === true, "合成安装检查未成功。");
    assert(inspection.files.length === 12, "白名单扫描文件数量不匹配。");
    assert(
      !JSON.stringify(inspection).includes(temporaryRoot),
      "检查结果泄露了绝对路径。",
    );
    const extraction = JSON.parse(
      runDotnet(
        [cliPath, "extract", "--input", input, "--output", output],
        "合成包生成",
      ),
    );
    assert(extraction.ok === true, "合成包生成未成功。");
    assert(isAbsolute(extraction.archivePath), "CLI 未返回绝对归档路径。");
    assert(existsSync(extraction.archivePath), "CLI 返回的归档不存在。");
    const expectedArchivePath = join(
      dirname(output),
      "tessera.civ6.tessera-module.zip",
    );
    assert(
      existsSync(expectedArchivePath) &&
        canonicalExistingPath(extraction.archivePath) ===
          canonicalExistingPath(expectedArchivePath),
      "CLI 返回的归档位置不符合单一 ZIP 制品契约。",
    );
    assert(!existsSync(output), "内部 staging 目录被误留为正式制品。");
    const safeExtraction = { ...extraction };
    delete safeExtraction.archivePath;
    assert(
      !JSON.stringify(safeExtraction).includes(temporaryRoot),
      "除 archivePath 外的生成结果泄露了绝对路径。",
    );

    // 在真实浏览器中走网站生产 Worker、统一解析器和媒体解码器，避免复制验证规则。
    vite = await createServer({
      root: repositoryRoot,
      appType: "custom",
      logLevel: "error",
      server: { host: "127.0.0.1", port: 0, strictPort: false },
    });
    const parsed = await validateArchiveInBrowser(vite, extraction.archivePath);

    assert(parsed.kind === "module", "统一加载器未返回 module 包。");
    assert(parsed.artifactId === "tessera.civ6", "模块 ID 不匹配。");
    assert(parsed.version === "1.0.0", "模块版本不匹配。");
    const expectedElements = realMode ? 197 : 8;
    assert(parsed.elements === expectedElements, "目录元素数量不匹配。");
    // 正式 1.0.12.68：59 个 StrategicView + 52 个资源 UI 图标 + 3 个改良 UI 图标。
    const expectedResources = realMode ? 114 : 0;
    assert(parsed.resources === expectedResources, "资源声明数量不匹配。");
    assert(
      parsed.decodedResourceCount === expectedResources,
      "资源没有逐项经过统一解码网关。",
    );
    if (realMode) {
      assert(
        parsed.railroadResourceId === "tessera.civ6:asset.route.route-railroad",
        "铁路元素没有闭合到提取资源。",
      );
    }
    assert(
      parsed.catalogEntries === expectedElements,
      "内容目录未闭合到元素集合。",
    );
    console.log(
      JSON.stringify({
        ok: true,
        moduleId: parsed.artifactId,
        version: parsed.version,
        elements: parsed.elements,
        resources: parsed.resources,
        archiveFiles: parsed.archiveFileCount,
        archiveBytes: parsed.archiveBytes,
        realInstallation: realMode,
      }),
    );
  } finally {
    try {
      await vite?.close();
    } finally {
      // 即使 Vite 关闭失败，也必须删除合成输入与本地生成包。
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});

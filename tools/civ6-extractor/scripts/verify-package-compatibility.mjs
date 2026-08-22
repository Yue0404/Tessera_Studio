import { spawnSync } from "node:child_process";
import console from "node:console";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
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

function listFiles(root, directory = root) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(root, path) : [path];
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function abortError() {
  const error = new Error("操作已取消。");
  error.name = "AbortError";
  return error;
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
      writeFixture(
        input,
        "Base/ArtDefs/Districts.artdef",
        `<AssetObjects..ArtDefSet />`,
      );
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
    assert(
      !JSON.stringify(extraction).includes(temporaryRoot),
      "生成结果泄露了绝对路径。",
    );

    const files = listFiles(output);
    const source = {
      origin: "user-file",
      async *listFiles(signal) {
        for (const path of files) {
          if (signal?.aborted === true) throw abortError();
          yield {
            path: relative(output, path).replaceAll("\\", "/"),
            bytes: statSync(path).size,
          };
        }
      },
      async *openFile(path, signal) {
        if (signal?.aborted === true) throw abortError();
        yield new Uint8Array(readFileSync(join(output, ...path.split("/"))));
      },
    };

    // 通过 Vite 使用仓库真实的 TS 解析链，避免复制一套验证规则。
    vite = await createServer({
      root: repositoryRoot,
      appType: "custom",
      logLevel: "error",
      server: { middlewareMode: true },
    });
    const { parseExtensionPackageSource } = await vite.ssrLoadModule(
      "/packages/module-runtime/src/index.ts",
    );
    let decodedResourceCount = 0;
    const parsed = await parseExtensionPackageSource(source, {
      resourceDecoder: {
        async validate(request) {
          let consumed = 0;
          const prefix = [];
          for await (const chunk of request.stream) {
            consumed += chunk.byteLength;
            for (const value of chunk) {
              if (prefix.length < 26) prefix.push(value);
            }
          }
          assert(consumed === request.bytes, `资源未完整消费：${request.path}`);
          assert(
            request.mimeType === "image/png",
            `资源类型不匹配：${request.path}`,
          );
          assert(
            prefix.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10",
            `PNG 签名不匹配：${request.path}`,
          );
          const width = new DataView(Uint8Array.from(prefix).buffer).getUint32(
            16,
          );
          const height = new DataView(Uint8Array.from(prefix).buffer).getUint32(
            20,
          );
          assert(
            width > 0 && height > 0 && prefix[25] === 6,
            `PNG 尺寸或 RGBA 类型无效：${request.path}`,
          );
          decodedResourceCount += 1;
        },
      },
    });

    assert(parsed.kind === "module", "统一加载器未返回 module 包。");
    assert(parsed.artifactId === "tessera.civ6", "模块 ID 不匹配。");
    assert(parsed.version === "1.0.0", "模块版本不匹配。");
    const expectedElements = realMode ? 197 : 8;
    assert(parsed.elements.length === expectedElements, "目录元素数量不匹配。");
    const expectedResources = realMode ? 1 : 0;
    assert(
      parsed.manifest.resources.length === expectedResources,
      "资源声明数量不匹配。",
    );
    assert(
      decodedResourceCount === expectedResources,
      "资源没有逐项经过统一解码网关。",
    );
    if (realMode) {
      const railroad = parsed.elements.find(
        (value) =>
          value.elementId === "tessera.civ6:object.route.route-railroad",
      );
      assert(
        railroad?.resourceIds?.[0] ===
          "tessera.civ6:asset.route.railroad-preview",
        "铁路元素没有闭合到提取资源。",
      );
    }
    assert(
      parsed.catalog?.entries.length === expectedElements,
      "内容目录未闭合到元素集合。",
    );
    console.log(
      JSON.stringify({
        ok: true,
        moduleId: parsed.artifactId,
        version: parsed.version,
        elements: parsed.elements.length,
        resources: parsed.manifest.resources.length,
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

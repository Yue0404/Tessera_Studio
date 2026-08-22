import { spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
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
const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

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

    const input = join(temporaryRoot, "CivilizationVI");
    const output = join(temporaryRoot, "generated", "tessera.civ6");
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
      `<GameInfo />`,
    );
    writeFixture(
      input,
      "DLC/Expansion1/ArtDefs/Districts.artdef",
      `<AssetObjects..ArtDefSet />`,
    );
    writeFixture(
      input,
      "DLC/Expansion2/Data/Expansion2_Districts.xml",
      `<GameInfo />`,
    );
    writeFixture(
      input,
      "DLC/Expansion2/ArtDefs/Districts.artdef",
      `<AssetObjects..ArtDefSet />`,
    );
    writeFixture(
      input,
      "Base/Assets/Gameplay/Data/Districts.xml",
      `<GameData sourceBuild="1.0.12.68" rulesetId="civ6-standard-gs-v1" artDefVersion="1" dlcIds="Expansion1;Expansion2"><Objects><Object id="DISTRICT_CITY_CENTER" category="city" name="市中心" description="合成城市中心" artDef="DISTRICT_CITY_CENTER" /></Objects></GameData>`,
    );
    writeFixture(
      input,
      "Base/ArtDefs/Districts.artdef",
      `<AssetObjects><Asset id="DISTRICT_CITY_CENTER" imagePath="Base/Assets/UI/Icons/city-center.png" /></AssetObjects>`,
    );
    writeFixture(input, "Base/Assets/UI/Icons/city-center.png", tinyPng);
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
    const parsed = await parseExtensionPackageSource(source, {
      resourceDecoder: {
        async validate(request) {
          let consumed = 0;
          for await (const chunk of request.stream)
            consumed += chunk.byteLength;
          assert(consumed === request.bytes, `资源未完整消费：${request.path}`);
        },
      },
    });

    assert(parsed.kind === "module", "统一加载器未返回 module 包。");
    assert(parsed.artifactId === "tessera.civ6", "模块 ID 不匹配。");
    assert(parsed.version === "1.0.0", "模块版本不匹配。");
    assert(parsed.elements.length === 1, "合成元素数量不匹配。");
    assert(
      parsed.elements[0]?.primitive === "marker",
      "单格元素 primitive 不匹配。",
    );
    assert(
      parsed.elements[0]?.layerId === "tessera.civ6.cell.occupation",
      "元素未引用冻结的占用物图层。",
    );
    assert(parsed.catalog?.entries.length === 1, "内容目录未闭合到合成元素。");
    console.log(
      JSON.stringify({
        ok: true,
        moduleId: parsed.artifactId,
        version: parsed.version,
        elements: parsed.elements.length,
        resources: parsed.manifest.resources.length,
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

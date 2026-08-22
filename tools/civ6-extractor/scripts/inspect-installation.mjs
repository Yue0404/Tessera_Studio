import { spawnSync } from "node:child_process";
import console from "node:console";
import { resolve } from "node:path";
import process from "node:process";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const dotnetPath = process.env.TESSERA_DOTNET_PATH?.trim() || "dotnet";
const input =
  process.argv[2]?.trim() || process.env.TESSERA_CIV6_GAME_PATH?.trim();
if (!input) {
  console.error(
    "必须通过第一个参数或 TESSERA_CIV6_GAME_PATH 明确提供正式游戏安装根目录。",
  );
  process.exitCode = 2;
} else {
  const cliPath = resolve(
    repositoryRoot,
    "tools/civ6-extractor/src/Tessera.Civ6.Extractor.Cli/bin/Release/net10.0/TesseraCiv6Extractor.dll",
  );
  const result = spawnSync(dotnetPath, [cliPath, "inspect", "--input", input], {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error !== undefined) {
    console.error(`无法启动 .NET：${result.error.message}`);
    process.exitCode = 1;
  } else {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exitCode = result.status ?? 1;
  }
}

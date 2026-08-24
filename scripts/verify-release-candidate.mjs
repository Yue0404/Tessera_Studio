import { spawnSync } from "node:child_process";
import process from "node:process";
import { resolvePnpmInvocation } from "./release-runner.mjs";

export const RELEASE_VERIFICATION_STAGES = Object.freeze([
  ["schema:check"],
  ["format:check"],
  ["lint"],
  ["typecheck"],
  ["test"],
  ["build"],
  ["pages:check"],
  ["release:check"],
  ["e2e", "--workers=1"],
  ["e2e:production"],
  ["e2e:pages"],
]);

const pnpmCli = process.env.npm_execpath;
if (pnpmCli === undefined) {
  throw new Error("release-verify-pnpm-cli-unavailable");
}
const pnpmInvocation = resolvePnpmInvocation(pnpmCli);

for (const [index, arguments_] of RELEASE_VERIFICATION_STAGES.entries()) {
  const label = arguments_.join(" ");
  console.log(
    `[release:verify ${index + 1}/${RELEASE_VERIFICATION_STAGES.length}] pnpm ${label}`,
  );
  const result = spawnSync(
    pnpmInvocation.command,
    [...pnpmInvocation.prefixArguments, ...arguments_],
    { stdio: "inherit", env: process.env },
  );
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    console.error(`发布候选门禁失败：pnpm ${label}`);
    process.exit(result.status ?? 1);
  }
}

console.log("发布候选门禁全部通过。");

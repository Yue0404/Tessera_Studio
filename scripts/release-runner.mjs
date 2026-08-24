import process from "node:process";

/** pnpm 可能由 JS CLI 或 Windows 独立 exe 提供，不能一律交给 Node 解释。 */
export function resolvePnpmInvocation(pnpmCli, nodePath = process.execPath) {
  if (/\.(?:cjs|mjs|js)$/iu.test(pnpmCli)) {
    return Object.freeze({ command: nodePath, prefixArguments: [pnpmCli] });
  }
  return Object.freeze({ command: pnpmCli, prefixArguments: [] });
}

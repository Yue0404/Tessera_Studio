import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePnpmInvocation } from "./release-runner.mjs";

test("Windows pnpm.exe 作为可执行文件直接启动", () => {
  assert.deepEqual(
    resolvePnpmInvocation("C:\\tools\\pnpm.exe", "C:\\node.exe"),
    { command: "C:\\tools\\pnpm.exe", prefixArguments: [] },
  );
});

test("JS 形式 pnpm CLI 仍由当前 Node 启动", () => {
  assert.deepEqual(resolvePnpmInvocation("/tools/pnpm.cjs", "/bin/node"), {
    command: "/bin/node",
    prefixArguments: ["/tools/pnpm.cjs"],
  });
});

import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { posix, win32 } from "node:path";
import process from "node:process";
import test from "node:test";
import {
  CIV6_MODULE_ARCHIVE_NAME,
  inspectExistingCiv6ModuleArchivePath,
  isExpectedCiv6ModuleArchivePath,
} from "./archive-path-contract.mjs";

test("POSIX路径必须位于输出父目录且文件名精确", () => {
  const output = "/tmp/tessera/output/tessera.civ6";

  assert.equal(
    isExpectedCiv6ModuleArchivePath(
      `/tmp/tessera/output/${CIV6_MODULE_ARCHIVE_NAME}`,
      output,
      posix,
    ),
    true,
  );
  assert.equal(
    isExpectedCiv6ModuleArchivePath(
      `/tmp/tessera/output/nested/${CIV6_MODULE_ARCHIVE_NAME}`,
      output,
      posix,
    ),
    false,
  );
  assert.equal(
    isExpectedCiv6ModuleArchivePath(
      "/tmp/tessera/output/TESSERA.CIV6.TESSERA-MODULE.ZIP",
      output,
      posix,
    ),
    false,
  );
});

test("Windows路径按平台语义统一分隔符和目录大小写", () => {
  const output = String.raw`d:\a\Tessera_Studio\temp\output\tessera.civ6`;

  assert.equal(
    isExpectedCiv6ModuleArchivePath(
      `D:/A/Tessera_Studio/temp/output/${CIV6_MODULE_ARCHIVE_NAME}`,
      output,
      win32,
    ),
    true,
  );
  assert.equal(
    isExpectedCiv6ModuleArchivePath(
      String.raw`D:\a\Tessera_Studio\other\${CIV6_MODULE_ARCHIVE_NAME}`,
      output,
      win32,
    ),
    false,
  );
  assert.equal(
    isExpectedCiv6ModuleArchivePath(CIV6_MODULE_ARCHIVE_NAME, output, win32),
    false,
  );
});

test("已存在归档通过真实父目录身份兼容目录链接", (context) => {
  const root = mkdtempSync(`${tmpdir()}/tessera-archive-path-`);
  try {
    const realParent = `${root}/real`;
    const aliasParent = `${root}/alias`;
    mkdirSync(`${realParent}/output`, { recursive: true });
    writeFileSync(
      `${realParent}/output/${CIV6_MODULE_ARCHIVE_NAME}`,
      "fixture",
    );
    try {
      symlinkSync(
        realParent,
        aliasParent,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if (error?.code === "EPERM" || error?.code === "EACCES") {
        context.skip("当前环境不允许创建目录链接。");
        return;
      }
      throw error;
    }

    const result = inspectExistingCiv6ModuleArchivePath(
      `${realParent}/output/${CIV6_MODULE_ARCHIVE_NAME}`,
      `${aliasParent}/output/tessera.civ6`,
    );

    assert.equal(result.matches, true);
    assert.deepEqual(result.diagnostic, {
      actualName: CIV6_MODULE_ARCHIVE_NAME,
      expectedName: CIV6_MODULE_ARCHIVE_NAME,
      relative: ".",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

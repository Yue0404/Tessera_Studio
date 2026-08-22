import assert from "node:assert/strict";
import { posix, win32 } from "node:path";
import test from "node:test";
import {
  CIV6_MODULE_ARCHIVE_NAME,
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

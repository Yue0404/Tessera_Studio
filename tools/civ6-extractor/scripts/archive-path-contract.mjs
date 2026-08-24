import { existsSync, realpathSync } from "node:fs";
import * as nodePath from "node:path";

export const CIV6_MODULE_ARCHIVE_NAME = "tessera.civ6.tessera-module.zip";

export function isExpectedCiv6ModuleArchivePath(
  archivePath,
  outputDirectory,
  pathApi = nodePath,
) {
  if (
    !pathApi.isAbsolute(archivePath) ||
    !pathApi.isAbsolute(outputDirectory)
  ) {
    return false;
  }
  if (pathApi.basename(archivePath) !== CIV6_MODULE_ARCHIVE_NAME) {
    return false;
  }

  // 输出参数指向内部 staging 目录；正式 ZIP 必须与该目录同属一个父目录。
  const expectedParent = pathApi.resolve(pathApi.dirname(outputDirectory));
  const archiveParent = pathApi.resolve(pathApi.dirname(archivePath));
  return pathApi.relative(expectedParent, archiveParent) === "";
}

export function inspectExistingCiv6ModuleArchivePath(
  archivePath,
  outputDirectory,
  pathApi = nodePath,
) {
  const actualName = pathApi.basename(archivePath);
  const missing = {
    matches: false,
    diagnostic: {
      actualName,
      expectedName: CIV6_MODULE_ARCHIVE_NAME,
      relative: "missing",
    },
  };
  if (
    !existsSync(archivePath) ||
    !existsSync(pathApi.dirname(outputDirectory))
  ) {
    return missing;
  }

  // hosted Windows 可同时暴露短路径、长路径或目录链接；只对已存在的父目录与文件解析身份。
  const canonicalOutputParent = realpathSync.native(
    pathApi.dirname(outputDirectory),
  );
  const expectedArchivePath = pathApi.join(
    canonicalOutputParent,
    CIV6_MODULE_ARCHIVE_NAME,
  );
  if (!existsSync(expectedArchivePath)) {
    return missing;
  }

  const canonicalArchivePath = realpathSync.native(archivePath);
  const canonicalExpectedArchivePath = realpathSync.native(expectedArchivePath);
  const canonicalOutputDirectory = pathApi.join(
    canonicalOutputParent,
    pathApi.basename(outputDirectory),
  );
  const relativeIdentity = pathApi.relative(
    canonicalExpectedArchivePath,
    canonicalArchivePath,
  );
  return {
    matches:
      relativeIdentity === "" &&
      isExpectedCiv6ModuleArchivePath(
        canonicalArchivePath,
        canonicalOutputDirectory,
        pathApi,
      ),
    diagnostic: {
      actualName,
      expectedName: CIV6_MODULE_ARCHIVE_NAME,
      relative: relativeIdentity || ".",
    },
  };
}

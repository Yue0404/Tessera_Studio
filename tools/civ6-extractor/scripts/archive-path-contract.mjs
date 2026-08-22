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

import { ModuleRuntimeError } from "./errors.js";
import { normalizePackagePath } from "./source.js";

const ZIP_METHOD_STORE = 0;
const ZIP_METHOD_DEFLATE = 8;
const UNIX_TYPE_MASK = 0o170000;
const UNIX_REGULAR_FILE = 0o100000;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export interface ZipEntryMetadata {
  readonly filename: string;
  readonly rawFilename: Uint8Array;
  readonly compressionMethod: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly symlink?: boolean;
  readonly encrypted?: boolean;
  readonly unixMode?: number;
  readonly unixExternalUpper?: number;
  readonly executable?: boolean;
  readonly setuid?: boolean;
  readonly setgid?: boolean;
  readonly sticky?: boolean;
  readonly bitFlag?: { readonly dataDescriptor?: boolean };
}

function invalid(
  path: string,
  details: Readonly<Record<string, unknown>>,
): never {
  throw new ModuleRuntimeError("package-resource-invalid", path, details);
}

/**
 * 校验 ZIP 中央目录可在解压前证明的单文件安全属性。
 * data descriptor 仅表示本地头尺寸可延后；中央目录尺寸可靠时仍允许。
 */
export function validateZipEntryMetadata(entry: ZipEntryMetadata): string {
  let decodedPath: string;
  try {
    decodedPath = utf8Decoder.decode(entry.rawFilename);
  } catch {
    invalid(entry.filename || "archive", { reason: "filename-not-utf8" });
  }
  if (decodedPath !== entry.filename) {
    invalid(entry.filename || "archive", { reason: "filename-not-utf8" });
  }
  const path = normalizePackagePath(decodedPath);
  if (entry.symlink || entry.encrypted) {
    invalid(path, { reason: entry.symlink ? "symlink" : "encrypted" });
  }
  if (
    entry.compressionMethod !== ZIP_METHOD_STORE &&
    entry.compressionMethod !== ZIP_METHOD_DEFLATE
  ) {
    invalid(path, {
      reason: "compression-method",
      compressionMethod: entry.compressionMethod,
    });
  }
  if (
    !Number.isSafeInteger(entry.uncompressedSize) ||
    !Number.isSafeInteger(entry.compressedSize) ||
    entry.uncompressedSize < 0 ||
    entry.compressedSize < 0
  ) {
    invalid(path, {
      reason:
        entry.bitFlag?.dataDescriptor === true
          ? "data-descriptor-size-unavailable"
          : "size-invalid",
    });
  }
  const unixType =
    (entry.unixMode ?? entry.unixExternalUpper ?? 0) & UNIX_TYPE_MASK;
  // ZIP 没有可移植的硬链接标记；只允许普通文件，所有声明出的特殊类型均 fail-closed。
  if (unixType !== 0 && unixType !== UNIX_REGULAR_FILE) {
    invalid(path, { reason: "non-regular-file", unixType });
  }
  if (
    entry.executable ||
    entry.setuid === true ||
    entry.setgid === true ||
    entry.sticky === true
  ) {
    invalid(path, { reason: "unsafe-file-mode" });
  }
  return path;
}

type ErrorFactory = (
  code: string,
  details?: Readonly<Record<string, unknown>>,
) => Error;

export interface EmbeddedAssetRecord {
  readonly assetId: string;
  readonly mimeType: string;
  readonly bytes: number;
  readonly encoding: string;
  readonly data: string;
}

function decodeBase64Strict(
  data: string,
  pointer: string,
  makeError: ErrorFactory,
): Uint8Array {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const contentLength = data.length - padding;
  let alphabetValid = data.length % 4 === 0;
  for (let index = 0; alphabetValid && index < contentLength; index += 1) {
    const code = data.charCodeAt(index);
    alphabetValid =
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a) ||
      (code >= 0x30 && code <= 0x39) ||
      code === 0x2b ||
      code === 0x2f;
  }
  if (
    !alphabetValid ||
    (padding > 0 && data.slice(0, contentLength).includes("="))
  ) {
    throw makeError("embedded-asset-base64-invalid", { pointer });
  }
  try {
    const decoded = new Uint8Array((data.length / 4) * 3 - padding);
    const chunkCharacters = 1024 * 1024;
    let outputOffset = 0;
    for (let offset = 0; offset < data.length; offset += chunkCharacters) {
      const binary = atob(data.slice(offset, offset + chunkCharacters));
      for (let index = 0; index < binary.length; index += 1) {
        decoded[outputOffset] = binary.charCodeAt(index);
        outputOffset += 1;
      }
    }
    return decoded;
  } catch {
    throw makeError("embedded-asset-base64-invalid", { pointer });
  }
}

function startsWith(bytes: Uint8Array, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[index] === value);
}

function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) * 0x1000000 +
      (bytes[offset + 1] ?? 0) * 0x10000 +
      (bytes[offset + 2] ?? 0) * 0x100 +
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

function readUint32LittleEndian(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) +
      (bytes[offset + 1] ?? 0) * 0x100 +
      (bytes[offset + 2] ?? 0) * 0x10000 +
      (bytes[offset + 3] ?? 0) * 0x1000000) >>>
    0
  );
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function validatePngStructure(
  bytes: Uint8Array,
  pointer: string,
  makeError: ErrorFactory,
): void {
  let offset = 8;
  let sawHeader = false;
  let sawData = false;
  let sawEnd = false;
  while (offset + 12 <= bytes.byteLength) {
    const length = readUint32BigEndian(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    const next = offset + 12 + length;
    if (next > bytes.byteLength) {
      throw makeError("embedded-asset-decode-invalid", { pointer });
    }
    if (!sawHeader) {
      if (type !== "IHDR" || length !== 13 || offset !== 8) {
        throw makeError("embedded-asset-decode-invalid", { pointer });
      }
      const width = readUint32BigEndian(bytes, offset + 8);
      const height = readUint32BigEndian(bytes, offset + 12);
      if (width === 0 || height === 0) {
        throw makeError("embedded-asset-decode-invalid", { pointer });
      }
      sawHeader = true;
    } else if (type === "IDAT") {
      sawData = true;
    } else if (type === "IEND") {
      if (length !== 0 || next !== bytes.byteLength) {
        throw makeError("embedded-asset-decode-invalid", { pointer });
      }
      sawEnd = true;
      break;
    }
    offset = next;
  }
  if (!sawHeader || !sawData || !sawEnd) {
    throw makeError("embedded-asset-decode-invalid", { pointer });
  }
}

function validateWebpStructure(
  bytes: Uint8Array,
  pointer: string,
  makeError: ErrorFactory,
): void {
  if (
    bytes.byteLength < 20 ||
    readUint32LittleEndian(bytes, 4) + 8 !== bytes.byteLength
  ) {
    throw makeError("embedded-asset-decode-invalid", { pointer });
  }
  let offset = 12;
  let sawImage = false;
  while (offset + 8 <= bytes.byteLength) {
    const type = ascii(bytes, offset, 4);
    const length = readUint32LittleEndian(bytes, offset + 4);
    const dataOffset = offset + 8;
    const next = dataOffset + length + (length % 2);
    if (next > bytes.byteLength) {
      throw makeError("embedded-asset-decode-invalid", { pointer });
    }
    if (type === "VP8X") {
      if (length < 10) {
        throw makeError("embedded-asset-decode-invalid", { pointer });
      }
      const width =
        1 +
        (bytes[dataOffset + 4] ?? 0) +
        (bytes[dataOffset + 5] ?? 0) * 0x100 +
        (bytes[dataOffset + 6] ?? 0) * 0x10000;
      const height =
        1 +
        (bytes[dataOffset + 7] ?? 0) +
        (bytes[dataOffset + 8] ?? 0) * 0x100 +
        (bytes[dataOffset + 9] ?? 0) * 0x10000;
      sawImage ||= width > 0 && height > 0;
      if (((bytes[dataOffset] ?? 0) & 0x02) !== 0) {
        throw makeError("embedded-asset-animation-not-allowed", { pointer });
      }
    } else if (type === "ANIM" || type === "ANMF") {
      throw makeError("embedded-asset-animation-not-allowed", { pointer });
    } else if (type === "VP8L") {
      sawImage ||= length >= 5 && bytes[dataOffset] === 0x2f;
    } else if (type === "VP8 ") {
      sawImage ||=
        length >= 10 &&
        startsWith(bytes.subarray(dataOffset + 3), [0x9d, 0x01, 0x2a]);
    }
    offset = next;
  }
  if (!sawImage || offset !== bytes.byteLength) {
    throw makeError("embedded-asset-decode-invalid", { pointer });
  }
}

function validateWoff2Structure(
  bytes: Uint8Array,
  pointer: string,
  makeError: ErrorFactory,
): void {
  const compressedSize = readUint32BigEndian(bytes, 20);
  if (
    bytes.byteLength < 48 ||
    !startsWith(bytes, [0x77, 0x4f, 0x46, 0x32]) ||
    readUint32BigEndian(bytes, 8) !== bytes.byteLength ||
    (bytes[12] ?? 0) * 0x100 + (bytes[13] ?? 0) === 0 ||
    readUint32BigEndian(bytes, 16) === 0 ||
    compressedSize === 0 ||
    compressedSize > bytes.byteLength - 48
  ) {
    throw makeError("embedded-asset-decode-invalid", { pointer });
  }
}

function validateJsonStructure(
  bytes: Uint8Array,
  pointer: string,
  makeError: ErrorFactory,
): void {
  try {
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    JSON.parse(source);
  } catch {
    throw makeError("embedded-asset-decode-invalid", { pointer });
  }
}

function validateMagic(
  asset: EmbeddedAssetRecord,
  decoded: Uint8Array,
  pointer: string,
  makeError: ErrorFactory,
): void {
  if (
    asset.mimeType === "image/png" &&
    !startsWith(decoded, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ) {
    throw makeError("embedded-asset-magic-invalid", { pointer });
  }
  if (asset.mimeType === "image/png") {
    validatePngStructure(decoded, pointer, makeError);
  }
  if (
    asset.mimeType === "image/webp" &&
    (!startsWith(decoded, [0x52, 0x49, 0x46, 0x46]) ||
      !startsWith(decoded.subarray(8), [0x57, 0x45, 0x42, 0x50]))
  ) {
    throw makeError("embedded-asset-magic-invalid", { pointer });
  }
  if (asset.mimeType === "image/webp") {
    validateWebpStructure(decoded, pointer, makeError);
  }
  if (asset.mimeType === "font/woff2") {
    validateWoff2Structure(decoded, pointer, makeError);
  }
  if (asset.mimeType === "application/json") {
    validateJsonStructure(decoded, pointer, makeError);
  }
}

export function validateEmbeddedAssets(
  assets: readonly EmbeddedAssetRecord[],
  makeError: ErrorFactory,
  pointerPrefix: string,
): void {
  const assetIds = new Set<string>();
  let totalBytes = 0;
  for (const [index, asset] of assets.entries()) {
    const pointer = `${pointerPrefix}/${index}`;
    if (assetIds.has(asset.assetId)) {
      throw makeError("embedded-asset-id-duplicate", {
        pointer,
        assetId: asset.assetId,
      });
    }
    assetIds.add(asset.assetId);
    const decoded = decodeBase64Strict(
      asset.data,
      `${pointer}/data`,
      makeError,
    );
    if (decoded.byteLength !== asset.bytes) {
      throw makeError("embedded-asset-byte-count-mismatch", {
        pointer,
        declaredBytes: asset.bytes,
        actualBytes: decoded.byteLength,
      });
    }
    validateMagic(asset, decoded, pointer, makeError);
    totalBytes += decoded.byteLength;
  }
  if (totalBytes > 128 * 1024 * 1024) {
    throw makeError("embedded-assets-total-size-exceeded", {
      pointer: pointerPrefix,
      actualBytes: totalBytes,
      maxBytes: 128 * 1024 * 1024,
    });
  }
}

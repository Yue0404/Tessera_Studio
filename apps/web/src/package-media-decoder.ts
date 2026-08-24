import {
  ModuleRuntimeError,
  type ResourceDecodeGateway,
  type ResourceDecodeRequest,
} from "@tessera/module-runtime";

export interface BrowserMediaCapabilities {
  readonly imageBitmap: boolean;
  readonly fontFace: boolean;
}

export interface BrowserMediaDecodeEnvironment {
  readonly createImageBitmap?: (blob: Blob) => Promise<ImageBitmap>;
  readonly createFontFace?: (
    family: string,
    bytes: ArrayBuffer,
  ) => { load(): Promise<FontFace> };
  readonly fonts?: Pick<FontFaceSet, "add" | "delete">;
}

function defaultEnvironment(): BrowserMediaDecodeEnvironment {
  return {
    ...(typeof createImageBitmap === "function"
      ? { createImageBitmap: (blob: Blob) => createImageBitmap(blob) }
      : {}),
    ...(typeof FontFace === "function"
      ? {
          createFontFace: (family: string, bytes: ArrayBuffer) =>
            new FontFace(family, bytes),
        }
      : {}),
    ...(typeof document !== "undefined" && "fonts" in document
      ? { fonts: document.fonts }
      : {}),
  };
}

export const MAX_PACKAGE_IMAGE_EDGE = 8_192;
export const MAX_PACKAGE_IMAGE_PIXELS = 67_108_864;

function throwIfAborted(request: ResourceDecodeRequest): void {
  if (request.signal?.aborted === true) {
    throw new ModuleRuntimeError("package-aborted", request.path);
  }
}

async function collectBlob(request: ResourceDecodeRequest): Promise<Blob> {
  const chunks: ArrayBuffer[] = [];
  let actualBytes = 0;
  for await (const chunk of request.stream) {
    throwIfAborted(request);
    actualBytes += chunk.byteLength;
    if (actualBytes > request.bytes) {
      throw new ModuleRuntimeError("package-resource-invalid", request.path, {
        declaredBytes: request.bytes,
        actualBytes,
      });
    }
    const copy = new Uint8Array(chunk.byteLength);
    copy.set(chunk);
    chunks.push(copy.buffer);
  }
  if (actualBytes !== request.bytes) {
    throw new ModuleRuntimeError("package-resource-invalid", request.path, {
      declaredBytes: request.bytes,
      actualBytes,
    });
  }
  return new Blob(chunks, { type: request.mimeType });
}

async function validateBrowserMediaHeader(
  blob: Blob,
  request: ResourceDecodeRequest,
): Promise<void> {
  const headers = new Uint8Array(
    await blob.slice(0, Math.min(blob.size, 12)).arrayBuffer(),
  );
  const matches = (expected: readonly number[]) =>
    expected.every((value, index) => headers[index] === value);
  const extension = request.path
    .slice(request.path.lastIndexOf("."))
    .toLowerCase();
  const valid =
    request.mimeType === "image/png"
      ? extension === ".png" &&
        matches([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      : request.mimeType === "image/webp"
        ? extension === ".webp" &&
          matches([0x52, 0x49, 0x46, 0x46]) &&
          headers[8] === 0x57 &&
          headers[9] === 0x45 &&
          headers[10] === 0x42 &&
          headers[11] === 0x50
        : request.mimeType === "font/woff2"
          ? extension === ".woff2" && matches([0x77, 0x4f, 0x46, 0x32])
          : false;
  if (!valid) {
    throw new ModuleRuntimeError("package-resource-invalid", request.path, {
      mimeType: request.mimeType,
      reason: "mime-extension-or-magic",
    });
  }
}

/** 使用浏览器真实解码器验证资源，并在每个资源返回前释放临时对象。 */
export class BrowserResourceDecodeGateway implements ResourceDecodeGateway {
  readonly #environment: BrowserMediaDecodeEnvironment;

  constructor(
    environment: BrowserMediaDecodeEnvironment = defaultEnvironment(),
  ) {
    this.#environment = environment;
  }

  capabilities(): BrowserMediaCapabilities {
    return Object.freeze({
      imageBitmap: this.#environment.createImageBitmap !== undefined,
      fontFace:
        this.#environment.createFontFace !== undefined &&
        this.#environment.fonts !== undefined,
    });
  }

  async validate(request: ResourceDecodeRequest): Promise<void> {
    try {
      const blob = await collectBlob(request);
      await validateBrowserMediaHeader(blob, request);
      throwIfAborted(request);
      if (
        request.mimeType === "image/png" ||
        request.mimeType === "image/webp"
      ) {
        const decode = this.#environment.createImageBitmap;
        if (decode === undefined) {
          throw new ModuleRuntimeError(
            "package-resource-decoder-unavailable",
            request.path,
            { mimeType: request.mimeType },
          );
        }
        const bitmap = await decode(blob);
        try {
          throwIfAborted(request);
          const { width, height } = bitmap;
          if (
            !Number.isSafeInteger(width) ||
            !Number.isSafeInteger(height) ||
            width <= 0 ||
            height <= 0 ||
            width > MAX_PACKAGE_IMAGE_EDGE ||
            height > MAX_PACKAGE_IMAGE_EDGE ||
            width * height > MAX_PACKAGE_IMAGE_PIXELS
          ) {
            throw new ModuleRuntimeError(
              "package-resource-invalid",
              request.path,
              {
                reason: "image-dimensions",
                width,
                height,
                maximumEdge: MAX_PACKAGE_IMAGE_EDGE,
                maximumPixels: MAX_PACKAGE_IMAGE_PIXELS,
              },
            );
          }
          return;
        } finally {
          bitmap.close();
        }
      }
      if (request.mimeType === "font/woff2") {
        const createFontFace = this.#environment.createFontFace;
        const fonts = this.#environment.fonts;
        if (createFontFace === undefined || fonts === undefined) {
          throw new ModuleRuntimeError(
            "package-resource-decoder-unavailable",
            request.path,
            { mimeType: request.mimeType },
          );
        }
        const face = await createFontFace(
          "tessera-package-" + crypto.randomUUID(),
          await blob.arrayBuffer(),
        ).load();
        throwIfAborted(request);
        try {
          fonts.add(face);
          throwIfAborted(request);
          return;
        } finally {
          fonts.delete(face);
        }
      }
      throw new ModuleRuntimeError("package-resource-invalid", request.path, {
        reason: "unsupported-browser-media",
        mimeType: request.mimeType,
      });
    } catch (error) {
      if (error instanceof ModuleRuntimeError) throw error;
      throw new ModuleRuntimeError(
        "package-resource-decode-failed",
        request.path,
        { reason: "media-decode-failed", mimeType: request.mimeType },
        error,
      );
    }
  }
}

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

async function collectBlob(request: ResourceDecodeRequest): Promise<Blob> {
  const chunks: ArrayBuffer[] = [];
  let actualBytes = 0;
  for await (const chunk of request.stream) {
    if (request.signal?.aborted === true) {
      throw new ModuleRuntimeError("package-aborted", request.path);
    }
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
      if (request.mimeType.startsWith("image/")) {
        const decode = this.#environment.createImageBitmap;
        if (decode === undefined) {
          throw new ModuleRuntimeError(
            "package-resource-decoder-unavailable",
            request.path,
            { mimeType: request.mimeType },
          );
        }
        const bitmap = await decode(blob);
        bitmap.close();
        return;
      }
      if (request.mimeType.startsWith("font/")) {
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
        fonts.add(face);
        fonts.delete(face);
        return;
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

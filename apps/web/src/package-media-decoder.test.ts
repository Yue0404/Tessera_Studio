import { describe, expect, it, vi } from "vitest";
import type { ResourceDecodeRequest } from "@tessera/module-runtime";
import {
  BrowserResourceDecodeGateway,
  type BrowserMediaDecodeEnvironment,
} from "./package-media-decoder.js";

async function* chunks(...values: readonly number[][]) {
  for (const value of values) yield new Uint8Array(value);
}

const pngHeader = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function request(
  overrides: Partial<ResourceDecodeRequest> = {},
): ResourceDecodeRequest {
  return {
    path: "assets/icon.png",
    mimeType: "image/png",
    bytes: pngHeader.length,
    stream: chunks(pngHeader.slice(0, 3), pngHeader.slice(3)),
    signal: undefined,
    ...overrides,
  };
}

describe("BrowserResourceDecodeGateway", () => {
  it("使用图片解码入口并在返回前关闭 ImageBitmap", async () => {
    const close = vi.fn();
    const decode = vi.fn(
      async () =>
        ({ close, width: 256, height: 128 }) as unknown as ImageBitmap,
    );
    const gateway = new BrowserResourceDecodeGateway({
      createImageBitmap: decode,
    });

    await gateway.validate(request());
    expect(decode).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(gateway.capabilities()).toEqual({
      imageBitmap: true,
      fontFace: false,
    });
  });

  it("真实解码失败使用稳定错误码，能力缺失单独报告", async () => {
    const failing = new BrowserResourceDecodeGateway({
      createImageBitmap: async () => {
        throw new DOMException("bad image", "EncodingError");
      },
    });
    await expect(failing.validate(request())).rejects.toMatchObject({
      code: "package-resource-decode-failed",
      path: "assets/icon.png",
    });
    await expect(
      new BrowserResourceDecodeGateway({}).validate(request()),
    ).rejects.toMatchObject({
      code: "package-resource-decoder-unavailable",
    });
  });

  it("字体验证后从 FontFaceSet 释放临时字体", async () => {
    const face = {} as FontFace;
    const add = vi.fn();
    const remove = vi.fn();
    const environment: BrowserMediaDecodeEnvironment = {
      createFontFace: () => ({ load: async () => face }),
      fonts: { add, delete: remove },
    };
    const gateway = new BrowserResourceDecodeGateway(environment);

    await gateway.validate(
      request({
        path: "assets/font.woff2",
        mimeType: "font/woff2",
        bytes: 4,
        stream: chunks([0x77, 0x4f], [0x46, 0x32]),
      }),
    );
    expect(add).toHaveBeenCalledWith(face);
    expect(remove).toHaveBeenCalledWith(face);
  });

  it("长度欺骗和取消不进入浏览器解码器", async () => {
    const decode = vi.fn(
      async () =>
        ({
          close() {
            return undefined;
          },
        }) as ImageBitmap,
    );
    const gateway = new BrowserResourceDecodeGateway({
      createImageBitmap: decode,
    });
    await expect(
      gateway.validate(request({ bytes: pngHeader.length - 1 })),
    ).rejects.toMatchObject({ code: "package-resource-invalid" });
    const controller = new AbortController();
    controller.abort();
    await expect(
      gateway.validate(request({ signal: controller.signal })),
    ).rejects.toMatchObject({ code: "package-aborted" });
    expect(decode).not.toHaveBeenCalled();
  });

  it("拒绝 MIME/扩展名/文件头错配，且不进入解码器", async () => {
    const decode = vi.fn();
    const gateway = new BrowserResourceDecodeGateway({
      createImageBitmap: decode,
    });
    await expect(
      gateway.validate(request({ path: "assets/icon.webp" })),
    ).rejects.toMatchObject({
      code: "package-resource-invalid",
      details: { reason: "mime-extension-or-magic" },
    });
    expect(decode).not.toHaveBeenCalled();
  });

  it("图片维度或像素超限仍关闭 ImageBitmap", async () => {
    const close = vi.fn();
    const gateway = new BrowserResourceDecodeGateway({
      createImageBitmap: async () =>
        ({
          close,
          width: 8_193,
          height: 1,
        }) as unknown as ImageBitmap,
    });
    await expect(gateway.validate(request())).rejects.toMatchObject({
      code: "package-resource-invalid",
      details: { reason: "image-dimensions" },
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("解码后取消会释放图片，字体注册失败也会尝试删除", async () => {
    const controller = new AbortController();
    const close = vi.fn();
    const imageGateway = new BrowserResourceDecodeGateway({
      createImageBitmap: async () => {
        controller.abort();
        return {
          close,
          width: 32,
          height: 32,
        } as unknown as ImageBitmap;
      },
    });
    await expect(
      imageGateway.validate(request({ signal: controller.signal })),
    ).rejects.toMatchObject({ code: "package-aborted" });
    expect(close).toHaveBeenCalledOnce();

    const face = {} as FontFace;
    const remove = vi.fn();
    const fontGateway = new BrowserResourceDecodeGateway({
      createFontFace: () => ({ load: async () => face }),
      fonts: {
        add() {
          throw new Error("font-register-failed");
        },
        delete: remove,
      },
    });
    await expect(
      fontGateway.validate(
        request({
          path: "assets/font.woff2",
          mimeType: "font/woff2",
          bytes: 4,
          stream: chunks([0x77, 0x4f, 0x46, 0x32]),
        }),
      ),
    ).rejects.toMatchObject({ code: "package-resource-decode-failed" });
    expect(remove).toHaveBeenCalledWith(face);
  });
});

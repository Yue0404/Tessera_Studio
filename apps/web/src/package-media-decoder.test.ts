import { describe, expect, it, vi } from "vitest";
import type { ResourceDecodeRequest } from "@tessera/module-runtime";
import {
  BrowserResourceDecodeGateway,
  type BrowserMediaDecodeEnvironment,
} from "./package-media-decoder.js";

async function* chunks(...values: readonly number[][]) {
  for (const value of values) yield new Uint8Array(value);
}

function request(
  overrides: Partial<ResourceDecodeRequest> = {},
): ResourceDecodeRequest {
  return {
    path: "assets/icon.png",
    mimeType: "image/png",
    bytes: 3,
    stream: chunks([1], [2, 3]),
    signal: undefined,
    ...overrides,
  };
}

describe("BrowserResourceDecodeGateway", () => {
  it("使用图片解码入口并在返回前关闭 ImageBitmap", async () => {
    const close = vi.fn();
    const decode = vi.fn(async () => ({ close }) as unknown as ImageBitmap);
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
    await expect(gateway.validate(request({ bytes: 2 }))).rejects.toMatchObject(
      { code: "package-resource-invalid" },
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      gateway.validate(request({ signal: controller.signal })),
    ).rejects.toMatchObject({ code: "package-aborted" });
    expect(decode).not.toHaveBeenCalled();
  });
});

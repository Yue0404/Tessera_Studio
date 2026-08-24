import type { Locator, Page } from "@playwright/test";

export interface CanvasPixelRegion {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export async function canvasPng(canvas: Locator): Promise<Buffer> {
  // WebGL 默认不保留 drawing buffer；使用浏览器合成后的元素截图才是用户实际所见。
  return canvas.screenshot();
}

/** 解码后逐像素比较，避免 PNG 压缩字节差异被误判为视觉变化。 */
export async function canvasPixelDiff(
  page: Page,
  before: Buffer,
  after: Buffer,
  region?: CanvasPixelRegion,
): Promise<number> {
  return page.evaluate(
    async ({ beforeEncoded, afterEncoded, region }) => {
      const decode = async (encoded: string) => {
        const bytes = Uint8Array.from(atob(encoded), (value) =>
          value.charCodeAt(0),
        );
        const bitmap = await createImageBitmap(
          new Blob([bytes], { type: "image/png" }),
        );
        const surface = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = surface.getContext("2d", { willReadFrequently: true });
        if (context === null) throw new Error("pixel-diff-context-unavailable");
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        return context.getImageData(0, 0, surface.width, surface.height);
      };
      const left = await decode(beforeEncoded);
      const right = await decode(afterEncoded);
      if (left.width !== right.width || left.height !== right.height)
        throw new Error("pixel-diff-size-mismatch");
      let count = 0;
      const scan = region ?? {
        left: 0,
        top: 0,
        right: left.width - 1,
        bottom: left.height - 1,
      };
      for (let y = scan.top; y <= scan.bottom; y += 1) {
        for (let x = scan.left; x <= scan.right; x += 1) {
          const offset = (y * left.width + x) * 4;
          if (
            left.data[offset] !== right.data[offset] ||
            left.data[offset + 1] !== right.data[offset + 1] ||
            left.data[offset + 2] !== right.data[offset + 2] ||
            left.data[offset + 3] !== right.data[offset + 3]
          )
            count += 1;
        }
      }
      return count;
    },
    {
      beforeEncoded: before.toString("base64"),
      afterEncoded: after.toString("base64"),
      region,
    },
  );
}

export async function canvasFeaturePixelCount(
  page: Page,
  png: Buffer,
  region: CanvasPixelRegion,
  feature: "magenta" | "cyan" | "white",
): Promise<number> {
  return page.evaluate(
    async ({ encoded, region, feature }) => {
      const bytes = Uint8Array.from(atob(encoded), (value) =>
        value.charCodeAt(0),
      );
      const bitmap = await createImageBitmap(
        new Blob([bytes], { type: "image/png" }),
      );
      const surface = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = surface.getContext("2d", { willReadFrequently: true });
      if (context === null)
        throw new Error("pixel-feature-context-unavailable");
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const pixels = context.getImageData(
        0,
        0,
        surface.width,
        surface.height,
      ).data;
      let count = 0;
      for (let y = region.top; y <= region.bottom; y += 1) {
        for (let x = region.left; x <= region.right; x += 1) {
          const offset = (y * surface.width + x) * 4;
          const red = pixels[offset] ?? 0;
          const green = pixels[offset + 1] ?? 0;
          const blue = pixels[offset + 2] ?? 0;
          const matches =
            feature === "magenta"
              ? red > 180 && green < 100 && blue > 180
              : feature === "cyan"
                ? red < 100 && green > 120 && blue > 150
                : red > 210 && green > 210 && blue > 210;
          if (matches) count += 1;
        }
      }
      return count;
    },
    { encoded: png.toString("base64"), region, feature },
  );
}

export async function settleCanvas(canvas: Locator): Promise<void> {
  await canvas.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

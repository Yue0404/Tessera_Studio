import type {
  FillRegionWorkerFactory,
  FillRegionWorkerLike,
} from "@tessera/core";

/** Vite Worker URL 只存在于 web 适配层，core 保持构建工具无关。 */
export const createFillRegionWorker: FillRegionWorkerFactory = () => {
  if (typeof Worker === "undefined") {
    throw new Error("fill-region-worker-unavailable");
  }
  return new Worker(new URL("./fill-region-worker.ts", import.meta.url), {
    type: "module",
  }) as unknown as FillRegionWorkerLike;
};

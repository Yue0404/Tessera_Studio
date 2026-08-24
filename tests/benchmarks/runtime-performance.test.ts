import { writeFile } from "node:fs/promises";
import {
  createProject,
  startBackgroundTask,
} from "../../packages/core/src/index.js";
import { describe, expect, it } from "vitest";

interface ScenarioResult {
  readonly id: string;
  readonly iterations: number;
  readonly samplesMs: readonly number[];
  readonly p50Ms: number;
  readonly p95Ms: number;
}

function percentile(samples: readonly number[], quantile: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * quantile) - 1),
  );
  return sorted[index] ?? 0;
}

function scenario(id: string, samplesMs: readonly number[]): ScenarioResult {
  return {
    id,
    iterations: samplesMs.length,
    samplesMs,
    p50Ms: percentile(samplesMs, 0.5),
    p95Ms: percentile(samplesMs, 0.95),
  };
}

const enabled = process.env.TESSERA_RUNTIME_BENCHMARK === "1";

describe.skipIf(!enabled)("benchmark-profile-v1", () => {
  it("实测 10000×2000 core 稀疏构造 20 次与 250k 调度取消", async () => {
    const coldStartSamples: number[] = [];
    for (let iteration = 0; iteration < 20; iteration += 1) {
      const startedAt = performance.now();
      const state = createProject({
        name: `冷启动-${iteration}`,
        grid: { type: "square", width: 10_000, height: 2_000, cellSize: 24 },
        style: {
          canvasBackground: "#111111FF",
          defaultCellColor: "#222222FF",
          gridColor: "#FFFFFFFF",
          gridOpacity: 1,
          gridWidth: 1,
          defaultEdgeColor: "#FFFFFFFF",
        },
      });
      state.cells.updateRuntimeViewport(
        state.grid,
        [{ row: 1_000, column: 5_000 }],
        { prefetchRings: 2, maxLoaded: 64 },
      );
      coldStartSamples.push(performance.now() - startedAt);
    }

    const holder: {
      task?: ReturnType<typeof startBackgroundTask<number>>;
    } = {};
    const cancellationStartedAt = performance.now();
    const task = startBackgroundTask(
      { mode: "background", itemCount: 250_000, estimatedHistoryBytes: 0 },
      async (context) => {
        for (let index = 0; index < 250_000; index += 1) {
          if ((index & 2047) === 0) await context.checkpoint(index);
        }
        return 250_000;
      },
      {
        yieldToEventLoop: async () => {
          holder.task?.cancel();
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        },
      },
    );
    holder.task = task;
    await expect(task.result).rejects.toMatchObject({
      code: "batch-task-cancelled",
    });
    const cancellationMs = performance.now() - cancellationStartedAt;

    const profile = {
      profile: "benchmark-profile-v1",
      generatedAt: new Date().toISOString(),
      runtime: {
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
      },
      scenarios: [
        {
          ...scenario(
            "core-sparse-project-construction-square-10000x2000",
            coldStartSamples,
          ),
          scope:
            "仅含 core 空工程构造、运行时索引初始化和单点视口分块规划；不含 JSON 读取/校验、React、Pixi、浏览器启动或首帧。",
        },
        {
          ...scenario("cooperative-scheduler-cancel-observation-250000", [
            cancellationMs,
          ]),
          scope:
            "仅含可控纯计算调度器进入首个 yield 后的取消观察；不含 250k 工程 mutation、历史记录、持久化或渲染。",
        },
      ],
    };
    const json = JSON.stringify(profile, null, 2);
    const output = process.env.TESSERA_BENCHMARK_OUTPUT;
    if (output !== undefined && output !== "") {
      await writeFile(output, `${json}\n`, "utf8");
    }
    console.log(json);
    expect(profile.scenarios[0]?.iterations).toBe(20);
  });
});

import { createProject, type ProjectState } from "@tessera/core";
import { ProjectRepository } from "@tessera/storage";

interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly code: string | number | null;
  readonly details: unknown;
  readonly cause: SerializedError | null;
}

function serializeError(error: unknown, depth = 0): SerializedError {
  if (depth >= 5 || typeof error !== "object" || error === null) {
    return {
      name: typeof error,
      message: String(error),
      code: null,
      details: null,
      cause: null,
    };
  }
  const value = error as Record<string, unknown>;
  return {
    name: typeof value.name === "string" ? value.name : "Error",
    message: typeof value.message === "string" ? value.message : String(error),
    code:
      typeof value.code === "string" || typeof value.code === "number"
        ? value.code
        : null,
    details: value.details ?? null,
    cause:
      "cause" in value && value.cause !== undefined
        ? serializeError(value.cause, depth + 1)
        : null,
  };
}

function project(name: string, updatedAt: string): ProjectState {
  return {
    ...createProject({
      name,
      grid: { type: "square", width: 2, height: 2, cellSize: 24 },
      style: {
        canvasBackground: "#09141DFF",
        defaultCellColor: "#14232DFF",
        gridColor: "#59656AFF",
        gridOpacity: 0.7,
        gridWidth: 1,
        defaultEdgeColor: "#59656AFF",
      },
    }),
    updatedAt,
  };
}

/** 仅供 Playwright 真实 Chromium IndexedDB 回归，不进入生产入口。 */
export async function saveTwoProjectsInChromium(databaseName: string) {
  const repository = new ProjectRepository(databaseName);
  try {
    await repository.save(project("新文档先保存", "2030-01-01T00:00:00.000Z"));
    await repository.save(project("旧文档后保存", "2000-01-01T00:00:00.000Z"));
    const latest = await repository.loadLatest();
    return { ok: true as const, latestName: latest?.name ?? null };
  } catch (error) {
    return { ok: false as const, error: serializeError(error) };
  } finally {
    repository.close();
  }
}

/** 复现关闭连接后保存时 Chromium 返回的完整 cause 链。 */
export async function closedRepositoryErrorInChromium(databaseName: string) {
  const repository = new ProjectRepository(databaseName);
  await repository.loadLatest();
  repository.close();
  try {
    await repository.save(project("关闭后保存", "2020-01-01T00:00:00.000Z"));
    return null;
  } catch (error) {
    return serializeError(error);
  }
}

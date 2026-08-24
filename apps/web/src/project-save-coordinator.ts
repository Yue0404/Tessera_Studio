import type { ProjectState } from "@tessera/core";
import type { ProjectSaveTarget } from "./project-file-workflow.js";

export interface ProjectReplacementOptions {
  /**
   * 派生候选已包含旧工程的当前编辑，可在候选成功后抑制旧状态保存；
   * 跨工程候选不包含旧工程，必须先把旧状态真实写入仓库。
   */
  readonly candidateIncludesPrevious: boolean;
}

/**
 * App 内所有保存共享同一串行队列，避免旧 Store 的晚到保存覆盖较新的工程候选。
 */
export class ProjectSaveCoordinator implements ProjectSaveTarget {
  readonly #target: ProjectSaveTarget;
  readonly #replacementTokens = new WeakMap<Readonly<ProjectState>, object>();
  #tail: Promise<unknown> | null = null;

  constructor(target: ProjectSaveTarget) {
    this.#target = target;
  }

  save(state: Readonly<ProjectState>): Promise<unknown> {
    return this.#enqueue(() =>
      this.#replacementTokens.has(state)
        ? Promise.resolve(undefined)
        : this.#target.save(state),
    );
  }

  /**
   * 候选保存与旧 Store 保存共用队列；候选失败时解除抑制，
   * 已排队的旧保存随后会执行真实 I/O，并把真实成败返回给调用方。
   */
  replacementTarget(
    previousState: Readonly<ProjectState>,
    options: ProjectReplacementOptions,
  ): ProjectSaveTarget {
    return {
      save: (nextState) => {
        const token = {};
        this.#replacementTokens.set(previousState, token);
        return this.#enqueue(async () => {
          try {
            if (!options.candidateIncludesPrevious) {
              await this.#target.save(previousState);
            }
            return await this.#target.save(nextState);
          } catch (error) {
            if (this.#replacementTokens.get(previousState) === token) {
              this.#replacementTokens.delete(previousState);
            }
            throw error;
          }
        });
      },
    };
  }

  #enqueue(run: () => Promise<unknown>): Promise<unknown> {
    const result = this.#tail === null ? run() : this.#tail.then(run, run);
    this.#tail = result;
    void result
      .finally(() => {
        if (this.#tail === result) this.#tail = null;
      })
      .catch(() => undefined);
    return result;
  }
}

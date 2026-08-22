export interface RepositoryLockGateway {
  withExclusive<T>(operation: () => Promise<T>): Promise<T>;
}

/** 测试与不支持 Web Locks 的环境共享同一 Promise 队列。 */
export class MemoryRepositoryLockGateway implements RepositoryLockGateway {
  #tail: Promise<void> = Promise.resolve();

  async withExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#tail.catch(() => undefined);
    let release = (): void => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#tail = previous.then(() => current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

const fallbackLock = new MemoryRepositoryLockGateway();
const LOCK_NAME = "tessera-local-package-repository-v1";

export class BrowserRepositoryLockGateway implements RepositoryLockGateway {
  async withExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const manager = globalThis.navigator?.locks;
    if (manager === undefined || typeof manager.request !== "function") {
      return fallbackLock.withExclusive(operation);
    }
    return manager.request(LOCK_NAME, { mode: "exclusive" }, operation);
  }
}

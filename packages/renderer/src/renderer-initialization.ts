export interface InitializableRenderer {
  initialize(): Promise<void>;
  destroy(): void;
}

export interface RendererInitializationCallbacks {
  onReady(): void;
  onFailure(error: unknown, disposed: boolean): void;
}

export interface RendererInitializationControl {
  readonly completion: Promise<void>;
  dispose(): void;
}

/**
 * 将异步初始化与组件清理收束为单一生命周期，避免 pending/reject 竞态重复销毁。
 */
export function startRendererInitialization(
  renderer: InitializableRenderer,
  callbacks: RendererInitializationCallbacks,
): RendererInitializationControl {
  let disposed = false;
  let destroyed = false;

  const destroyOnce = (): void => {
    if (destroyed) return;
    destroyed = true;
    renderer.destroy();
  };

  const completion = (async (): Promise<void> => {
    try {
      await renderer.initialize();
      if (disposed) destroyOnce();
      else callbacks.onReady();
    } catch (error: unknown) {
      let failure = error;
      try {
        destroyOnce();
      } catch (cleanupError: unknown) {
        failure = new AggregateError(
          [error, cleanupError],
          "Renderer initialization and cleanup both failed",
        );
      }
      callbacks.onFailure(failure, disposed);
    }
  })();

  return {
    completion,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      destroyOnce();
    },
  };
}

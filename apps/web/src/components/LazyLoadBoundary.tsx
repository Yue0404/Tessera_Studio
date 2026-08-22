import { Component, type ReactNode } from "react";

interface LazyLoadBoundaryProps {
  readonly fallback: ReactNode;
  readonly children: ReactNode;
}

interface LazyLoadBoundaryState {
  readonly failed: boolean;
}

export class LazyLoadBoundary extends Component<
  LazyLoadBoundaryProps,
  LazyLoadBoundaryState
> {
  override state: LazyLoadBoundaryState = { failed: false };

  static getDerivedStateFromError(): LazyLoadBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(): void {
    // 错误由边界内的可重试提示呈现，避免动态模块失败导致整页白屏。
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

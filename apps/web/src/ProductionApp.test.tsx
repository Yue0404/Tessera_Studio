import { I18nextProvider } from "react-i18next";
import { render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "./i18n.js";

const repositoryCounters = vi.hoisted(() => ({
  constructed: 0,
  loaded: 0,
  closed: 0,
}));

vi.mock("@tessera/storage", () => ({
  BrowserOpfsGateway: class {
    readonly kind = "opfs";
  },
  BrowserStorageEstimateGateway: class {
    readonly kind = "storage-estimate";
  },
  LocalPackageRepository: class {
    async recover() {
      return {
        completedCommitIds: [],
        rolledBackCommitIds: [],
        deletedOrphanCommitIds: [],
        issues: [],
      };
    }

    async listRegistrations() {
      return [];
    }
  },
  ProjectRepository: class {
    constructor() {
      repositoryCounters.constructed += 1;
    }

    async loadLatest() {
      repositoryCounters.loaded += 1;
      return null;
    }

    async save() {
      return undefined;
    }

    close() {
      repositoryCounters.closed += 1;
    }
  },
}));

import { ProductionApp } from "./ProductionApp.js";

describe("ProductionApp", () => {
  beforeEach(() => {
    repositoryCounters.loaded = 0;
    repositoryCounters.closed = 0;
  });

  it("包装层 rerender 保持同一仓库，不重复恢复或提前关闭", async () => {
    const view = render(
      <I18nextProvider i18n={i18n}>
        <ProductionApp />
      </I18nextProvider>,
    );
    await screen.findByRole("heading", { name: "新建地图" });
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <ProductionApp />
      </I18nextProvider>,
    );
    await Promise.resolve();
    expect(repositoryCounters).toEqual({
      constructed: 1,
      loaded: 1,
      closed: 0,
    });
    view.unmount();
    await Promise.resolve();
    expect(repositoryCounters.closed).toBe(0);
  });

  it("StrictMode 双渲染不会构造第二个页面级仓库", async () => {
    const view = render(
      <StrictMode>
        <I18nextProvider i18n={i18n}>
          <ProductionApp />
        </I18nextProvider>
      </StrictMode>,
    );
    await screen.findByRole("heading", { name: "新建地图" });
    expect(repositoryCounters.constructed).toBe(1);
    view.unmount();
    await Promise.resolve();
    expect(repositoryCounters.closed).toBe(0);
  });
});

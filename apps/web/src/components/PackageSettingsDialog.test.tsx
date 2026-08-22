import { I18nextProvider } from "react-i18next";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import i18n from "../i18n.js";
import { PackageSettingsDialog } from "./PackageSettingsDialog.js";

const registration = {
  identity: {
    kind: "module" as const,
    artifactId: "example.weather",
    version: "1.2.3",
  },
  sourceKind: "user-file" as const,
  package: null,
  status: "corrupted" as const,
  reasonCode: "local-package-storage-corrupted" as const,
};

describe("PackageSettingsDialog", () => {
  it("展示解析显示名、非敏感来源与状态原因", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <PackageSettingsDialog
          registrations={[
            {
              registration,
              displayName: "天气图层",
              statusKey: "package.status.corrupted",
              currentDependency: false,
              reasonKey: "package.reason.storageCorrupted",
              sourceDetails: [
                { labelKey: "package.source.publisher", value: "示例作者" },
                {
                  labelKey: "package.source.publishedAt",
                  value: "2026-08-22T00:00:00Z",
                },
              ],
            },
          ]}
          busy={false}
          errorKey={null}
          onImport={vi.fn()}
          onDelete={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nextProvider>,
    );
    expect(screen.getByText("天气图层")).toBeDefined();
    expect(
      screen.getByText(/example\.weather · 1\.2\.3 · 用户文件/),
    ).toBeDefined();
    expect(screen.getByText("发布者：示例作者")).toBeDefined();
    expect(screen.getByText("本地数据损坏")).toBeDefined();
    expect(
      screen.getByText("本地包文件缺失或长度不一致，需要重新导入。"),
    ).toBeDefined();
  });

  it("当前工程依赖包必须二次确认后才请求删除", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <PackageSettingsDialog
          registrations={[
            {
              registration,
              displayName: "天气图层",
              statusKey: "package.status.ready",
              currentDependency: true,
              reasonKey: null,
              sourceDetails: [],
            },
          ]}
          busy={false}
          errorKey={null}
          onImport={vi.fn()}
          onDelete={onDelete}
          onClose={vi.fn()}
        />
      </I18nextProvider>,
    );
    await user.click(screen.getByRole("button", { name: "删除本地包" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "当前工程精确依赖此包。删除后数据仍保留，但相关图层会变为只读占位，重新安装精确版本后可恢复。",
      ),
    ).toBeDefined();
    await user.click(
      screen.getByRole("button", { name: "确认删除并转为只读占位" }),
    );
    expect(onDelete).toHaveBeenCalledWith(registration);
  });
});

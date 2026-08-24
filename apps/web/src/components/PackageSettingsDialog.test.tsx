import { I18nextProvider } from "react-i18next";
import { fireEvent, render, screen } from "@testing-library/react";
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

const emptyCiv6 = {
  statusKey: "package.civ6.status.notInstalled",
  installedVersions: [],
  catalogStatus: "ready" as const,
  release: null,
};

const extractorRelease = {
  extractorId: "tessera.civ6-extractor" as const,
  version: "0.1.0-preview.1",
  os: "windows" as const,
  arch: "x64" as const,
  minOsBuild: 26100,
  artifactType: "portable-zip" as const,
  entrypoint: "TesseraCiv6Extractor.exe" as const,
  bytes: 51_549_893,
  sha256: "1".repeat(64),
  outputModuleId: "tessera.civ6" as const,
  outputModuleVersion: "1.0.0",
  minAppVersion: "0.1.0",
  assetUrl:
    "https://github.com/Yue0404/Tessera_Studio/releases/download/extractor-v0.1.0-preview.1/tessera-civ6-extractor-v0.1.0-preview.1-windows-x64.zip",
};

describe("PackageSettingsDialog", () => {
  it("文明6导入与关闭按钮使用同一局部高对比度样式", () => {
    const view = render(
      <I18nextProvider i18n={i18n}>
        <PackageSettingsDialog
          registrations={[]}
          busy={false}
          errorKey={null}
          civ6={emptyCiv6}
          onImport={vi.fn()}
          onEnableModule={vi.fn()}
          onDisableModule={vi.fn()}
          onDelete={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nextProvider>,
    );
    const importButton = screen.getByRole("button", {
      name: "导入已有文明 6 模块包",
    });
    const closeButton = screen.getByRole("button", { name: "关闭" });
    expect(importButton.className).toContain("actionButton");
    expect(closeButton.className).toBe(importButton.className);
    expect(importButton.hasAttribute("disabled")).toBe(false);

    view.rerender(
      <I18nextProvider i18n={i18n}>
        <PackageSettingsDialog
          registrations={[]}
          busy
          errorKey={null}
          civ6={emptyCiv6}
          onImport={vi.fn()}
          onEnableModule={vi.fn()}
          onDisableModule={vi.fn()}
          onDelete={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nextProvider>,
    );
    expect(
      screen
        .getByRole("button", { name: "导入已有文明 6 模块包" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "关闭" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("展示解析显示名、非敏感来源与状态原因", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <PackageSettingsDialog
          registrations={[
            {
              registration,
              displayName: "天气图层",
              statusKey: "package.status.corrupted",
              projectEnabled: false,
              canToggleProjectModule: false,
              canDeleteLocalPackage: true,
              referenceCount: 0,
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
          civ6={emptyCiv6}
          onImport={vi.fn()}
          onEnableModule={vi.fn()}
          onDisableModule={vi.fn()}
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

  it("有精确引用时拒绝停用，取消与关闭均不触发工程操作", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const onDisableModule = vi.fn();
    const onClose = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <PackageSettingsDialog
          registrations={[
            {
              registration,
              displayName: "天气图层",
              statusKey: "package.status.ready",
              projectEnabled: true,
              canToggleProjectModule: true,
              canDeleteLocalPackage: true,
              referenceCount: 7,
              reasonKey: null,
              sourceDetails: [],
            },
          ]}
          busy={false}
          errorKey={null}
          civ6={emptyCiv6}
          onImport={vi.fn()}
          onEnableModule={vi.fn()}
          onDisableModule={onDisableModule}
          onDelete={onDelete}
          onClose={onClose}
        />
      </I18nextProvider>,
    );
    await user.click(screen.getByRole("button", { name: "在当前工程停用" }));
    expect(onDisableModule).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "当前工程有 7 个对象引用此模块，必须先删除或迁移这些对象后才能停用。",
      ),
    ).toBeDefined();
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByText(/必须先删除或迁移/)).toBeNull();
    expect(onDisableModule).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "在当前工程停用" }));
    await user.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDisableModule).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("引用文档加载期间禁用停用入口，就绪后显示精确引用数", async () => {
    const user = userEvent.setup();
    const onDisableModule = vi.fn();
    const renderDialog = (
      canToggleProjectModule: boolean,
      referenceCount: number,
    ) => (
      <I18nextProvider i18n={i18n}>
        <PackageSettingsDialog
          registrations={[
            {
              registration,
              displayName: "天气图层",
              statusKey: "package.status.ready",
              projectEnabled: true,
              canToggleProjectModule,
              canDeleteLocalPackage: true,
              referenceCount,
              reasonKey: null,
              sourceDetails: [],
            },
          ]}
          busy={false}
          errorKey={null}
          civ6={emptyCiv6}
          onImport={vi.fn()}
          onEnableModule={vi.fn()}
          onDisableModule={onDisableModule}
          onDelete={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nextProvider>
    );
    const view = render(renderDialog(false, 0));
    const loadingButton = screen.getByRole("button", {
      name: "在当前工程停用",
    });
    expect(loadingButton.hasAttribute("disabled")).toBe(true);
    await user.click(loadingButton);
    expect(onDisableModule).not.toHaveBeenCalled();

    view.rerender(renderDialog(true, 7));
    await user.click(screen.getByRole("button", { name: "在当前工程停用" }));
    expect(onDisableModule).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "当前工程有 7 个对象引用此模块，必须先删除或迁移这些对象后才能停用。",
      ),
    ).toBeDefined();
  });

  it("缺包占位无删除入口，有引用拒绝且零引用时可停用", async () => {
    const user = userEvent.setup();
    const onDisableModule = vi.fn();
    const onDelete = vi.fn();
    const renderMissing = (referenceCount: number) => (
      <I18nextProvider i18n={i18n}>
        <PackageSettingsDialog
          registrations={[
            {
              registration,
              displayName: "example.weather",
              statusKey: "package.status.missing",
              projectEnabled: true,
              canToggleProjectModule: true,
              canDeleteLocalPackage: false,
              referenceCount,
              reasonKey: "package.reason.missing",
              sourceDetails: [],
            },
          ]}
          busy={false}
          errorKey={null}
          civ6={emptyCiv6}
          onImport={vi.fn()}
          onEnableModule={vi.fn()}
          onDisableModule={onDisableModule}
          onDelete={onDelete}
          onClose={vi.fn()}
        />
      </I18nextProvider>
    );
    const view = render(renderMissing(3));
    expect(screen.getByText("本地包缺失")).toBeDefined();
    expect(
      screen.getByText("本地包已删除或缺失；零引用时仍可从当前工程停用。"),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: "删除本地包" })).toBeNull();
    expect(screen.queryByRole("button", { name: "在当前工程启用" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "在当前工程停用" }));
    expect(onDisableModule).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "当前工程有 3 个对象引用此模块，必须先删除或迁移这些对象后才能停用。",
      ),
    ).toBeDefined();
    await user.click(screen.getByRole("button", { name: "取消" }));

    view.rerender(renderMissing(0));
    await user.click(screen.getByRole("button", { name: "在当前工程停用" }));
    expect(onDisableModule).toHaveBeenCalledWith(registration);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("零引用模块可停用，工程停用与本地删除使用独立回调", async () => {
    const user = userEvent.setup();
    const onDisableModule = vi.fn();
    const onDelete = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <PackageSettingsDialog
          registrations={[
            {
              registration,
              displayName: "天气图层",
              statusKey: "package.status.ready",
              projectEnabled: true,
              canToggleProjectModule: true,
              canDeleteLocalPackage: true,
              referenceCount: 0,
              reasonKey: null,
              sourceDetails: [],
            },
          ]}
          busy={false}
          errorKey={null}
          civ6={emptyCiv6}
          onImport={vi.fn()}
          onEnableModule={vi.fn()}
          onDisableModule={onDisableModule}
          onDelete={onDelete}
          onClose={vi.fn()}
        />
      </I18nextProvider>,
    );
    await user.click(screen.getByRole("button", { name: "在当前工程停用" }));
    expect(onDisableModule).toHaveBeenCalledWith(registration);
    expect(onDelete).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "删除本地包" }));
    await user.click(
      screen.getByRole("button", { name: "确认删除并转为只读占位" }),
    );
    expect(onDelete).toHaveBeenCalledWith(registration);
  });

  it("未启用模块按精确注册版本启用，basic 不提供停用入口", async () => {
    const user = userEvent.setup();
    const onEnableModule = vi.fn();
    const view = render(
      <I18nextProvider i18n={i18n}>
        <PackageSettingsDialog
          registrations={[
            {
              registration,
              displayName: "天气图层",
              statusKey: "package.status.ready",
              projectEnabled: false,
              canToggleProjectModule: true,
              canDeleteLocalPackage: true,
              referenceCount: 0,
              reasonKey: null,
              sourceDetails: [],
            },
          ]}
          busy={false}
          errorKey={null}
          civ6={emptyCiv6}
          onImport={vi.fn()}
          onEnableModule={onEnableModule}
          onDisableModule={vi.fn()}
          onDelete={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nextProvider>,
    );
    await user.click(screen.getByRole("button", { name: "在当前工程启用" }));
    expect(onEnableModule).toHaveBeenCalledWith(registration);

    view.rerender(
      <I18nextProvider i18n={i18n}>
        <PackageSettingsDialog
          registrations={[
            {
              registration: {
                ...registration,
                identity: {
                  kind: "module",
                  artifactId: "tessera.basic",
                  version: "1.0.0",
                },
              },
              displayName: "基础模块",
              statusKey: "package.status.ready",
              projectEnabled: true,
              canToggleProjectModule: false,
              canDeleteLocalPackage: true,
              referenceCount: 0,
              reasonKey: null,
              sourceDetails: [],
            },
          ]}
          busy={false}
          errorKey={null}
          civ6={emptyCiv6}
          onImport={vi.fn()}
          onEnableModule={vi.fn()}
          onDisableModule={vi.fn()}
          onDelete={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nextProvider>,
    );
    expect(screen.queryByRole("button", { name: "在当前工程停用" })).toBeNull();
    expect(screen.getByText("始终启用")).toBeDefined();
  });

  it("展示匹配提取器的完整事实并只提供安全外部 HTTPS 链接", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <PackageSettingsDialog
          registrations={[]}
          busy={false}
          errorKey={null}
          civ6={{
            statusKey: "package.civ6.status.installed",
            installedVersions: ["1.0.0"],
            catalogStatus: "ready",
            release: extractorRelease,
          }}
          onImport={vi.fn()}
          onEnableModule={vi.fn()}
          onDisableModule={vi.fn()}
          onDelete={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nextProvider>,
    );
    expect(screen.getByText("已安装精确版本：1.0.0")).toBeDefined();
    expect(screen.getByText("提取器版本：0.1.0-preview.1")).toBeDefined();
    expect(screen.getByText("平台：Windows x64")).toBeDefined();
    expect(screen.getByText(/Windows 11 24H2.*26100/)).toBeDefined();
    expect(screen.getByText(/51,549,893/)).toBeDefined();
    expect(screen.getByText(/1111111111111111/)).toBeDefined();
    expect(screen.getByText(/SmartScreen/)).toBeDefined();
    const link = screen.getByRole("link", {
      name: "下载匹配版本提取器",
    });
    expect(link.getAttribute("href")).toBe(extractorRelease.assetUrl);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("文明6导入按钮复用通用文件输入与 onImport 工作流", async () => {
    const user = userEvent.setup();
    const onImport = vi.fn();
    const clickInput = vi.spyOn(HTMLInputElement.prototype, "click");
    render(
      <I18nextProvider i18n={i18n}>
        <PackageSettingsDialog
          registrations={[]}
          busy={false}
          errorKey={null}
          civ6={{ ...emptyCiv6, catalogStatus: "error" }}
          onImport={onImport}
          onEnableModule={vi.fn()}
          onDisableModule={vi.fn()}
          onDelete={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nextProvider>,
    );
    await user.click(
      screen.getByRole("button", { name: "导入已有文明 6 模块包" }),
    );
    expect(clickInput).toHaveBeenCalledTimes(1);
    const file = new File(["zip"], "tessera.civ6.tessera-module.zip", {
      type: "application/zip",
    });
    const input = document.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("缺少包文件输入");
    fireEvent.change(input, {
      target: { files: [file] },
    });
    expect(onImport).toHaveBeenCalledWith(file);
    expect(screen.getByRole("alert").textContent).toContain(
      "基础网站和本地包导入仍可正常使用",
    );
    clickInput.mockRestore();
  });

  it.each([
    ["package.civ6.status.notInstalled", "未安装"],
    ["package.civ6.status.corrupted", "本地包损坏，需要重新导入"],
    ["package.civ6.status.incompatible", "已安装版本与当前应用或网格不兼容"],
  ])("覆盖文明6包状态 %s", (statusKey, expected) => {
    const view = render(
      <I18nextProvider i18n={i18n}>
        <PackageSettingsDialog
          registrations={[]}
          busy={false}
          errorKey={null}
          civ6={{ ...emptyCiv6, statusKey }}
          onImport={vi.fn()}
          onEnableModule={vi.fn()}
          onDisableModule={vi.fn()}
          onDelete={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nextProvider>,
    );
    expect(screen.getByText(expected)).toBeDefined();
    view.unmount();
  });
});

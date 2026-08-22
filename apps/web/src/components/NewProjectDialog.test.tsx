import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import i18n from "../i18n.js";
import { NewProjectDialog } from "./NewProjectDialog.js";

describe("NewProjectDialog", () => {
  it("拒绝超限尺寸并保留同一表单参数", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <NewProjectDialog onCreate={onCreate} />
      </I18nextProvider>,
    );
    await user.type(screen.getByLabelText("工程名称"), "边界工程");
    const width = screen.getByLabelText("宽度");
    await user.clear(width);
    await user.type(width, "40001");
    await user.click(screen.getByRole("button", { name: "创建工程" }));
    expect(screen.getByRole("alert").textContent).toContain("1–40000");
    expect(onCreate).not.toHaveBeenCalled();
    expect((screen.getByLabelText("工程名称") as HTMLInputElement).value).toBe(
      "边界工程",
    );
  });

  it("已安装模块选择随创建提交精确版本且不清空参数", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <NewProjectDialog
          onCreate={onCreate}
          installedModules={[
            {
              identity: "module:example.weather@1.0.0",
              label: "天气图层",
              statusKey: "package.status.available",
              supportedGrids: ["hex-pointy", "square"],
            },
          ]}
        />
      </I18nextProvider>,
    );
    await user.type(screen.getByLabelText("工程名称"), "参数保留");
    const checkbox = screen.getByRole("checkbox", { name: "天气图层" });
    await user.click(checkbox);
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("工程名称") as HTMLInputElement).value).toBe(
      "参数保留",
    );
    await user.click(screen.getByRole("button", { name: "创建工程" }));
    expect(onCreate.mock.calls[0]?.[1]).toEqual({
      moduleIdentities: ["module:example.weather@1.0.0"],
    });
  });

  it("网格切换会禁用不兼容包，已安装包覆盖同 ID 占位行", async () => {
    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={i18n}>
        <NewProjectDialog
          onCreate={vi.fn()}
          installedModules={[
            {
              identity: "module:tessera.civ6@1.0.0",
              label: "文明 6 规划",
              statusKey: "package.status.ready",
              supportedGrids: ["hex-pointy"],
            },
          ]}
          installedPresets={[
            {
              identity: "preset:example.hex@1.0.0",
              label: "六边形预设",
              statusKey: "package.status.ready",
              supportedGrids: ["hex-pointy"],
            },
          ]}
        />
      </I18nextProvider>,
    );
    expect(screen.getAllByText("文明 6 规划")).toHaveLength(1);
    const module = screen.getByRole("checkbox", { name: "文明 6 规划" });
    await user.click(module);
    expect((module as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole("radio", { name: "正方形" }));
    await waitFor(() => {
      expect((module as HTMLInputElement).disabled).toBe(true);
      expect((module as HTMLInputElement).checked).toBe(false);
    });
    const preset = screen.getByRole("option", { name: /六边形预设/ });
    expect((preset as HTMLOptionElement).disabled).toBe(true);
    expect(screen.getAllByText("不支持当前网格").length).toBeGreaterThan(0);
  });

  it("创建 40000×40000 工程时不实例化地格、分块或边", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <NewProjectDialog onCreate={onCreate} />
      </I18nextProvider>,
    );
    await user.type(screen.getByLabelText("工程名称"), "超大稀疏工程");
    for (const label of ["宽度", "高度"]) {
      const input = screen.getByLabelText(label);
      await user.clear(input);
      await user.type(input, "40000");
    }
    await user.click(screen.getByRole("button", { name: "创建工程" }));
    const project = onCreate.mock.calls[0]?.[0];
    expect(project.cells.size).toBe(0);
    expect(project.edges.size).toBe(0);
  });

  it("缺失包进入设置后返回仍保留已填创建参数", async () => {
    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={i18n}>
        <NewProjectDialog onCreate={vi.fn()} />
      </I18nextProvider>,
    );
    await user.type(screen.getByLabelText("工程名称"), "设置往返");
    await user.click(screen.getByRole("button", { name: "设置" }));
    expect(screen.getByRole("region", { name: "扩展包设置" })).toBeDefined();
    await user.click(screen.getByRole("button", { name: "返回表单" }));
    expect((screen.getByLabelText("工程名称") as HTMLInputElement).value).toBe(
      "设置往返",
    );
  });

  it.each(["", "0", "-1", "1.5", "40001", "not-a-number"])(
    "业务校验拒绝非法宽度 %s",
    async (invalid) => {
      const user = userEvent.setup();
      const onCreate = vi.fn();
      render(
        <I18nextProvider i18n={i18n}>
          <NewProjectDialog onCreate={onCreate} />
        </I18nextProvider>,
      );
      await user.type(screen.getByLabelText("工程名称"), "非法边界");
      fireEvent.change(screen.getByLabelText("宽度"), {
        target: { value: invalid },
      });
      await user.click(screen.getByRole("button", { name: "创建工程" }));
      expect(onCreate).not.toHaveBeenCalled();
      expect(screen.getByRole("alert").textContent).toContain("1–40000");
    },
  );

  it("工程文件选择后清空 input，允许再次选择同一文件", async () => {
    const onOpenFile = vi.fn(async () => undefined);
    render(
      <I18nextProvider i18n={i18n}>
        <NewProjectDialog onCreate={vi.fn()} onOpenFile={onOpenFile} />
      </I18nextProvider>,
    );
    const input = screen.getByLabelText("打开");
    if (!(input instanceof HTMLInputElement)) throw new Error("缺少文件输入");
    const selected = new File(["{}"], "same.tessera-project.json");
    fireEvent.change(input, { target: { files: [selected] } });
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { files: [selected] } });
    expect(onOpenFile).toHaveBeenCalledTimes(2);
  });

  it("启动恢复错误保持可见，同时仍允许新建与载入", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <NewProjectDialog
          onCreate={vi.fn()}
          onOpenFile={vi.fn(async () => undefined)}
          externalErrorKey="error.projectRecoveryFailed"
        />
      </I18nextProvider>,
    );
    expect(screen.getByRole("alert").textContent).toContain("本地工程恢复失败");
    expect(screen.getByRole("button", { name: "创建工程" })).toBeDefined();
    expect(screen.getByText("打开")).toBeDefined();
  });

  it("预设必需模块不可用或版本冲突时在提交前禁用并说明原因", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const availablePreset = {
      identity: "preset:example.plan@1.0.0",
      label: "规划预设",
      supportedGrids: ["hex-pointy" as const, "square" as const],
      availabilityByGrid: {
        "hex-pointy": "available" as const,
        square: "available" as const,
      },
    };
    const view = render(
      <I18nextProvider i18n={i18n}>
        <NewProjectDialog
          onCreate={onCreate}
          installedPresets={[availablePreset]}
        />
      </I18nextProvider>,
    );
    await user.selectOptions(
      screen.getByLabelText("新建预设"),
      availablePreset.identity,
    );
    expect(
      (screen.getByRole("button", { name: "创建工程" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);

    view.rerender(
      <I18nextProvider i18n={i18n}>
        <NewProjectDialog
          onCreate={onCreate}
          installedPresets={[
            {
              ...availablePreset,
              availabilityByGrid: {
                "hex-pointy": "required-unavailable",
                square: "required-unavailable",
              },
            },
            {
              ...availablePreset,
              identity: "preset:example.range@1.0.0",
              label: "范围无匹配预设",
              availabilityByGrid: {
                "hex-pointy": "required-unavailable",
                square: "required-unavailable",
              },
            },
            {
              ...availablePreset,
              identity: "preset:example.conflict@1.0.0",
              label: "多版本冲突预设",
              availabilityByGrid: {
                "hex-pointy": "version-conflict",
                square: "version-conflict",
              },
            },
            {
              ...availablePreset,
              identity: "preset:example.incompatible@1.0.0",
              label: "必需模块不兼容预设",
              availabilityByGrid: {
                "hex-pointy": "incompatible",
                square: "incompatible",
              },
            },
          ]}
        />
      </I18nextProvider>,
    );

    expect(
      (screen.getByRole("option", { name: /规划预设/ }) as HTMLOptionElement)
        .disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("option", {
          name: /范围无匹配预设/,
        }) as HTMLOptionElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("option", {
          name: /多版本冲突预设/,
        }) as HTMLOptionElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("option", {
          name: /必需模块不兼容预设/,
        }) as HTMLOptionElement
      ).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "创建工程" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getAllByText(/必需模块缺失或没有匹配版本/).length).toBe(2);
    expect(screen.getByText(/多个版本同时匹配/)).toBeDefined();
    expect(screen.getByText(/与当前应用或网格不兼容/)).toBeDefined();
    expect(onCreate).not.toHaveBeenCalled();
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
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

  it("设置返回与可选包选择都留在同一表单且不清空参数", async () => {
    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={i18n}>
        <NewProjectDialog
          onCreate={vi.fn()}
          optionalPackages={[
            {
              moduleId: "tessera.civ6",
              version: "1.0.0",
              required: false,
              supportedGrids: ["hex-pointy"],
              appVersion: { min: "0.1.0" },
              status: "available",
              nameKey: "package.civ6.name",
              statusKey: "package.status.available",
            },
          ]}
        />
      </I18nextProvider>,
    );
    await user.type(screen.getByLabelText("工程名称"), "参数保留");
    const checkbox = screen.getByRole("checkbox", { name: "文明 6 规划" });
    await user.click(checkbox);
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("工程名称") as HTMLInputElement).value).toBe(
      "参数保留",
    );
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
});

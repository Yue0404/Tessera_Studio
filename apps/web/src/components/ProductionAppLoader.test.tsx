import { I18nextProvider } from "react-i18next";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import i18n from "../i18n.js";
import { ProductionAppLoader } from "./ProductionAppLoader.js";

function FailingProductionApp(): never {
  throw new Error("production-chunk-failed");
}

describe("ProductionAppLoader", () => {
  it("生产入口模块失败时显示 key 化提示并可重试", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const onReload = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <ProductionAppLoader
          component={FailingProductionApp}
          onReload={onReload}
        />
      </I18nextProvider>,
    );
    await screen.findByText(i18n.t("app.loadFailed"));
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("action.retry") }),
    );
    expect(onReload).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});

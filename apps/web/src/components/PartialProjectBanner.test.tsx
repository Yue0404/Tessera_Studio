import { I18nextProvider } from "react-i18next";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import i18n from "../i18n.js";
import { PartialProjectBanner } from "./PartialProjectBanner.js";

describe("PartialProjectBanner", () => {
  it("只根据 formatSource 持续展示来源与省略信息", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <PartialProjectBanner
          source={{
            exportScope: "partial",
            isComplete: false,
            opaqueDocument: null,
            lineage: {
              sourceProjectId: "11111111-1111-4111-8111-111111111111",
              omittedLayerIds: ["layer.a", "layer.b"],
            },
          }}
        />
      </I18nextProvider>,
    );
    expect(screen.getByRole("status").textContent).toContain("当前为部分工程");
    expect(screen.getByRole("status").textContent).toContain("2 个");
  });

  it("完整工程不显示提示", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <PartialProjectBanner
          source={{
            exportScope: "full",
            isComplete: true,
            opaqueDocument: null,
            lineage: null,
          }}
        />
      </I18nextProvider>,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });
});

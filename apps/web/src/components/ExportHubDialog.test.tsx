import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createProject } from "@tessera/core";
import type { VisualExportCaptureOptions } from "@tessera/renderer/visual-export";
import { describe, expect, it, vi } from "vitest";
import i18n from "../i18n.js";
import { ExportHubDialog } from "./ExportHubDialog.js";

const visualExportDialog = vi.hoisted(() =>
  vi.fn((props: Record<string, unknown>) => {
    void props;
    return null;
  }),
);
vi.mock("./VisualExportDialog.js", () => ({
  VisualExportDialog: visualExportDialog,
}));

describe("ExportHubDialog", () => {
  it("图片导出分支继续传递 generic captureOptions", () => {
    const state = createProject({
      name: "导出中心",
      grid: { type: "square", width: 4, height: 4, cellSize: 24 },
      style: {
        canvasBackground: "#09141DFF",
        defaultCellColor: "#14232DFF",
        gridColor: "#59656AFF",
        gridOpacity: 0.7,
        gridWidth: 1,
        defaultEdgeColor: "#59656AFF",
      },
    });
    const captureOptions: VisualExportCaptureOptions = {
      requiredExtensionElementIds: ["example.weather:cell.rain"],
      extensionRenderers: [],
    };
    render(
      <I18nextProvider i18n={i18n}>
        <ExportHubDialog
          state={state}
          selectionBounds={null}
          viewportBounds={{ minX: 0, minY: 0, maxX: 96, maxY: 96 }}
          captureOptions={captureOptions}
          onClose={vi.fn()}
        />
      </I18nextProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /图片导出/u }));

    expect(visualExportDialog.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ captureOptions }),
    );
  });
});

import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import i18n from "../i18n.js";
import { ProjectGridPreview } from "./ProjectGridPreview.js";

describe("ProjectGridPreview", () => {
  it.each(["square", "hex-pointy"] as const)(
    "%s 使用真实多边形并反映尺寸和样式",
    (gridType) => {
      const { rerender, container } = render(
        <I18nextProvider i18n={i18n}>
          <ProjectGridPreview
            gridType={gridType}
            width={30}
            height={20}
            cellSize={36}
            background="#0D2635"
            cellColor="#14232D"
            gridColor="#59656A"
            gridOpacity={0.7}
            gridWidth={1}
          />
        </I18nextProvider>,
      );
      const svg = screen.getByRole("img");
      expect(svg.getAttribute("data-grid-type")).toBe(gridType);
      expect(svg.getAttribute("data-map-width")).toBe("30");
      expect(container.querySelectorAll("polygon")).toHaveLength(12);
      rerender(
        <I18nextProvider i18n={i18n}>
          <ProjectGridPreview
            gridType={gridType}
            width={2}
            height={2}
            cellSize={48}
            background="#101010"
            cellColor="#202020"
            gridColor="#303030"
            gridOpacity={0.5}
            gridWidth={2}
          />
        </I18nextProvider>,
      );
      expect(container.querySelectorAll("polygon")).toHaveLength(4);
      expect(screen.getByRole("img").getAttribute("style")).toContain(
        "background-color: rgb(16, 16, 16)",
      );
    },
  );
});

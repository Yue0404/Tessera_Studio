import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import i18n from "../i18n.js";
import { ElementCatalog } from "./ElementCatalog.js";

describe("ElementCatalog", () => {
  it("放置文字的旋转输入保持度数并规范化到 [0,360)", () => {
    const onTextOptions = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <ElementCatalog
          collapsed={false}
          onToggle={vi.fn()}
          brushColor="#E3614D"
          brushMode="paint"
          edgeColor="#D9B866"
          overlay={{ type: "text", anchor: "map-point" }}
          textOptions={{
            text: "方向",
            fontSize: 18,
            color: "#F4EFE4",
            fontWeight: "normal",
            align: "center",
            rotation: 90,
          }}
          connection={{
            kind: "arrow",
            endpoint: "cell-center",
            arrowMode: "end",
            label: "",
          }}
          onBrushColor={vi.fn()}
          onBrushMode={vi.fn()}
          onEdgeColor={vi.fn()}
          onOverlay={vi.fn()}
          onTextOptions={onTextOptions}
          onConnection={vi.fn()}
        />
      </I18nextProvider>,
    );
    const rotation = screen.getByLabelText("旋转（度）");
    expect((rotation as HTMLInputElement).value).toBe("90");
    fireEvent.change(rotation, { target: { value: "-90" } });
    expect(onTextOptions).toHaveBeenCalledWith(
      expect.objectContaining({ rotation: 270 }),
    );
  });
});

/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function css(name: string): string {
  return readFileSync(new URL(name, import.meta.url), "utf8");
}

describe("1280 × 720 编辑器静态布局契约", () => {
  it("左右面板和快捷弹窗保留首屏空间且滚动区域可达", () => {
    const context = css("./ContextPanel.module.css");
    const catalog = css("./ElementCatalog.module.css");
    const rail = css("./CanvasToolRail.module.css");
    const global = css("../styles/global.css");

    expect(context).toMatch(/@media \(max-width: 1280px\)[\s\S]*width: 288px/u);
    expect(context).toContain("max-height: calc(100vh - 134px)");
    expect(context).toContain("max-height: min(440px, calc(100vh - 260px))");
    expect(catalog).toContain("top: 76px");
    expect(catalog).toContain("bottom: 58px");
    expect(rail).toContain("left: calc(100% + 10px)");
    expect(global).toContain("scrollbar-width: thin");
    expect(global).toContain("*::-webkit-scrollbar-thumb");
  });
});

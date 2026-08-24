import { textLayout } from "../visual-style.js";
import type { VisualPrimitive } from "./types.js";

/** svg、defs、clipPath、clip rect 与裁切内容 g。 */
export const SVG_STRUCTURAL_NODE_COUNT = 5;

export function svgTextNodeCountFromLineCount(
  lineCount: number,
  backgroundVisible: boolean,
): number {
  return 2 + lineCount + (backgroundVisible ? 1 : 0);
}

export function svgTextNodeCount(
  text: string,
  fontSize: number,
  backgroundVisible: boolean,
  wrapWidth?: number,
): number {
  return svgTextNodeCountFromLineCount(
    textLayout(text, fontSize, wrapWidth).lines.length,
    backgroundVisible,
  );
}

/** 返回一个声明式图元实际生成的 SVG 元素节点数。 */
export function svgPrimitiveNodeCount(primitive: VisualPrimitive): number {
  if (primitive.kind !== "text") return 1;
  return svgTextNodeCount(
    primitive.text,
    primitive.fontSize,
    primitive.backgroundColor !== null,
    primitive.wrapWidth,
  );
}

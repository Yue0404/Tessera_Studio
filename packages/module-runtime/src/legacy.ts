import type { GridType } from "@tessera/core";
import type { PackageChoice } from "./types.js";

// 这些轻量常量仍供新建工程流程使用，不应静态拉入完整包解析器。
export const BASIC_MODULE: PackageChoice = {
  moduleId: "tessera.basic",
  version: "1.0.0",
  required: true,
  supportedGrids: ["square", "hex-pointy"],
  appVersion: { min: "0.1.0" },
  status: "enabled",
  nameKey: "package.basic.name",
  statusKey: "package.status.alwaysEnabled",
};

export function packageSupportsGrid(
  choice: PackageChoice,
  grid: GridType,
): boolean {
  return choice.supportedGrids.includes(grid);
}

export const OPTIONAL_PACKAGE_PLACEHOLDERS: readonly PackageChoice[] =
  Object.freeze([
    {
      moduleId: "tessera.civ6",
      version: "1.0.0",
      required: false,
      supportedGrids: ["hex-pointy"],
      appVersion: { min: "0.1.0" },
      status: "missing",
      nameKey: "package.civ6.name",
      statusKey: "package.status.notInstalled",
    },
  ]);

export const BASIC_TOOL_IDS = Object.freeze([
  "select",
  "pan",
  "brush",
  "edge",
  "marker",
  "connection",
  "box-select",
]);

export const BASIC_OPERATIONS = Object.freeze([
  ...BASIC_TOOL_IDS,
  "cell.paint",
  "cell.erase",
  "cell.fill",
  "edge.style",
  "overlay.marker.create",
  "overlay.text.create",
  "overlay.update",
  "overlay.delete",
  "connection.line.create",
  "connection.arrow.create",
  "connection.update",
  "connection.delete",
]);

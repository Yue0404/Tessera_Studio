import { describe, expect, it, vi } from "vitest";
import {
  GENERIC_MODULE_PATTERN_ORIGIN,
  GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER,
  GenericModuleResourceStateRegistry,
  genericModuleCellPatternPlan,
  genericModuleMarkerImageSize,
  genericModulePatternTileSize,
  genericModuleResourceKey,
  parseGenericModuleResourceKey,
  type GenericModuleResourceState,
} from "./generic-module-assets.js";

const identity = {
  moduleId: "example.module",
  version: "1.2.3-beta.1+asset",
  resourceId: "example.module:marker.icon",
} as const;

describe("通用模块纯资源契约", () => {
  it("精确资源键可无损往返且拒绝跨模块或含路径身份", () => {
    const key = genericModuleResourceKey(identity);

    expect(key).toBe(
      "example.module@1.2.3-beta.1+asset/example.module:marker.icon",
    );
    expect(parseGenericModuleResourceKey(key)).toEqual(identity);
    expect(
      parseGenericModuleResourceKey("example.module@1.0.0/other.module:marker"),
    ).toBeNull();
    expect(() =>
      genericModuleResourceKey({
        ...identity,
        resourceId: "assets/marker.png",
      }),
    ).toThrow("generic-module-resource-identity-invalid");
  });

  it("发布状态会精确通知 key/status，退订为幂等操作", () => {
    const registry = new GenericModuleResourceStateRegistry();
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);
    const key = genericModuleResourceKey(identity);
    const loading: GenericModuleResourceState = {
      key,
      identity,
      status: "loading",
    };

    registry.publish(loading);
    registry.publish(loading);
    expect(registry.resolve(key)).toBe(loading);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith({ key, status: "loading" });

    unsubscribe();
    unsubscribe();
    registry.publish({ key, identity, status: "disposed" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("失败占位稳定可识别且状态保留 resourceId", () => {
    const key = genericModuleResourceKey(identity);
    const failed: GenericModuleResourceState = {
      key,
      identity,
      status: "failed",
      code: "resource-decode-failed",
      placeholder: GENERIC_MODULE_RESOURCE_FAILURE_PLACEHOLDER,
    };

    expect(failed.identity.resourceId).toBe("example.module:marker.icon");
    expect(failed.placeholder).toEqual({
      kind: "warning-checker",
      label: "resource-unavailable",
      primaryColor: "#FF00FFFF",
      secondaryColor: "#202020FF",
      strokeWidth: 2,
      strokeDashPattern: [4, 3],
      markerCrossRatio: 1 / 3,
      textBackgroundColor: "#FF00FFFF",
    });
  });

  it("marker 保持宽高比，pattern 使用全局原点与无量纲倍率", () => {
    expect(genericModuleMarkerImageSize(200, 100, 40)).toEqual({
      width: 40,
      height: 20,
    });
    expect(genericModuleMarkerImageSize(100, 200, 40)).toEqual({
      width: 20,
      height: 40,
    });
    expect(GENERIC_MODULE_PATTERN_ORIGIN).toEqual({ x: 0, y: 0 });
    expect(genericModulePatternTileSize(12, 8, 1.5)).toEqual({
      width: 18,
      height: 12,
    });
  });

  it.each([
    [
      "方形",
      [
        { x: 0, y: 0 },
        { x: 32, y: 0 },
        { x: 32, y: 32 },
        { x: 0, y: 32 },
      ],
    ],
    [
      "尖顶六边形",
      [
        { x: 16, y: 0 },
        { x: 32, y: 8 },
        { x: 32, y: 24 },
        { x: 16, y: 32 },
        { x: 0, y: 24 },
        { x: 0, y: 8 },
      ],
    ],
  ] as const)("%s pattern 保留多边形裁剪且共享全局相位", (_name, polygon) => {
    const plan = genericModuleCellPatternPlan(polygon, 8, 4, 2);
    expect(plan.clipPolygon).toEqual(polygon);
    expect(plan.clipPolygon).not.toBe(polygon);
    expect(plan.origin).toBe(GENERIC_MODULE_PATTERN_ORIGIN);
    expect(plan.tileSize).toEqual({ width: 16, height: 8 });
  });
});

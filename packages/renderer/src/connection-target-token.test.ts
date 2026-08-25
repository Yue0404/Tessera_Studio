import { describe, expect, it } from "vitest";
import { connectionTargetToken } from "./connection-target-token.js";

describe("连接端点身份", () => {
  it("同一地格上的不同边不会被误判为同一端点", () => {
    expect(
      connectionTargetToken(
        { kind: "edge-midpoint", edgeId: "edge:a" },
        "cell:square:1:1",
      ),
    ).not.toBe(
      connectionTargetToken(
        { kind: "edge-midpoint", edgeId: "edge:b" },
        "cell:square:1:1",
      ),
    );
  });

  it("同一地格内的不同自由坐标不会被误判为同一端点", () => {
    expect(
      connectionTargetToken(
        { kind: "map-point", point: { x: 10.25, y: 20.5 } },
        "cell:square:1:1",
      ),
    ).not.toBe(
      connectionTargetToken(
        { kind: "map-point", point: { x: 10.75, y: 20.5 } },
        "cell:square:1:1",
      ),
    );
  });
});

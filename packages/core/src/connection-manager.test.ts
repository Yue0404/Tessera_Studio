import { describe, expect, it } from "vitest";

import { ConnectionManager } from "./connection-manager.js";
import type { ConnectionData } from "./types.js";

function connection(label: string | null): ConnectionData {
  return {
    connectionId: "11111111-1111-4111-8111-111111111111",
    elementId: "tessera.basic:connection.line",
    layerId: "tessera.basic.connection",
    kind: "line",
    start: { kind: "map-point", point: { x: 0, y: 0 } },
    end: { kind: "map-point", point: { x: 10, y: 10 } },
    style: {
      strokeColor: "#FFFFFFFF",
      strokeWidth: 1,
      strokeOpacity: 1,
      lineStyle: "solid",
    },
    label,
  };
}

describe("ConnectionManager 文字契约", () => {
  it("组合字符和 emoji 按字素计数，最多接受 256 个", () => {
    const manager = new ConnectionManager();
    const combining = "e\u0301".repeat(128);
    const familyEmoji = "👨‍👩‍👧‍👦".repeat(128);

    expect(() =>
      manager.add(connection(combining + familyEmoji)),
    ).not.toThrow();
    expect(
      () => new ConnectionManager([connection(combining + familyEmoji + "界")]),
    ).toThrow("text-grapheme-limit-exceeded");
  });

  it("九行和单独回车都被拒绝，失败替换不改写原对象", () => {
    const manager = new ConnectionManager([connection("原标签")]);
    const nineLines = Array.from({ length: 9 }, (_, index) => index).join("\r");

    expect(() => manager.replace(connection(nineLines))).toThrow(
      "text-line-limit-exceeded",
    );
    expect(manager.get(connection(null).connectionId)?.label).toBe("原标签");
  });
});

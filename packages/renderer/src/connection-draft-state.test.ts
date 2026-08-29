import { describe, expect, it, vi } from "vitest";
import { ConnectionDraftState } from "./connection-draft-state.js";

const endpoint = (cellId: string) => ({
  kind: "cell-center" as const,
  cellId,
});

describe("渲染器临时连线", () => {
  it("只读暴露吸附后的起点且每次返回独立快照", () => {
    const draft = new ConnectionDraftState();
    draft.begin({ kind: "map-point", point: { x: 4, y: 8 } }, null);
    const first = draft.start;
    const second = draft.start;
    expect(first).toEqual({ kind: "map-point", point: { x: 4, y: 8 } });
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    if (first?.kind !== "map-point" || second?.kind !== "map-point")
      throw new Error("draft-start-missing");
    expect(second.point).not.toBe(first.point);
  });

  it("提交返回 false 后清空旧起点并可立即开始下一条线", () => {
    const draft = new ConnectionDraftState();
    draft.begin(endpoint("cell:square:0:0"), null);
    expect(draft.commit(endpoint("cell:square:0:1"), null, () => false)).toBe(
      false,
    );
    expect(draft.hasStart).toBe(false);

    draft.begin(endpoint("cell:square:1:0"), null);
    const submit = vi.fn(() => true);
    expect(draft.commit(endpoint("cell:square:1:1"), null, submit)).toBe(true);
    expect(submit).toHaveBeenCalledWith(
      endpoint("cell:square:1:0"),
      endpoint("cell:square:1:1"),
      [],
    );
  });

  it("提交抛异常也清空旧起点", () => {
    const draft = new ConnectionDraftState();
    draft.begin(endpoint("cell:square:0:0"), null);
    expect(() =>
      draft.commit(endpoint("cell:square:0:1"), null, () => {
        throw new Error("commit-failed");
      }),
    ).toThrow("commit-failed");
    expect(draft.hasStart).toBe(false);
  });
});

import { describe, expect, it, vi } from "vitest";
import { ConnectionDraftState } from "./connection-draft-state.js";

const endpoint = (cellId: string) => ({
  kind: "cell-center" as const,
  cellId,
});

describe("渲染器临时连线", () => {
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

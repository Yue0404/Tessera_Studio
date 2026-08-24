import { EditorStore, createProject, type ConnectionData } from "@tessera/core";
import { describe, expect, it } from "vitest";

import {
  ProjectFormatError,
  restoreProjectV1,
  toProjectV1,
  validateProjectDocumentV1,
} from "./project-format.js";

function storeWithConnection(label: string): EditorStore {
  const store = new EditorStore(
    createProject({
      name: "Project 内容安全",
      grid: { type: "square", width: 4, height: 4, cellSize: 32 },
      style: {
        canvasBackground: "#101820FF",
        defaultCellColor: "#00000000",
        gridColor: "#FFFFFFFF",
        gridOpacity: 1,
        gridWidth: 1,
        defaultEdgeColor: "#FFFFFFFF",
      },
    }),
  );
  const connection: ConnectionData = {
    connectionId: "11111111-1111-4111-8111-111111111111",
    elementId: "tessera.basic:connection.line",
    layerId: "tessera.basic.connection",
    kind: "line",
    start: { kind: "map-point", point: { x: 4, y: 4 } },
    end: { kind: "map-point", point: { x: 20, y: 20 } },
    style: {
      strokeColor: "#FFFFFFFF",
      strokeWidth: 1,
      strokeOpacity: 1,
      lineStyle: "solid",
    },
    label,
  };
  store.state.connections.add(connection);
  return store;
}

function expectProjectCode(document: unknown, code: string): void {
  try {
    validateProjectDocumentV1(document);
    throw new Error("expected-project-error");
  } catch (error) {
    expect(error).toBeInstanceOf(ProjectFormatError);
    expect(error).toMatchObject({ code });
  }
}

function base64(value: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(value)));
}

describe("Project v1 外部内容安全", () => {
  it("外部连接标签按字素与逻辑行验证", () => {
    const valid = toProjectV1(
      storeWithConnection("e\u0301".repeat(128) + "👨‍👩‍👧‍👦".repeat(128)).state,
    ) as any;
    expect(() => validateProjectDocumentV1(valid)).not.toThrow();

    const tooManyGraphemes = structuredClone(valid);
    tooManyGraphemes.managers.connectionManager.connections[0].label += "界";
    expectProjectCode(tooManyGraphemes, "text-grapheme-limit-exceeded");

    const tooManyLines = structuredClone(valid);
    tooManyLines.managers.connectionManager.connections[0].label = Array.from(
      { length: 9 },
      (_, index) => index,
    ).join("\n");
    expectProjectCode(tooManyLines, "text-line-limit-exceeded");
  });

  it("恶意文字与 JSON 资源只作为数据恢复，不执行其中内容", () => {
    const marker = "__tesseraProjectContentExecuted";
    Reflect.deleteProperty(globalThis, marker);
    const script =
      "<script>globalThis.__tesseraProjectContentExecuted=true</script>";
    const payload = JSON.stringify({ payload: script });
    const document = toProjectV1(storeWithConnection(script).state) as any;
    document.embeddedAssets = [
      {
        assetId: "22222222-2222-4222-8222-222222222222",
        mimeType: "application/json",
        bytes: new TextEncoder().encode(payload).byteLength,
        encoding: "base64",
        data: base64(payload),
        extensions: {},
      },
    ];

    const restored = restoreProjectV1(JSON.stringify(document));

    expect((globalThis as Record<string, unknown>)[marker]).toBeUndefined();
    expect([...restored.connections.values()][0]?.label).toBe(script);
    Reflect.deleteProperty(globalThis, marker);
  });

  it("脚本文本冒充图片资源时在解码前拒绝", () => {
    const script = "<script>alert('x')</script>";
    const bytes = new TextEncoder().encode(script);
    const document = toProjectV1(storeWithConnection("安全标签").state) as any;
    document.embeddedAssets = [
      {
        assetId: "33333333-3333-4333-8333-333333333333",
        mimeType: "image/png",
        bytes: bytes.byteLength,
        encoding: "base64",
        data: base64(script),
        extensions: {},
      },
    ];

    expectProjectCode(document, "embedded-asset-magic-invalid");
  });
});

import {
  cellCenter,
  createProject,
  EditorStore,
  type GridType,
} from "@tessera/core";
import {
  captureVisualExportSnapshot,
  detectVisualExportCanvasCapabilities,
  mapVisualBounds,
  planVisualExport,
  startVisualExport,
  type VisualExportBackground,
  type VisualExportCanvasCapabilities,
} from "@tessera/renderer/visual-export";

interface PngSmokeResult {
  readonly blobType: string;
  readonly blobSize: number;
  readonly signature: readonly number[];
  readonly width: number;
  readonly height: number;
  readonly executionMode: string;
  readonly samples: Readonly<Record<string, readonly number[]>>;
}

const fallbackCapabilities: VisualExportCanvasCapabilities = {
  maxWidth: 8192,
  maxHeight: 8192,
  maxPixels: 67_108_864,
  worker: false,
  offscreenCanvas2d: false,
  offscreenConvertToBlob: false,
};

function createStore(type: GridType): EditorStore {
  return new EditorStore(
    createProject({
      name: "浏览器视觉导出 smoke",
      grid: { type, width: 8, height: 8, cellSize: 20 },
      style: {
        canvasBackground: "#09141DFF",
        defaultCellColor: "#00000000",
        gridColor: "#59656AFF",
        gridOpacity: 0.7,
        gridWidth: 1,
        defaultEdgeColor: "#59656AFF",
      },
    }),
  );
}

async function decodePng(
  blob: Blob,
  samplePoints: Readonly<Record<string, readonly [number, number]>>,
): Promise<{
  readonly width: number;
  readonly height: number;
  readonly samples: Readonly<Record<string, readonly number[]>>;
}> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) throw new Error("smoke-canvas-context-missing");
  context.drawImage(bitmap, 0, 0);
  const samples: Record<string, readonly number[]> = {};
  for (const [name, [x, y]] of Object.entries(samplePoints)) {
    samples[name] = [
      ...context.getImageData(Math.floor(x), Math.floor(y), 1, 1).data,
    ];
  }
  bitmap.close();
  return { width: canvas.width, height: canvas.height, samples };
}

async function pngResult(
  store: EditorStore,
  background: VisualExportBackground,
  forceFallback: boolean,
  samplePoints: Readonly<Record<string, readonly [number, number]>>,
): Promise<PngSmokeResult> {
  const capabilities = forceFallback
    ? fallbackCapabilities
    : detectVisualExportCanvasCapabilities();
  const plan = planVisualExport(
    captureVisualExportSnapshot(store.state),
    {
      format: "png",
      range: { kind: "full-map" },
      background,
      showGrid: false,
      scale: 1,
    },
    capabilities,
  );
  const task = startVisualExport(plan, { capabilities });
  const result = await task.result;
  const bytes = new Uint8Array(await result.blob.arrayBuffer());
  const decoded = await decodePng(result.blob, samplePoints);
  return {
    blobType: result.blob.type,
    blobSize: result.blob.size,
    signature: [...bytes.slice(0, 8)],
    width: decoded.width,
    height: decoded.height,
    executionMode: result.executionMode,
    samples: decoded.samples,
  };
}

function configureSquareScene(store: EditorStore): void {
  store.paintCell(1, 1, "#FF0000FF");
  const connectionId = store.createConnection(
    { kind: "map-point", point: { x: -20, y: 80 } },
    { kind: "map-point", point: { x: 180, y: 80 } },
    { kind: "arrow", arrowMode: "both", label: "穿界线" },
  );
  const connection = store.state.connections.get(connectionId);
  if (connection === undefined) throw new Error("smoke-connection-missing");
  store.updateConnection(connectionId, {
    ...connection,
    style: {
      ...connection.style,
      strokeColor: "#FF00FFFF",
      strokeWidth: 4,
      lineStyle: "dashed",
    },
  });
  const markerId = store.placeMarker({ x: 100, y: 40 }, "#00FF00FF");
  const marker = store.state.overlays.get(markerId);
  if (marker === undefined || marker.overlayType !== "marker")
    throw new Error("smoke-marker-missing");
  store.updateOverlay(markerId, {
    ...marker,
    style: { ...marker.style, markerShape: "diamond", size: 18 },
  });
  const textId = store.placeText({ x: 60, y: 120 }, "中文😀\nText", {
    fontSize: 14,
    color: "#FFFFFFFF",
  });
  const text = store.state.overlays.get(textId);
  if (text === undefined || text.overlayType !== "text")
    throw new Error("smoke-text-missing");
  store.updateOverlay(textId, {
    ...text,
    style: { ...text.style, backgroundVisible: true },
  });
}

/** 仅由 Playwright 通过 Vite 单独加载，不进入应用生产入口。 */
export async function renderSquarePngSmoke(
  forceFallback: boolean,
  background: "transparent" | "color",
  hideAnnotation = false,
): Promise<PngSmokeResult> {
  const store = createStore("square");
  configureSquareScene(store);
  if (hideAnnotation) {
    store.setLayerState("tessera.basic.annotation", { visible: false });
  }
  return pngResult(
    store,
    background === "transparent"
      ? { kind: "transparent" }
      : { kind: "color", color: "#11223380" },
    forceFallback,
    {
      empty: [10, 10],
      redCell: [30, 30],
      marker: [100, 40],
      crossingLine: [70, 80],
      text: [60, 120],
    },
  );
}

export async function renderHexPngSmoke(): Promise<PngSmokeResult> {
  const store = createStore("hex-pointy");
  store.paintCell(1, 1, "#00AAFFFF");
  const center = cellCenter(store.state.grid, 1, 1);
  const bounds = mapVisualBounds(store.state.grid);
  return pngResult(store, { kind: "transparent" }, false, {
    paintedHex: [center.x - bounds.minX, center.y - bounds.minY],
    empty: [1, 1],
  });
}

export async function renderSvgSmoke(): Promise<{
  readonly blobType: string;
  readonly parseError: boolean;
  readonly loaded: boolean;
  readonly containsScript: boolean;
  readonly containsExternalReference: boolean;
  readonly hasGeometry: boolean;
}> {
  const store = createStore("square");
  configureSquareScene(store);
  store.placeText(
    { x: 80, y: 140 },
    '<script href="https://invalid.example/">x</script>',
  );
  const plan = planVisualExport(captureVisualExportSnapshot(store.state), {
    format: "svg",
    range: { kind: "full-map" },
    background: { kind: "transparent" },
    showGrid: false,
  });
  const result = await startVisualExport(plan).result;
  const text = await result.blob.text();
  const documentResult = new DOMParser().parseFromString(text, "image/svg+xml");
  const url = URL.createObjectURL(result.blob);
  const loaded = await new Promise<boolean>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = url;
  });
  URL.revokeObjectURL(url);
  const containsExternalReference = [
    ...documentResult.querySelectorAll("*"),
  ].some((element) =>
    [...element.attributes].some(
      (attribute) =>
        /^(?:href|src)$/iu.test(attribute.name) ||
        /url\(\s*["']?(?:https?:|\/\/)/iu.test(attribute.value),
    ),
  );
  return {
    blobType: result.blob.type,
    parseError: documentResult.querySelector("parsererror") !== null,
    loaded,
    containsScript: documentResult.querySelector("script") !== null,
    containsExternalReference,
    hasGeometry:
      documentResult.querySelector("polygon,line,text,circle") !== null,
  };
}

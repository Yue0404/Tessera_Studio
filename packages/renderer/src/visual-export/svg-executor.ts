import { VisualExportError, visualExportExecutionError } from "./error.js";
import {
  DEFAULT_VISUAL_EXPORT_SVG_LIMITS,
  VisualExportSvgAccumulator,
  iterateVisualExportSvgFragments,
  type VisualExportSvgFragmentOptions,
  type VisualExportSvgLimits,
} from "./svg.js";
import type { VisualExportPlan, VisualExportResult } from "./types.js";

export interface SvgExecutionControl {
  readonly isCancelled: () => boolean;
  readonly onProgress: (progress: number) => void;
  readonly now: () => number;
  readonly yieldControl: () => Promise<void>;
  readonly batchNodes: number;
  readonly limits?: VisualExportSvgLimits;
  readonly fragmentOptions?: VisualExportSvgFragmentOptions;
  readonly createBlob?: (accumulator: VisualExportSvgAccumulator) => Blob;
}

function throwIfCancelled(control: SvgExecutionControl): void {
  if (control.isCancelled()) {
    throw visualExportExecutionError("visual-export-cancelled");
  }
}

export async function executeVisualExportSvg(
  plan: VisualExportPlan,
  control: SvgExecutionControl,
): Promise<VisualExportResult> {
  if (plan.request.format !== "svg") {
    throw new VisualExportError("visual-export-format-mismatch", {
      expected: "svg",
      actual: plan.request.format,
    });
  }
  const accumulator = new VisualExportSvgAccumulator(
    control.limits ?? DEFAULT_VISUAL_EXPORT_SVG_LIMITS,
  );
  const safeBatchNodes = Math.max(1, control.batchNodes);
  let batchNodes = 0;
  let batchStarted = control.now();
  try {
    for (const fragment of iterateVisualExportSvgFragments(
      plan,
      control.fragmentOptions,
    )) {
      throwIfCancelled(control);
      accumulator.append(fragment);
      batchNodes += Math.max(1, fragment.nodes);
      const now = control.now();
      if (batchNodes >= safeBatchNodes || now - batchStarted >= 12) {
        control.onProgress(
          Math.min(
            0.95,
            accumulator.nodes / Math.max(1, plan.estimatedPrimitiveCount),
          ),
        );
        await control.yieldControl();
        throwIfCancelled(control);
        batchNodes = 0;
        batchStarted = control.now();
      }
    }
  } catch (error) {
    if (error instanceof VisualExportError) throw error;
    throw visualExportExecutionError("visual-export-svg-generation-failed");
  }
  throwIfCancelled(control);
  let blob: Blob;
  try {
    blob = (control.createBlob ?? ((value) => value.toBlob()))(accumulator);
  } catch {
    throw visualExportExecutionError("visual-export-svg-generation-failed");
  }
  throwIfCancelled(control);
  return {
    format: "svg",
    mimeType: "image/svg+xml",
    blob,
    width: plan.pixelWidth,
    height: plan.pixelHeight,
    executionMode: "svg",
  };
}

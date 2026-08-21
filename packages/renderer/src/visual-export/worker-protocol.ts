import type { SerializedVisualExportError } from "./error.js";
import type { VisualExportPlan, VisualExportResult } from "./types.js";

export interface VisualExportWorkerStartMessage {
  readonly type: "start";
  readonly taskId: string;
  readonly plan: VisualExportPlan;
}

export type VisualExportWorkerRequest = VisualExportWorkerStartMessage;

export type VisualExportWorkerResponse =
  | {
      readonly type: "progress";
      readonly taskId: string;
      readonly progress: number;
    }
  | {
      readonly type: "result";
      readonly taskId: string;
      readonly result: VisualExportResult;
    }
  | {
      readonly type: "error";
      readonly taskId: string;
      readonly error: SerializedVisualExportError;
    };

import type { BackgroundTaskErrorCode } from "./background-task.js";
import type { ProjectGrid } from "./types.js";

export interface FillRegionWorkerPayload {
  readonly grid: ProjectGrid;
  readonly start: { readonly row: number; readonly column: number };
  readonly targetColor: string;
  readonly fillColor: string;
  readonly defaultCellColor: string;
  readonly estimatedCount: number;
  readonly sparseColors: readonly (readonly [cellId: string, color: string])[];
}

export interface FillRegionWorkerStartMessage {
  readonly type: "start";
  readonly taskId: string;
  readonly payload: FillRegionWorkerPayload;
}

export type FillRegionWorkerRequest = FillRegionWorkerStartMessage;

export interface SerializedBackgroundTaskError {
  readonly code: BackgroundTaskErrorCode;
  readonly details: Readonly<Record<string, number | string | boolean>>;
  readonly uiAction: "confirm" | "reduce-range" | "retry" | "dismiss";
}

export type FillRegionWorkerResponse =
  | {
      readonly type: "progress";
      readonly taskId: string;
      readonly completed: number;
    }
  | {
      readonly type: "result";
      readonly taskId: string;
      readonly cells: readonly {
        readonly row: number;
        readonly column: number;
      }[];
    }
  | {
      readonly type: "error";
      readonly taskId: string;
      readonly error: SerializedBackgroundTaskError;
    };

export interface FillRegionWorkerLike {
  onmessage:
    ((event: { readonly data: FillRegionWorkerResponse }) => void) | null;
  onerror: ((event: { readonly message?: string }) => void) | null;
  postMessage(message: FillRegionWorkerRequest): void;
  terminate(): void;
}

export type FillRegionWorkerFactory = () => FillRegionWorkerLike;

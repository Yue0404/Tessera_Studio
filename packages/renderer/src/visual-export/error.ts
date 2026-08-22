import type { VisualExportUiAction } from "./types.js";

export class VisualExportError extends Error {
  constructor(
    readonly code: string,
    readonly details: Readonly<Record<string, unknown>> = {},
    readonly uiAction: VisualExportUiAction = "reduce-range",
  ) {
    super(code);
    this.name = "VisualExportError";
  }
}

export interface SerializedVisualExportError {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly uiAction: VisualExportUiAction;
}

const EXECUTION_ACTIONS = [
  "reduce-scale",
  "reduce-range",
  "tile-export",
] as const;

export function visualExportExecutionError(
  code: string,
  uiAction: VisualExportUiAction = "reduce-range",
): VisualExportError {
  return new VisualExportError(
    code,
    { suggestedActions: EXECUTION_ACTIONS },
    uiAction,
  );
}

export function serializeVisualExportError(
  error: VisualExportError,
): SerializedVisualExportError {
  return {
    code: error.code,
    details: { ...error.details },
    uiAction: error.uiAction,
  };
}

export function deserializeVisualExportError(
  error: SerializedVisualExportError,
): VisualExportError {
  return new VisualExportError(error.code, error.details, error.uiAction);
}

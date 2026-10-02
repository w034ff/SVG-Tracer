import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { BatchFinishedPayload } from "./generated/BatchFinishedPayload";
import type { BatchItemPayload } from "./generated/BatchItemPayload";
import type { BatchProgressPayload } from "./generated/BatchProgressPayload";
import type { ConvertResult } from "./generated/ConvertResult";
import type { ErrorCode } from "./generated/ErrorCode";
import type { ImageDroppedPayload } from "./generated/ImageDroppedPayload";
import type { IpcError } from "./generated/IpcError";
import type { ParamSpec } from "./generated/ParamSpec";
import type { PickBatchInputResult } from "./generated/PickBatchInputResult";
import type { PickBatchOutputResult } from "./generated/PickBatchOutputResult";
import type { PickedImage } from "./generated/PickedImage";
import type { SaveSvgResult } from "./generated/SaveSvgResult";
import type { TraceParams } from "./generated/TraceParams";

export type { BatchFinishedPayload } from "./generated/BatchFinishedPayload";
export type { BatchItemPayload } from "./generated/BatchItemPayload";
export type { BatchItemStatus } from "./generated/BatchItemStatus";
export type { BatchProgressPayload } from "./generated/BatchProgressPayload";
export type { ColorMode } from "./generated/ColorMode";
export type { ConvertResult } from "./generated/ConvertResult";
export type { CurveMode } from "./generated/CurveMode";
export type { ErrorCode } from "./generated/ErrorCode";
export type { FloatRange } from "./generated/FloatRange";
export type { Hierarchical } from "./generated/Hierarchical";
export type { ImageDroppedPayload } from "./generated/ImageDroppedPayload";
export type { IntRange } from "./generated/IntRange";
export type { IpcError } from "./generated/IpcError";
export type { ParamRanges } from "./generated/ParamRanges";
export type { ParamSpec } from "./generated/ParamSpec";
export type { PickBatchInputResult } from "./generated/PickBatchInputResult";
export type { PickBatchOutputResult } from "./generated/PickBatchOutputResult";
export type { PickedImage } from "./generated/PickedImage";
export type { Preset } from "./generated/Preset";
export type { PresetSpec } from "./generated/PresetSpec";
export type { SaveSvgResult } from "./generated/SaveSvgResult";
export type { TraceParams } from "./generated/TraceParams";
export type { UnlistenFn };

const ERROR_CODES = {
  UnsupportedFormat: true,
  DecodeFailed: true,
  TooLarge: true,
  ReadFailed: true,
  WriteFailed: true,
  TraceFailed: true,
  Superseded: true,
  BatchRunning: true,
  UnknownHandle: true,
  InvalidParams: true,
} satisfies Record<ErrorCode, true>;

/**
 * Type guard checking whether a value is a valid IPC ErrorCode per design §5.5.
 */
export function isErrorCode(value: unknown): value is ErrorCode {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(ERROR_CODES, value)
  );
}

/**
 * Type guard checking whether an error is structured as `{ code: ErrorCode, detail: string | null }`.
 */
export function isIpcError(value: unknown): value is IpcError {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (!("code" in value) || !("detail" in value)) {
    return false;
  }
  const code = value.code;
  const detail = value.detail;
  const isDetailValid = typeof detail === "string" || detail === null;
  return isErrorCode(code) && isDetailValid;
}

/**
 * Normalizes any error thrown by IPC into a structured `IpcError`.
 * If the error is not already `{ code, detail }`, transforms it to
 * `{ code: "InvalidParams", detail: <stringified content> }` per design §5.5.
 */
export function normalizeIpcError(error: unknown): IpcError {
  if (isIpcError(error)) {
    return error;
  }
  let detail: string;
  if (typeof error === "string") {
    detail = error;
  } else if (error instanceof Error) {
    detail = error.message;
  } else if (typeof error === "object" && error !== null) {
    try {
      detail = JSON.stringify(error);
    } catch {
      detail = String(error);
    }
  } else {
    detail = String(error);
  }
  return {
    code: "InvalidParams",
    detail,
  };
}

async function invokeWrapped<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (error: unknown) {
    throw normalizeIpcError(error);
  }
}

/**
 * Fetches parameter boundary ranges and presets from the backend per design §4.5, §6.1.
 */
export async function getParamSpec(): Promise<ParamSpec> {
  return invokeWrapped<ParamSpec>("get_param_spec");
}

/**
 * Prompts user with native file dialog to select an image.
 */
export async function pickImage(): Promise<PickedImage | null> {
  return invokeWrapped<PickedImage | null>("pick_image");
}

/**
 * Requests decoded image PNG bytes as an ArrayBuffer per design §6.1.
 */
export async function loadPreview(id: string): Promise<ArrayBuffer> {
  return invokeWrapped<ArrayBuffer>("load_preview", { id });
}

/**
 * Requests vectorization of the specified image per design §5.1.
 */
export async function convert(
  id: string,
  params: TraceParams,
  seq: number,
): Promise<ConvertResult> {
  return invokeWrapped<ConvertResult>("convert", { id, params, seq });
}

/**
 * Prompts user with native save dialog to save the last converted SVG.
 */
export async function saveSvg(id: string): Promise<SaveSvgResult | null> {
  return invokeWrapped<SaveSvgResult | null>("save_svg", { id });
}

/**
 * Prompts user to select the batch input directory.
 */
export async function pickBatchInput(): Promise<PickBatchInputResult | null> {
  return invokeWrapped<PickBatchInputResult | null>("pick_batch_input");
}

/**
 * Prompts user to select the batch output directory.
 */
export async function pickBatchOutput(): Promise<PickBatchOutputResult | null> {
  return invokeWrapped<PickBatchOutputResult | null>("pick_batch_output");
}

/**
 * Starts batch conversion using the given parameter configuration.
 */
export async function startBatch(params: TraceParams): Promise<void> {
  return invokeWrapped<void>("start_batch", { params });
}

/**
 * Signals cancellation of the running batch conversion.
 */
export async function cancelBatch(): Promise<void> {
  return invokeWrapped<void>("cancel_batch");
}

/**
 * Subscribes to the `image-dropped` event per design §6.2.
 */
export async function onImageDropped(
  handler: (payload: ImageDroppedPayload) => void,
): Promise<UnlistenFn> {
  return listen<ImageDroppedPayload>("image-dropped", (event) => {
    handler(event.payload);
  });
}

/**
 * Subscribes to the `batch-progress` event per design §6.2.
 */
export async function onBatchProgress(
  handler: (payload: BatchProgressPayload) => void,
): Promise<UnlistenFn> {
  return listen<BatchProgressPayload>("batch-progress", (event) => {
    handler(event.payload);
  });
}

/**
 * Subscribes to the `batch-item` event per design §6.2.
 */
export async function onBatchItem(
  handler: (payload: BatchItemPayload) => void,
): Promise<UnlistenFn> {
  return listen<BatchItemPayload>("batch-item", (event) => {
    handler(event.payload);
  });
}

/**
 * Subscribes to the `batch-finished` event per design §6.2.
 */
export async function onBatchFinished(
  handler: (payload: BatchFinishedPayload) => void,
): Promise<UnlistenFn> {
  return listen<BatchFinishedPayload>("batch-finished", (event) => {
    handler(event.payload);
  });
}

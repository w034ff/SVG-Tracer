import type {
  BatchFinishedPayload,
  BatchItemPayload,
  BatchProgressPayload,
  IpcError,
  PickBatchInputResult,
  PickBatchOutputResult,
} from "../ipc";

export type BatchStatus = "idle" | "running" | "cancelling" | "finished";

export type BatchConversionState = {
  status: BatchStatus;
  inputDir: PickBatchInputResult | null;
  outputDir: PickBatchOutputResult | null;
  progress: BatchProgressPayload | null;
  items: readonly BatchItemPayload[];
  finished: BatchFinishedPayload | null;
  error: IpcError | null;
};

export type BatchConversionAction =
  | { type: "SET_INPUT_DIR"; inputDir: PickBatchInputResult | null }
  | { type: "SET_OUTPUT_DIR"; outputDir: PickBatchOutputResult | null }
  | { type: "START_BATCH" }
  | { type: "UPDATE_PROGRESS"; progress: BatchProgressPayload }
  | { type: "ITEM_PROCESSED"; item: BatchItemPayload }
  | { type: "CANCEL_BATCH" }
  | { type: "FINISH_BATCH"; finished: BatchFinishedPayload }
  | { type: "SET_ERROR"; error: IpcError }
  | { type: "RESET" };

export function createInitialBatchConversionState(): BatchConversionState {
  return {
    status: "idle",
    inputDir: null,
    outputDir: null,
    progress: null,
    items: [],
    finished: null,
    error: null,
  };
}

export function batchConversionReducer(
  state: BatchConversionState,
  action: BatchConversionAction,
): BatchConversionState {
  switch (action.type) {
    case "SET_INPUT_DIR":
      return {
        ...state,
        inputDir: action.inputDir,
        items: [],
        progress: null,
        finished: null,
      };
    case "SET_OUTPUT_DIR":
      return {
        ...state,
        outputDir: action.outputDir,
      };
    case "START_BATCH":
      return {
        ...state,
        status: "running",
        error: null,
        items: [],
        finished: null,
      };
    case "UPDATE_PROGRESS":
      return {
        ...state,
        progress: action.progress,
      };
    case "ITEM_PROCESSED":
      return {
        ...state,
        items: [...state.items, action.item],
      };
    case "CANCEL_BATCH":
      return {
        ...state,
        status: "cancelling",
      };
    case "FINISH_BATCH":
      return {
        ...state,
        status: "finished",
        finished: action.finished,
      };
    case "SET_ERROR":
      return {
        ...state,
        status: "idle",
        error: action.error,
      };
    case "RESET":
      return createInitialBatchConversionState();
    default:
      return state;
  }
}

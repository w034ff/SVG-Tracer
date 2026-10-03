import type {
  BatchFinishedPayload,
  BatchItemPayload,
  BatchProgressPayload,
  IpcError,
  PickBatchInputResult,
  PickBatchOutputResult,
} from "../ipc";

export type BatchStatus = "idle" | "running" | "cancelling" | "finished";

export type BatchItemRowStatus =
  "wait" | "running" | "ok" | "failed" | "unprocessed";

export type BatchItemRow = {
  readonly name: string;
  readonly outputName: string | null;
  readonly status: BatchItemRowStatus;
  readonly error: IpcError | null;
};

export type BatchConversionState = {
  readonly status: BatchStatus;
  readonly inputDir: PickBatchInputResult | null;
  readonly outputDir: PickBatchOutputResult | null;
  readonly progress: BatchProgressPayload | null;
  readonly items: readonly BatchItemRow[];
  readonly finished: BatchFinishedPayload | null;
  readonly error: IpcError | null;
};

export type BatchConversionAction =
  | { type: "SET_INPUT_DIR"; inputDir: PickBatchInputResult | null }
  | { type: "SET_OUTPUT_DIR"; outputDir: PickBatchOutputResult | null }
  | { type: "START_BATCH" }
  | { type: "START_BATCH_FAILED"; error: IpcError }
  | { type: "SET_ERROR"; error: IpcError }
  | { type: "UPDATE_PROGRESS"; progress: BatchProgressPayload }
  | { type: "ITEM_PROCESSED"; item: BatchItemPayload }
  | { type: "CANCEL_BATCH" }
  | { type: "FINISH_BATCH"; finished: BatchFinishedPayload }
  | { type: "RESET" };

export function createInitialBatchConversionState(
  inputDir?: PickBatchInputResult | null,
  outputDir?: PickBatchOutputResult | null,
): BatchConversionState {
  const items: BatchItemRow[] = inputDir
    ? inputDir.targets.map((name) => ({
        name,
        outputName: null,
        status: "wait",
        error: null,
      }))
    : [];

  return {
    status: "idle",
    inputDir: inputDir ?? null,
    outputDir: outputDir ?? null,
    progress: null,
    items,
    finished: null,
    error: null,
  };
}

export function batchConversionReducer(
  state: BatchConversionState,
  action: BatchConversionAction,
): BatchConversionState {
  switch (action.type) {
    case "SET_INPUT_DIR": {
      const items: BatchItemRow[] = action.inputDir
        ? action.inputDir.targets.map((name) => ({
            name,
            outputName: null,
            status: "wait",
            error: null,
          }))
        : [];
      return {
        ...state,
        status: "idle",
        inputDir: action.inputDir,
        items,
        progress: null,
        finished: null,
        error: null,
      };
    }

    case "SET_OUTPUT_DIR": {
      const items: BatchItemRow[] = state.items.map((item) => ({
        ...item,
        outputName: null,
        status: "wait",
        error: null,
      }));
      return {
        ...state,
        status: "idle",
        outputDir: action.outputDir,
        items,
        progress: null,
        finished: null,
        error: null,
      };
    }

    case "START_BATCH": {
      const items: BatchItemRow[] = state.items.map((item) => ({
        ...item,
        outputName: null,
        status: "wait",
        error: null,
      }));
      return {
        ...state,
        status: "running",
        items,
        progress: null,
        finished: null,
        error: null,
      };
    }

    case "START_BATCH_FAILED":
    case "SET_ERROR":
      return {
        ...state,
        status: "idle",
        error: action.error,
      };

    case "UPDATE_PROGRESS": {
      const { progress } = action;
      let nextItems = state.items;
      if (progress.current !== null && progress.current.length > 0) {
        const currentName = progress.current;
        const exists = nextItems.some((item) => item.name === currentName);
        if (exists) {
          nextItems = nextItems.map((item) => {
            if (item.name === currentName && item.status === "wait") {
              return { ...item, status: "running" };
            }
            return item;
          });
        } else {
          nextItems = [
            ...nextItems,
            {
              name: currentName,
              outputName: null,
              status: "running",
              error: null,
            },
          ];
        }
      }
      return {
        ...state,
        progress,
        items: nextItems,
      };
    }

    case "ITEM_PROCESSED": {
      const { item } = action;
      const targetStatus: BatchItemRowStatus =
        item.status === "ok" ? "ok" : "failed";
      const exists = state.items.some(
        (existing) => existing.name === item.name,
      );
      const nextItems = exists
        ? state.items.map((existing) => {
            if (existing.name === item.name) {
              return {
                ...existing,
                status: targetStatus,
                outputName: item.outputName ?? null,
                error: item.error ?? null,
              };
            }
            return existing;
          })
        : [
            ...state.items,
            {
              name: item.name,
              status: targetStatus,
              outputName: item.outputName ?? null,
              error: item.error ?? null,
            },
          ];
      return {
        ...state,
        items: nextItems,
      };
    }

    case "CANCEL_BATCH":
      return {
        ...state,
        status: "cancelling",
      };

    case "FINISH_BATCH": {
      const { finished } = action;
      const nextItems = state.items.map((item) => {
        if (item.status !== "ok" && item.status !== "failed") {
          return { ...item, status: "unprocessed" as const };
        }
        return item;
      });
      return {
        ...state,
        status: "finished",
        finished,
        items: nextItems,
      };
    }

    case "RESET":
      return createInitialBatchConversionState();

    default:
      return state;
  }
}

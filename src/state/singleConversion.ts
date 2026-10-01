import type { ConvertResult, IpcError, PickedImage } from "../ipc";

export type SingleConversionStatus =
  "idle" | "loading_preview" | "converting" | "ready" | "error";

export type ImageDimensions = {
  width: number;
  height: number;
};

export type SingleConversionState = {
  status: SingleConversionStatus;
  image: PickedImage | null;
  previewUrl: string | null;
  imageDimensions: ImageDimensions | null;
  svg: string | null;
  result: ConvertResult | null;
  error: IpcError | null;
  zoom: number;
};

export type SingleConversionAction =
  | { type: "SET_IMAGE"; image: PickedImage | null }
  | {
      type: "SET_PREVIEW";
      previewUrl: string | null;
      dimensions?: ImageDimensions | null;
    }
  | { type: "START_CONVERT" }
  | { type: "CONVERT_SUCCESS"; result: ConvertResult; svg: string }
  | { type: "CONVERT_ERROR"; error: IpcError }
  | { type: "SET_ZOOM"; zoom: number }
  | { type: "RESET" };

export function createInitialSingleConversionState(): SingleConversionState {
  return {
    status: "idle",
    image: null,
    previewUrl: null,
    imageDimensions: null,
    svg: null,
    result: null,
    error: null,
    zoom: 1.0,
  };
}

export function singleConversionReducer(
  state: SingleConversionState,
  action: SingleConversionAction,
): SingleConversionState {
  switch (action.type) {
    case "SET_IMAGE":
      return {
        ...state,
        image: action.image,
        status: action.image ? "loading_preview" : "idle",
        svg: null,
        result: null,
        error: null,
      };
    case "SET_PREVIEW":
      return {
        ...state,
        previewUrl: action.previewUrl,
        imageDimensions:
          action.dimensions !== undefined
            ? action.dimensions
            : state.imageDimensions,
      };
    case "START_CONVERT":
      return {
        ...state,
        status: "converting",
        error: null,
      };
    case "CONVERT_SUCCESS":
      return {
        ...state,
        status: "ready",
        result: action.result,
        svg: action.svg,
        error: null,
      };
    case "CONVERT_ERROR":
      return {
        ...state,
        status: "error",
        error: action.error,
      };
    case "SET_ZOOM":
      return {
        ...state,
        zoom: action.zoom,
      };
    case "RESET":
      return createInitialSingleConversionState();
    default:
      return state;
  }
}

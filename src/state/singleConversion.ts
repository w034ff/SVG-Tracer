import type { ConvertResult, IpcError, PickedImage } from "../ipc";

export const CONVERT_DEBOUNCE_MS = 300;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 16.0;
export const DEFAULT_ZOOM = 1.0;
export const PIXELATED_ZOOM_THRESHOLD = 2.0;

export type SingleConversionStatus =
  "idle" | "loading_preview" | "converting" | "ready" | "error";

export type ImageDimensions = {
  width: number;
  height: number;
};

export type PanOffset = {
  x: number;
  y: number;
};

export type SingleConversionState = {
  status: SingleConversionStatus;
  image: PickedImage | null;
  previewUrl: string | null;
  imageDimensions: ImageDimensions | null;
  svg: string | null;
  svgUrl: string | null;
  result: ConvertResult | null;
  error: IpcError | null;
  zoom: number;
  pan: PanOffset;
};

export type SingleConversionAction =
  | { type: "SET_IMAGE"; image: PickedImage | null }
  | {
      type: "SET_PREVIEW";
      previewUrl: string | null;
      dimensions?: ImageDimensions | null;
    }
  | { type: "SET_DIMENSIONS"; dimensions: ImageDimensions }
  | { type: "START_CONVERT" }
  | {
      type: "CONVERT_SUCCESS";
      result: ConvertResult;
      svg: string;
      svgUrl: string;
    }
  | { type: "CONVERT_ERROR"; error: IpcError }
  | { type: "SET_ERROR"; error: IpcError | null }
  | { type: "SET_ZOOM"; zoom: number }
  | { type: "SET_PAN"; pan: PanOffset }
  | { type: "SET_ZOOM_AND_PAN"; zoom: number; pan: PanOffset }
  | { type: "RESET" };

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function createInitialSingleConversionState(): SingleConversionState {
  return {
    status: "idle",
    image: null,
    previewUrl: null,
    imageDimensions: null,
    svg: null,
    svgUrl: null,
    result: null,
    error: null,
    zoom: DEFAULT_ZOOM,
    pan: { x: 0, y: 0 },
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
        previewUrl: null,
        imageDimensions: null,
        svg: null,
        svgUrl: null,
        result: null,
        error: null,
        zoom: DEFAULT_ZOOM,
        pan: { x: 0, y: 0 },
      };
    case "SET_PREVIEW":
      return {
        ...state,
        previewUrl: action.previewUrl,
        imageDimensions:
          action.dimensions !== undefined
            ? action.dimensions
            : state.imageDimensions,
        error: null,
      };
    case "SET_DIMENSIONS":
      return {
        ...state,
        imageDimensions: action.dimensions,
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
        svgUrl: action.svgUrl,
        error: null,
      };
    case "CONVERT_ERROR":
      return {
        ...state,
        status: "error",
        error: action.error,
      };
    case "SET_ERROR":
      return {
        ...state,
        status: action.error ? "error" : state.status,
        error: action.error,
      };
    case "SET_ZOOM":
      return {
        ...state,
        zoom: clampZoom(action.zoom),
      };
    case "SET_PAN":
      return {
        ...state,
        pan: action.pan,
      };
    case "SET_ZOOM_AND_PAN":
      return {
        ...state,
        zoom: clampZoom(action.zoom),
        pan: action.pan,
      };
    case "RESET":
      return createInitialSingleConversionState();
    default:
      return state;
  }
}

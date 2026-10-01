import type { TranslationKeys } from "./index";

export const en: TranslationKeys = {
  appTitle: "SVG Tracer",
  tabSingle: "Single",
  tabBatch: "Batch",
  mode: "Mode",
  language: "Language",
  about: "About",
  languageJa: "日本語",
  languageEn: "English",

  preset: "Preset",
  presetColorLogo: "Logo (color)",
  presetColorIcon: "Icon (few colors)",
  presetBinary: "Black & white",
  presetCustom: "Custom",

  colorMode: "Color",
  colorModeColor: "Color",
  colorModeBinary: "Black & white",

  colorPrecision: "Color precision",
  filterSpeckle: "Filter speckle",
  cornerThreshold: "Corner threshold",

  curveMode: "Curve type",
  curveModeSpline: "Curves",
  curveModePolygon: "Polygons",

  advanced: "Advanced",
  layerDifference: "Gradient step",
  hierarchical: "Layering",
  hierarchicalStacked: "Stacked",
  hierarchicalCutout: "Cutout",
  lengthThreshold: "Segment length",
  spliceThreshold: "Splice threshold",
  pathPrecision: "Path precision",

  errorUnsupportedFormat: "Unsupported image format",
  errorDecodeFailed: "Failed to decode image",
  errorTooLarge: "Image exceeds maximum allowed dimensions",
  errorReadFailed: "Failed to read file",
  errorWriteFailed: "Failed to write file",
  errorTraceFailed: "Vector tracing failed",
  errorBatchRunning: "Batch conversion is already running",
  errorUnknownHandle: "Image handle not found",
  errorInvalidParams: "Invalid parameters",
};

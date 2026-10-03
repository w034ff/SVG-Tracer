import { describe, expect, it } from "vitest";
import type { IpcError, ParamSpec, TraceParams } from "../ipc";
import {
  batchConversionReducer,
  createInitialBatchConversionState,
} from "./batchConversion";
import { createInitialLanguageState, languageReducer } from "./language";
import { createInitialParamsState, paramsReducer } from "./params";
import {
  calculateZoomPan,
  createInitialSingleConversionState,
  singleConversionReducer,
} from "./singleConversion";

const COLOR_LOGO_PARAMS: TraceParams = {
  colorMode: "color",
  colorPrecision: 6,
  filterSpeckle: 4,
  cornerThreshold: 60,
  curveMode: "spline",
  layerDifference: 16,
  hierarchical: "stacked",
  lengthThreshold: 4.0,
  spliceThreshold: 45,
  pathPrecision: 2,
};

const COLOR_ICON_PARAMS: TraceParams = {
  colorMode: "color",
  colorPrecision: 4,
  filterSpeckle: 8,
  cornerThreshold: 60,
  curveMode: "spline",
  layerDifference: 32,
  hierarchical: "stacked",
  lengthThreshold: 4.0,
  spliceThreshold: 45,
  pathPrecision: 2,
};

const BINARY_PARAMS: TraceParams = {
  colorMode: "binary",
  colorPrecision: 6,
  filterSpeckle: 4,
  cornerThreshold: 60,
  curveMode: "spline",
  layerDifference: 16,
  hierarchical: "stacked",
  lengthThreshold: 4.0,
  spliceThreshold: 45,
  pathPrecision: 2,
};

const MOCK_SPEC: ParamSpec = {
  ranges: {
    colorPrecision: { min: 1, max: 8 },
    filterSpeckle: { min: 0, max: 16 },
    cornerThreshold: { min: 0, max: 180 },
    layerDifference: { min: 0, max: 128 },
    lengthThreshold: { min: 3.5, max: 10.0 },
    spliceThreshold: { min: 0, max: 180 },
    pathPrecision: { min: 0, max: 8 },
  },
  presets: [
    { id: "colorLogo", params: COLOR_LOGO_PARAMS },
    { id: "colorIcon", params: COLOR_ICON_PARAMS },
    { id: "binary", params: BINARY_PARAMS },
  ],
  defaultPreset: "colorLogo",
};

describe("reducers", () => {
  describe("paramsReducer", () => {
    it("initializes state from spec with default preset", () => {
      const initial = createInitialParamsState(null);
      const state = paramsReducer(initial, {
        type: "INIT_SPEC",
        spec: MOCK_SPEC,
      });

      expect(state.spec).toEqual(MOCK_SPEC);
      expect(state.preset).toBe("colorLogo");
      expect(state.params).toEqual(COLOR_LOGO_PARAMS);
      expect(state.isAdvancedOpen).toBe(false);
      expect(state.error).toBeNull();
    });

    it("initializes state from spec with custom preset and params", () => {
      const customParams: TraceParams = {
        ...COLOR_LOGO_PARAMS,
        colorPrecision: 8,
      };
      const state = createInitialParamsState(MOCK_SPEC, "custom", customParams);

      expect(state.spec).toEqual(MOCK_SPEC);
      expect(state.preset).toBe("custom");
      expect(state.params).toEqual(customParams);
    });

    it("records error on INIT_ERROR", () => {
      const initial = createInitialParamsState(null);
      const error: IpcError = { code: "ReadFailed", detail: "File read error" };
      const state = paramsReducer(initial, { type: "INIT_ERROR", error });
      expect(state.error).toEqual(error);
      expect(state.spec).toBeNull();
    });

    it("populates values when a preset is selected", () => {
      const state1 = paramsReducer(createInitialParamsState(MOCK_SPEC), {
        type: "SET_PRESET",
        preset: "colorIcon",
      });
      expect(state1.preset).toBe("colorIcon");
      expect(state1.params).toEqual(COLOR_ICON_PARAMS);

      const state2 = paramsReducer(state1, {
        type: "SET_PRESET",
        preset: "binary",
      });
      expect(state2.preset).toBe("binary");
      expect(state2.params).toEqual(BINARY_PARAMS);
    });

    it("switches preset to 'custom' when any parameter value is modified", () => {
      const initial = createInitialParamsState(MOCK_SPEC);
      expect(initial.preset).toBe("colorLogo");

      const changed = paramsReducer(initial, {
        type: "SET_PARAM",
        key: "cornerThreshold",
        value: 90,
      });

      expect(changed.preset).toBe("custom");
      expect(changed.params?.cornerThreshold).toBe(90);
      expect(changed.params?.colorPrecision).toBe(
        COLOR_LOGO_PARAMS.colorPrecision,
      );
    });

    it("switches preset to 'custom' when colorMode is changed via SET_PARAM", () => {
      const initial = createInitialParamsState(MOCK_SPEC);
      const changed = paramsReducer(initial, {
        type: "SET_PARAM",
        key: "colorMode",
        value: "binary",
      });

      expect(changed.preset).toBe("custom");
      expect(changed.params?.colorMode).toBe("binary");
    });

    it("toggles and sets advanced open state", () => {
      const initial = createInitialParamsState(MOCK_SPEC);
      expect(initial.isAdvancedOpen).toBe(false);

      const opened = paramsReducer(initial, { type: "TOGGLE_ADVANCED" });
      expect(opened.isAdvancedOpen).toBe(true);

      const closed = paramsReducer(opened, { type: "TOGGLE_ADVANCED" });
      expect(closed.isAdvancedOpen).toBe(false);

      const explicitlyOpened = paramsReducer(closed, {
        type: "SET_ADVANCED_OPEN",
        isOpen: true,
      });
      expect(explicitlyOpened.isAdvancedOpen).toBe(true);
    });
  });

  describe("languageReducer", () => {
    it("updates language and marks savedLanguage as explicit", () => {
      const initial: { readonly language: "ja"; readonly savedLanguage: null } =
        {
          language: "ja",
          savedLanguage: null,
        };
      const updated = languageReducer(initial, {
        type: "SET_LANGUAGE",
        language: "en",
      });
      expect(updated.language).toBe("en");
      expect(updated.savedLanguage).toBe("en");
    });

    it("creates initial state with null or explicit savedLanguage", () => {
      const stateWithNull = createInitialLanguageState(null, ["ja"]);
      expect(stateWithNull.language).toBe("ja");
      expect(stateWithNull.savedLanguage).toBeNull();

      const stateWithExplicit = createInitialLanguageState("en", ["ja"]);
      expect(stateWithExplicit.language).toBe("en");
      expect(stateWithExplicit.savedLanguage).toBe("en");

      const stateWithInvalid = createInitialLanguageState("fr", ["ja"]);
      expect(stateWithInvalid.language).toBe("ja");
      expect(stateWithInvalid.savedLanguage).toBeNull();
    });
  });

  describe("singleConversionReducer", () => {
    it("handles image selection and resets results", () => {
      const initial = createInitialSingleConversionState();
      const updated = singleConversionReducer(initial, {
        type: "SET_IMAGE",
        image: { id: "h1", name: "logo.png" },
      });
      expect(updated.image).toEqual({ id: "h1", name: "logo.png" });
      expect(updated.status).toBe("loading_preview");
    });

    it("handles convert lifecycle and errors", () => {
      const initial = createInitialSingleConversionState();
      const converting = singleConversionReducer(initial, {
        type: "START_CONVERT",
      });
      expect(converting.status).toBe("converting");

      const success = singleConversionReducer(converting, {
        type: "CONVERT_SUCCESS",
        result: { svg: "<svg/>", pathCount: 5, bytes: 100, elapsedMs: 12 },
        svg: "<svg/>",
        svgUrl: "blob:http://localhost/svg",
      });
      expect(success.status).toBe("ready");
      expect(success.result?.pathCount).toBe(5);
      expect(success.svgUrl).toBe("blob:http://localhost/svg");

      const error = singleConversionReducer(converting, {
        type: "CONVERT_ERROR",
        error: { code: "DecodeFailed", detail: "corrupt" },
      });
      expect(error.status).toBe("error");
      expect(error.error?.code).toBe("DecodeFailed");
    });

    it("handles preview error and sets previewFailed flag", () => {
      const initial = createInitialSingleConversionState();
      const withImage = singleConversionReducer(initial, {
        type: "SET_IMAGE",
        image: { id: "h1", name: "broken.png" },
      });
      expect(withImage.previewFailed).toBe(false);

      const previewError = singleConversionReducer(withImage, {
        type: "PREVIEW_ERROR",
        error: { code: "DecodeFailed", detail: "corrupt image" },
      });
      expect(previewError.status).toBe("error");
      expect(previewError.error?.code).toBe("DecodeFailed");
      expect(previewError.previewFailed).toBe(true);

      // START_CONVERT does not clear error when previewFailed is true
      const ignoredConvert = singleConversionReducer(previewError, {
        type: "START_CONVERT",
      });
      expect(ignoredConvert.status).toBe("error");
      expect(ignoredConvert.error?.code).toBe("DecodeFailed");

      // Selecting another image resets previewFailed and clears error
      const nextImage = singleConversionReducer(previewError, {
        type: "SET_IMAGE",
        image: { id: "h2", name: "valid.png" },
      });
      expect(nextImage.status).toBe("loading_preview");
      expect(nextImage.error).toBeNull();
      expect(nextImage.previewFailed).toBe(false);

      // Successfully setting preview keeps previewFailed false
      const withPreview = singleConversionReducer(nextImage, {
        type: "SET_PREVIEW",
        previewUrl: "blob:http://localhost/preview",
      });
      expect(withPreview.previewFailed).toBe(false);
      expect(withPreview.previewUrl).toBe("blob:http://localhost/preview");
    });

    it("clamps zoom level within bounds and updates pan offset", () => {
      const initial = createInitialSingleConversionState();
      const zoomed = singleConversionReducer(initial, {
        type: "SET_ZOOM",
        zoom: 20.0,
      });
      expect(zoomed.zoom).toBe(16.0);

      const zoomMin = singleConversionReducer(initial, {
        type: "SET_ZOOM",
        zoom: 0.05,
      });
      expect(zoomMin.zoom).toBe(0.1);

      const panned = singleConversionReducer(initial, {
        type: "SET_PAN",
        pan: { x: 50, y: -30 },
      });
      expect(panned.pan).toEqual({ x: 50, y: -30 });
    });

    describe("calculateZoomPan pure function", () => {
      it("keeps the point under anchor at the same screen position before and after zoom", () => {
        const currentZoom = 1.0;
        const currentPan = { x: 100, y: -50 };
        const anchor = { x: 80, y: 120 };

        // Point on image (unscaled coordinates from image center) under anchor before zoom:
        // p = pan + z * I  =>  I = (p - pan) / z
        const imagePointX = (anchor.x - currentPan.x) / currentZoom;
        const imagePointY = (anchor.y - currentPan.y) / currentZoom;

        // 1. Zoom in (1.0 -> 2.0)
        const zoomedIn = calculateZoomPan(currentZoom, 2.0, currentPan, anchor);
        expect(zoomedIn.zoom).toBe(2.0);
        const screenAfterZoomInX = zoomedIn.pan.x + zoomedIn.zoom * imagePointX;
        const screenAfterZoomInY = zoomedIn.pan.y + zoomedIn.zoom * imagePointY;
        expect(screenAfterZoomInX).toBeCloseTo(anchor.x, 5);
        expect(screenAfterZoomInY).toBeCloseTo(anchor.y, 5);

        // 2. Zoom out (1.0 -> 0.5)
        const zoomedOut = calculateZoomPan(
          currentZoom,
          0.5,
          currentPan,
          anchor,
        );
        expect(zoomedOut.zoom).toBe(0.5);
        const screenAfterZoomOutX =
          zoomedOut.pan.x + zoomedOut.zoom * imagePointX;
        const screenAfterZoomOutY =
          zoomedOut.pan.y + zoomedOut.zoom * imagePointY;
        expect(screenAfterZoomOutX).toBeCloseTo(anchor.x, 5);
        expect(screenAfterZoomOutY).toBeCloseTo(anchor.y, 5);
      });

      it("scales pan by (z' / z) when p = 0 (pane center)", () => {
        const currentZoom = 1.0;
        const targetZoom = 1.5;
        const currentPan = { x: 60, y: -40 };

        // Explicit p = { x: 0, y: 0 }
        const withExplicitZero = calculateZoomPan(
          currentZoom,
          targetZoom,
          currentPan,
          { x: 0, y: 0 },
        );
        expect(withExplicitZero.zoom).toBe(1.5);
        expect(withExplicitZero.pan.x).toBeCloseTo(60 * 1.5, 5);
        expect(withExplicitZero.pan.y).toBeCloseTo(-40 * 1.5, 5);

        // Default anchor (omitted) should behave identically to p = 0
        const withDefaultAnchor = calculateZoomPan(
          currentZoom,
          targetZoom,
          currentPan,
        );
        expect(withDefaultAnchor.zoom).toBe(1.5);
        expect(withDefaultAnchor.pan.x).toBeCloseTo(60 * 1.5, 5);
        expect(withDefaultAnchor.pan.y).toBeCloseTo(-40 * 1.5, 5);
      });

      it("does not change pan when zoom reaches upper or lower bound and cannot change", () => {
        const currentPan = { x: 50, y: -30 };
        const anchor = { x: 120, y: -80 };

        // At MAX_ZOOM (16.0), attempting to zoom in further
        const atMax = calculateZoomPan(16.0, 20.0, currentPan, anchor);
        expect(atMax.zoom).toBe(16.0);
        expect(atMax.pan).toEqual(currentPan);

        // At MIN_ZOOM (0.1), attempting to zoom out further
        const atMin = calculateZoomPan(0.1, 0.05, currentPan, anchor);
        expect(atMin.zoom).toBe(0.1);
        expect(atMin.pan).toEqual(currentPan);
      });
    });

    describe("anchored zoom in singleConversionReducer", () => {
      it("updates zoom and pan using anchor on ZOOM_BY", () => {
        const initial = {
          ...createInitialSingleConversionState(),
          zoom: 1.0,
          pan: { x: 0, y: 0 },
        };
        const anchor = { x: 80, y: 60 };

        const updated = singleConversionReducer(initial, {
          type: "ZOOM_BY",
          factor: 1.25,
          anchor,
        });

        // pan' = p - (p - pan) * (z' / z)
        // pan'.x = 80 - (80 - 0) * 1.25 = 80 - 100 = -20
        // pan'.y = 60 - (60 - 0) * 1.25 = 60 - 75 = -15
        expect(updated.zoom).toBe(1.25);
        expect(updated.pan).toEqual({ x: -20, y: -15 });
      });

      it("scales pan by factor when anchor is omitted (p = 0)", () => {
        const initial = {
          ...createInitialSingleConversionState(),
          zoom: 1.0,
          pan: { x: 40, y: 60 },
        };

        const updated = singleConversionReducer(initial, {
          type: "ZOOM_BY",
          factor: 1.25,
        });

        // pan' = pan * 1.25 = { x: 50, y: 75 }
        expect(updated.zoom).toBe(1.25);
        expect(updated.pan).toEqual({ x: 50, y: 75 });
      });
    });
  });

  describe("batchConversionReducer", () => {
    it("handles batch status transitions", () => {
      const initial = createInitialBatchConversionState();
      const running = batchConversionReducer(initial, { type: "START_BATCH" });
      expect(running.status).toBe("running");

      const cancelling = batchConversionReducer(running, {
        type: "CANCEL_BATCH",
      });
      expect(cancelling.status).toBe("cancelling");

      const finished = batchConversionReducer(cancelling, {
        type: "FINISH_BATCH",
        finished: { succeeded: 3, failed: 1, skipped: 0, cancelled: true },
      });
      expect(finished.status).toBe("finished");
      expect(finished.finished?.cancelled).toBe(true);
    });

    it("populates items from inputDir targets with wait status", () => {
      const initial = createInitialBatchConversionState();
      const withInput = batchConversionReducer(initial, {
        type: "SET_INPUT_DIR",
        inputDir: {
          dirLabel: "test_folder",
          targets: ["a.png", "b.jpg"],
          ignoredCount: 2,
        },
      });

      expect(withInput.inputDir?.dirLabel).toBe("test_folder");
      expect(withInput.items).toHaveLength(2);
      expect(withInput.items[0]).toEqual({
        name: "a.png",
        outputName: null,
        status: "wait",
        error: null,
      });
      expect(withInput.items[1]).toEqual({
        name: "b.jpg",
        outputName: null,
        status: "wait",
        error: null,
      });
    });

    it("updates progress and marks the current item as running", () => {
      const initial = batchConversionReducer(
        createInitialBatchConversionState(),
        {
          type: "SET_INPUT_DIR",
          inputDir: {
            dirLabel: "dir",
            targets: ["a.png", "b.png"],
            ignoredCount: 0,
          },
        },
      );

      const updated = batchConversionReducer(initial, {
        type: "UPDATE_PROGRESS",
        progress: { done: 0, total: 2, current: "a.png" },
      });

      expect(updated.progress?.current).toBe("a.png");
      expect(updated.items[0]?.status).toBe("running");
      expect(updated.items[1]?.status).toBe("wait");
    });

    it("adds a new item row if batch-item arrives for a file not in targets", () => {
      const initial = batchConversionReducer(
        createInitialBatchConversionState(),
        {
          type: "SET_INPUT_DIR",
          inputDir: {
            dirLabel: "dir",
            targets: ["a.png"],
            ignoredCount: 0,
          },
        },
      );

      const updated = batchConversionReducer(initial, {
        type: "ITEM_PROCESSED",
        item: {
          name: "extra.png",
          status: "ok",
          outputName: "extra.svg",
          error: null,
        },
      });

      expect(updated.items).toHaveLength(2);
      expect(updated.items[1]).toEqual({
        name: "extra.png",
        status: "ok",
        outputName: "extra.svg",
        error: null,
      });
    });

    it("marks unprocessed items when finished with cancelled: true", () => {
      const initial = batchConversionReducer(
        createInitialBatchConversionState(),
        {
          type: "SET_INPUT_DIR",
          inputDir: {
            dirLabel: "dir",
            targets: ["done.png", "running.png", "waiting.png"],
            ignoredCount: 0,
          },
        },
      );

      const withDone = batchConversionReducer(initial, {
        type: "ITEM_PROCESSED",
        item: {
          name: "done.png",
          status: "ok",
          outputName: "done.svg",
          error: null,
        },
      });

      const withRunning = batchConversionReducer(withDone, {
        type: "UPDATE_PROGRESS",
        progress: { done: 1, total: 3, current: "running.png" },
      });

      const cancelled = batchConversionReducer(withRunning, {
        type: "FINISH_BATCH",
        finished: {
          succeeded: 1,
          failed: 0,
          skipped: 2,
          cancelled: true,
        },
      });

      expect(cancelled.items[0]?.status).toBe("ok");
      expect(cancelled.items[1]?.status).toBe("unprocessed");
      expect(cancelled.items[2]?.status).toBe("unprocessed");
    });

    it("resets status to idle and clears progress and finished when input or output folder is changed", () => {
      const finishedState = batchConversionReducer(
        createInitialBatchConversionState(),
        {
          type: "FINISH_BATCH",
          finished: { succeeded: 2, failed: 0, skipped: 0, cancelled: false },
        },
      );
      expect(finishedState.status).toBe("finished");
      expect(finishedState.finished).not.toBeNull();

      // Changing input dir resets status to idle, clears progress and finished
      const resetInput = batchConversionReducer(finishedState, {
        type: "SET_INPUT_DIR",
        inputDir: {
          dirLabel: "new_in",
          targets: ["new.png"],
          ignoredCount: 0,
        },
      });
      expect(resetInput.status).toBe("idle");
      expect(resetInput.progress).toBeNull();
      expect(resetInput.finished).toBeNull();

      // Changing output dir on a finished state also resets status, progress, and finished
      const finishedState2 = {
        ...finishedState,
        status: "finished" as const,
        progress: { done: 2, total: 2, current: null },
      };
      const resetOutput = batchConversionReducer(finishedState2, {
        type: "SET_OUTPUT_DIR",
        outputDir: { dirLabel: "new_out" },
      });
      expect(resetOutput.status).toBe("idle");
      expect(resetOutput.progress).toBeNull();
      expect(resetOutput.finished).toBeNull();
    });

    it("resets all item rows to wait and clears output names and errors on SET_OUTPUT_DIR after batch conversion finishes", () => {
      const initial = batchConversionReducer(
        createInitialBatchConversionState(),
        {
          type: "SET_INPUT_DIR",
          inputDir: {
            dirLabel: "dir",
            targets: ["done.png", "failed.png"],
            ignoredCount: 0,
          },
        },
      );

      const running = batchConversionReducer(initial, {
        type: "START_BATCH",
      });

      const withOk = batchConversionReducer(running, {
        type: "ITEM_PROCESSED",
        item: {
          name: "done.png",
          status: "ok",
          outputName: "done.svg",
          error: null,
        },
      });

      const withError: IpcError = {
        code: "DecodeFailed",
        detail: "broken image",
      };
      const withFailed = batchConversionReducer(withOk, {
        type: "ITEM_PROCESSED",
        item: {
          name: "failed.png",
          status: "failed",
          outputName: null,
          error: withError,
        },
      });

      const finished = batchConversionReducer(withFailed, {
        type: "FINISH_BATCH",
        finished: {
          succeeded: 1,
          failed: 1,
          skipped: 0,
          cancelled: false,
        },
      });

      expect(finished.items[0]).toEqual({
        name: "done.png",
        status: "ok",
        outputName: "done.svg",
        error: null,
      });
      expect(finished.items[1]).toEqual({
        name: "failed.png",
        status: "failed",
        outputName: null,
        error: withError,
      });

      const reset = batchConversionReducer(finished, {
        type: "SET_OUTPUT_DIR",
        outputDir: { dirLabel: "new_out" },
      });

      expect(reset.status).toBe("idle");
      expect(reset.outputDir?.dirLabel).toBe("new_out");
      expect(reset.items).toEqual([
        {
          name: "done.png",
          status: "wait",
          outputName: null,
          error: null,
        },
        {
          name: "failed.png",
          status: "wait",
          outputName: null,
          error: null,
        },
      ]);
    });

    it("marks unprocessed items even when finished with cancelled: false if items never reported", () => {
      const initial = batchConversionReducer(
        createInitialBatchConversionState(),
        {
          type: "SET_INPUT_DIR",
          inputDir: {
            dirLabel: "dir",
            targets: ["done.png", "missing.png"],
            ignoredCount: 0,
          },
        },
      );

      const withDone = batchConversionReducer(initial, {
        type: "ITEM_PROCESSED",
        item: {
          name: "done.png",
          status: "ok",
          outputName: "done.svg",
          error: null,
        },
      });

      // Normal finish (cancelled: false), but missing.png never received an item event
      const finished = batchConversionReducer(withDone, {
        type: "FINISH_BATCH",
        finished: {
          succeeded: 1,
          failed: 0,
          skipped: 1,
          cancelled: false,
        },
      });

      expect(finished.items[0]?.status).toBe("ok");
      expect(finished.items[1]?.status).toBe("unprocessed");
    });

    it("resets status to idle on START_BATCH_FAILED or SET_ERROR and sets error", () => {
      const initial = batchConversionReducer(
        createInitialBatchConversionState(),
        {
          type: "START_BATCH",
        },
      );
      expect(initial.status).toBe("running");

      const failed = batchConversionReducer(initial, {
        type: "START_BATCH_FAILED",
        error: { code: "UnknownHandle", detail: "directory gone" },
      });

      expect(failed.status).toBe("idle");
      expect(failed.error).toEqual({
        code: "UnknownHandle",
        detail: "directory gone",
      });

      const errorSet = batchConversionReducer(initial, {
        type: "SET_ERROR",
        error: { code: "ReadFailed", detail: "permission denied" },
      });
      expect(errorSet.status).toBe("idle");
      expect(errorSet.error).toEqual({
        code: "ReadFailed",
        detail: "permission denied",
      });
    });

    it("initializes batch state with restored inputDir and outputDir", () => {
      const inputDir = {
        dirLabel: "RestoredInput",
        targets: ["image1.png", "image2.jpg"],
        ignoredCount: 5,
      };
      const outputDir = { dirLabel: "RestoredOutput" };

      const state = createInitialBatchConversionState(inputDir, outputDir);
      expect(state.status).toBe("idle");
      expect(state.inputDir).toEqual(inputDir);
      expect(state.outputDir).toEqual(outputDir);
      expect(state.items).toEqual([
        {
          name: "image1.png",
          outputName: null,
          status: "wait",
          error: null,
        },
        {
          name: "image2.jpg",
          outputName: null,
          status: "wait",
          error: null,
        },
      ]);
    });
  });
});

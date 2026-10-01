import { describe, expect, it } from "vitest";
import type { IpcError, ParamSpec, TraceParams } from "../ipc";
import {
  batchConversionReducer,
  createInitialBatchConversionState,
} from "./batchConversion";
import { languageReducer } from "./language";
import { createInitialParamsState, paramsReducer } from "./params";
import {
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
    it("updates language", () => {
      const initial = { language: "ja" as const };
      const updated = languageReducer(initial, {
        type: "SET_LANGUAGE",
        language: "en",
      });
      expect(updated.language).toBe("en");
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
      });
      expect(success.status).toBe("ready");
      expect(success.result?.pathCount).toBe(5);

      const error = singleConversionReducer(converting, {
        type: "CONVERT_ERROR",
        error: { code: "DecodeFailed", detail: "corrupt" },
      });
      expect(error.status).toBe("error");
      expect(error.error?.code).toBe("DecodeFailed");
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
  });
});

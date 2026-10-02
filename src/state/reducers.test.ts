import { describe, expect, it } from "vitest";
import type { IpcError, ParamSpec, TraceParams } from "../ipc";
import {
  batchConversionReducer,
  createInitialBatchConversionState,
} from "./batchConversion";
import { languageReducer } from "./language";
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
  });
});

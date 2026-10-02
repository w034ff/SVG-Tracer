import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import {
  convert,
  getAbout,
  getParamSpec,
  getSettings,
  isErrorCode,
  isIpcError,
  loadPreview,
  normalizeIpcError,
  pickImage,
  saveSettings,
  saveSvg,
} from "./index";
import type {
  ConvertResult,
  IpcError,
  ParamSpec,
  PickedImage,
  SaveSvgResult,
  TraceParams,
} from "./index";

const SAMPLE_PARAMS: TraceParams = {
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

const SAMPLE_SPEC: ParamSpec = {
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
    {
      id: "colorLogo",
      params: SAMPLE_PARAMS,
    },
  ],
  defaultPreset: "colorLogo",
};

describe("ipc wrapper", () => {
  afterEach(() => {
    clearMocks();
  });

  describe("isErrorCode", () => {
    it("returns true for valid ErrorCode strings", () => {
      expect(isErrorCode("UnsupportedFormat")).toBe(true);
      expect(isErrorCode("DecodeFailed")).toBe(true);
      expect(isErrorCode("TooLarge")).toBe(true);
      expect(isErrorCode("ReadFailed")).toBe(true);
      expect(isErrorCode("WriteFailed")).toBe(true);
      expect(isErrorCode("TraceFailed")).toBe(true);
      expect(isErrorCode("Superseded")).toBe(true);
      expect(isErrorCode("BatchRunning")).toBe(true);
      expect(isErrorCode("UnknownHandle")).toBe(true);
      expect(isErrorCode("InvalidParams")).toBe(true);
    });

    it("returns false for invalid values", () => {
      expect(isErrorCode("RandomError")).toBe(false);
      expect(isErrorCode(123)).toBe(false);
      expect(isErrorCode(null)).toBe(false);
      expect(isErrorCode(undefined)).toBe(false);
    });
  });

  describe("isIpcError", () => {
    it("returns true for objects matching IpcError structure", () => {
      expect(
        isIpcError({ code: "UnsupportedFormat", detail: "Bad file" }),
      ).toBe(true);
      expect(isIpcError({ code: "TooLarge", detail: null })).toBe(true);
    });

    it("returns false for non-matching objects", () => {
      expect(isIpcError(null)).toBe(false);
      expect(isIpcError("plain string")).toBe(false);
      expect(isIpcError({ code: "NonExistent", detail: null })).toBe(false);
      expect(isIpcError({ code: "TooLarge", detail: 123 })).toBe(false);
      expect(isIpcError({ detail: "missing code" })).toBe(false);
    });
  });

  describe("normalizeIpcError", () => {
    it("preserves already structured IpcError", () => {
      const err: IpcError = { code: "DecodeFailed", detail: "corrupt chunk" };
      expect(normalizeIpcError(err)).toEqual(err);
    });

    it("converts raw string error into InvalidParams IpcError", () => {
      const err = "Invalid argument type for 'params'";
      expect(normalizeIpcError(err)).toEqual({
        code: "InvalidParams",
        detail: err,
      });
    });

    it("converts JavaScript Error object into InvalidParams IpcError", () => {
      const err = new Error("Network / IPC failure");
      expect(normalizeIpcError(err)).toEqual({
        code: "InvalidParams",
        detail: "Network / IPC failure",
      });
    });
  });

  describe("typed command wrappers with mockIPC", () => {
    it("getParamSpec resolves successfully", async () => {
      mockIPC((cmd) => {
        if (cmd === "get_param_spec") {
          return SAMPLE_SPEC;
        }
      });

      const spec = await getParamSpec();
      expect(spec.defaultPreset).toBe("colorLogo");
      expect(spec.presets).toHaveLength(1);
    });

    it("getSettings resolves with Settings", async () => {
      const mockSettings = {
        language: "ja" as const,
        preset: "colorLogo" as const,
        params: SAMPLE_PARAMS,
        batchInput: null,
        batchOutput: null,
      };
      mockIPC((cmd) => {
        if (cmd === "get_settings") {
          return mockSettings;
        }
      });

      const settings = await getSettings();
      expect(settings).toEqual(mockSettings);
    });

    it("saveSettings invokes save_settings with arguments", async () => {
      let passedArgs: unknown = null;
      mockIPC((cmd, args) => {
        if (cmd === "save_settings") {
          passedArgs = args;
          return null;
        }
      });

      await saveSettings("en", null, SAMPLE_PARAMS);
      expect(passedArgs).toEqual({
        language: "en",
        preset: null,
        params: SAMPLE_PARAMS,
      });
    });

    it("getAbout resolves with AboutInfo", async () => {
      const mockAbout = { version: "1.2.3" };
      mockIPC((cmd) => {
        if (cmd === "get_about") {
          return mockAbout;
        }
      });

      const about = await getAbout();
      expect(about).toEqual(mockAbout);
    });

    it("pickImage resolves with PickedImage", async () => {
      const mockResult: PickedImage = { id: "handle-1", name: "test.png" };
      mockIPC((cmd) => {
        if (cmd === "pick_image") {
          return mockResult;
        }
      });

      const result = await pickImage();
      expect(result).toEqual(mockResult);
    });

    it("convert resolves with ConvertResult", async () => {
      const mockResult: ConvertResult = {
        svg: "<svg></svg>",
        pathCount: 12,
        bytes: 1024,
        elapsedMs: 25,
      };
      mockIPC((cmd) => {
        if (cmd === "convert") {
          return mockResult;
        }
      });

      const result = await convert("handle-1", SAMPLE_PARAMS, 1);
      expect(result).toEqual(mockResult);
    });

    it("saveSvg resolves with SaveSvgResult", async () => {
      const mockResult: SaveSvgResult = { savedName: "output.svg" };
      mockIPC((cmd) => {
        if (cmd === "save_svg") {
          return mockResult;
        }
      });

      const result = await saveSvg("handle-1");
      expect(result).toEqual(mockResult);
    });

    it("loadPreview resolves with ArrayBuffer", async () => {
      const buffer = new ArrayBuffer(8);
      mockIPC((cmd) => {
        if (cmd === "load_preview") {
          return buffer;
        }
      });

      const result = await loadPreview("handle-1");
      expect(result).toBe(buffer);
    });

    it("converts raw rejection into normalized InvalidParams IpcError", async () => {
      mockIPC((cmd) => {
        if (cmd === "convert") {
          return Promise.reject("Invalid field type for colorMode");
        }
      });

      await expect(convert("handle-1", SAMPLE_PARAMS, 1)).rejects.toEqual({
        code: "InvalidParams",
        detail: "Invalid field type for colorMode",
      });
    });

    it("preserves structured IpcError rejection", async () => {
      const structuredError: IpcError = {
        code: "UnsupportedFormat",
        detail: "GIF format not enabled",
      };
      mockIPC((cmd) => {
        if (cmd === "convert") {
          return Promise.reject(structuredError);
        }
      });

      await expect(convert("handle-1", SAMPLE_PARAMS, 1)).rejects.toEqual(
        structuredError,
      );
    });
  });

  describe("onImageDropped", () => {
    it("subscribes to image-dropped events and unlistens cleanly", async () => {
      const { emit } = await import("@tauri-apps/api/event");
      const { onImageDropped } = await import("./index");
      mockIPC(() => {}, { shouldMockEvents: true });

      const received: unknown[] = [];
      const unlisten = await onImageDropped((payload) => {
        received.push(payload);
      });

      await emit("image-dropped", { id: "dropped-id-1", name: "test.png" });
      expect(received).toEqual([{ id: "dropped-id-1", name: "test.png" }]);

      await unlisten();

      await emit("image-dropped", { id: "dropped-id-2", name: "test2.png" });
      expect(received).toHaveLength(1);
    });
  });

  describe("batch event listeners", () => {
    it("onBatchProgress receives batch-progress events and unlistens cleanly", async () => {
      const { emit } = await import("@tauri-apps/api/event");
      const { onBatchProgress } = await import("./index");
      mockIPC(() => {}, { shouldMockEvents: true });

      const received: unknown[] = [];
      const unlisten = await onBatchProgress((payload) => {
        received.push(payload);
      });

      const payload = { done: 3, total: 10, current: "image3.png" };
      await emit("batch-progress", payload);
      expect(received).toEqual([payload]);

      await unlisten();

      await emit("batch-progress", {
        done: 4,
        total: 10,
        current: "image4.png",
      });
      expect(received).toHaveLength(1);
    });

    it("onBatchItem receives batch-item events and unlistens cleanly", async () => {
      const { emit } = await import("@tauri-apps/api/event");
      const { onBatchItem } = await import("./index");
      mockIPC(() => {}, { shouldMockEvents: true });

      const received: unknown[] = [];
      const unlisten = await onBatchItem((payload) => {
        received.push(payload);
      });

      const payload = {
        name: "test.png",
        status: "ok" as const,
        outputName: "test.svg",
        error: null,
      };
      await emit("batch-item", payload);
      expect(received).toEqual([payload]);

      await unlisten();

      await emit("batch-item", {
        name: "test2.png",
        status: "failed" as const,
        outputName: null,
        error: null,
      });
      expect(received).toHaveLength(1);
    });

    it("onBatchFinished receives batch-finished events and unlistens cleanly", async () => {
      const { emit } = await import("@tauri-apps/api/event");
      const { onBatchFinished } = await import("./index");
      mockIPC(() => {}, { shouldMockEvents: true });

      const received: unknown[] = [];
      const unlisten = await onBatchFinished((payload) => {
        received.push(payload);
      });

      const payload = {
        succeeded: 8,
        failed: 2,
        skipped: 0,
        cancelled: false,
      };
      await emit("batch-finished", payload);
      expect(received).toEqual([payload]);

      await unlisten();

      await emit("batch-finished", {
        succeeded: 0,
        failed: 0,
        skipped: 10,
        cancelled: true,
      });
      expect(received).toHaveLength(1);
    });
  });
});

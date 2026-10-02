import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceParams } from "../../ipc";
import { SETTINGS_SAVE_DEBOUNCE_MS } from "./constants";
import {
  useSettingsAutoSave,
  type SettingsAutoSaveInput,
} from "./useSettingsAutoSave";

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

function TestComponent(props: SettingsAutoSaveInput) {
  useSettingsAutoSave(props);
  return null;
}

describe("useSettingsAutoSave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearMocks();
  });

  it("does not call save_settings on initial mount / restoration", () => {
    let callCount = 0;
    mockIPC((cmd) => {
      if (cmd === "save_settings") {
        callCount += 1;
        return null;
      }
    });

    render(
      <TestComponent language="ja" preset="colorLogo" params={SAMPLE_PARAMS} />,
    );

    act(() => {
      vi.advanceTimersByTime(SETTINGS_SAVE_DEBOUNCE_MS * 2);
    });

    expect(callCount).toBe(0);
  });

  it("debounces rapid parameter changes into a single save_settings call", () => {
    const savedCalls: unknown[] = [];
    mockIPC((cmd, args) => {
      if (cmd === "save_settings") {
        savedCalls.push(args);
        return null;
      }
    });

    const { rerender } = render(
      <TestComponent language="ja" preset="colorLogo" params={SAMPLE_PARAMS} />,
    );

    // First change at t = 0
    const changedParams1 = { ...SAMPLE_PARAMS, colorPrecision: 7 };
    rerender(
      <TestComponent language="ja" preset="custom" params={changedParams1} />,
    );

    // Advance 400ms (not yet 1000ms)
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(savedCalls).toHaveLength(0);

    // Second change at t = 400ms
    const changedParams2 = { ...changedParams1, filterSpeckle: 8 };
    rerender(
      <TestComponent language="ja" preset="custom" params={changedParams2} />,
    );

    // Advance 400ms more (t = 800ms total)
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(savedCalls).toHaveLength(0);

    // Advance 600ms more (t = 1400ms, 1000ms after last change)
    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(savedCalls).toHaveLength(1);
    expect(savedCalls[0]).toEqual({
      language: "ja",
      preset: null, // "custom" is converted to null
      params: changedParams2,
    });
  });

  it("sends preset name when preset is not custom", () => {
    const savedCalls: unknown[] = [];
    mockIPC((cmd, args) => {
      if (cmd === "save_settings") {
        savedCalls.push(args);
        return null;
      }
    });

    const { rerender } = render(
      <TestComponent language="ja" preset="colorLogo" params={SAMPLE_PARAMS} />,
    );

    rerender(
      <TestComponent
        language="ja"
        preset="binary"
        params={{ ...SAMPLE_PARAMS, colorMode: "binary" }}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(SETTINGS_SAVE_DEBOUNCE_MS);
    });

    expect(savedCalls).toHaveLength(1);
    expect(savedCalls[0]).toEqual({
      language: "ja",
      preset: "binary",
      params: { ...SAMPLE_PARAMS, colorMode: "binary" },
    });
  });

  it("saves new language when language changes", () => {
    const savedCalls: unknown[] = [];
    mockIPC((cmd, args) => {
      if (cmd === "save_settings") {
        savedCalls.push(args);
        return null;
      }
    });

    const { rerender } = render(
      <TestComponent language="ja" preset="colorLogo" params={SAMPLE_PARAMS} />,
    );

    rerender(
      <TestComponent language="en" preset="colorLogo" params={SAMPLE_PARAMS} />,
    );

    act(() => {
      vi.advanceTimersByTime(SETTINGS_SAVE_DEBOUNCE_MS);
    });

    expect(savedCalls).toHaveLength(1);
    expect(savedCalls[0]).toEqual({
      language: "en",
      preset: "colorLogo",
      params: SAMPLE_PARAMS,
    });
  });

  it("preserves null language when language is null and params change", () => {
    const savedCalls: unknown[] = [];
    mockIPC((cmd, args) => {
      if (cmd === "save_settings") {
        savedCalls.push(args);
        return null;
      }
    });

    const { rerender } = render(
      <TestComponent
        language={null}
        preset="colorLogo"
        params={SAMPLE_PARAMS}
      />,
    );

    const changedParams = { ...SAMPLE_PARAMS, colorPrecision: 8 };
    rerender(
      <TestComponent language={null} preset="custom" params={changedParams} />,
    );

    act(() => {
      vi.advanceTimersByTime(SETTINGS_SAVE_DEBOUNCE_MS);
    });

    expect(savedCalls).toHaveLength(1);
    expect(savedCalls[0]).toEqual({
      language: null,
      preset: null,
      params: changedParams,
    });
  });

  it("saves chosen language when changing from null to en", () => {
    const savedCalls: unknown[] = [];
    mockIPC((cmd, args) => {
      if (cmd === "save_settings") {
        savedCalls.push(args);
        return null;
      }
    });

    const { rerender } = render(
      <TestComponent
        language={null}
        preset="colorLogo"
        params={SAMPLE_PARAMS}
      />,
    );

    rerender(
      <TestComponent language="en" preset="colorLogo" params={SAMPLE_PARAMS} />,
    );

    act(() => {
      vi.advanceTimersByTime(SETTINGS_SAVE_DEBOUNCE_MS);
    });

    expect(savedCalls).toHaveLength(1);
    expect(savedCalls[0]).toEqual({
      language: "en",
      preset: "colorLogo",
      params: SAMPLE_PARAMS,
    });
  });

  it("does not crash or throw when save_settings fails", () => {
    mockIPC((cmd) => {
      if (cmd === "save_settings") {
        return Promise.reject(new Error("Disk error"));
      }
    });

    const { rerender } = render(
      <TestComponent language="ja" preset="colorLogo" params={SAMPLE_PARAMS} />,
    );

    rerender(
      <TestComponent language="en" preset="colorLogo" params={SAMPLE_PARAMS} />,
    );

    expect(() => {
      act(() => {
        vi.advanceTimersByTime(SETTINGS_SAVE_DEBOUNCE_MS);
      });
    }).not.toThrow();
  });
});

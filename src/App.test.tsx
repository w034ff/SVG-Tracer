import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { App } from "./App";
import { SETTINGS_SAVE_DEBOUNCE_MS } from "./features/settings/constants";
import type { ParamSpec, Settings, TraceParams } from "./ipc";

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

const TEST_SPEC: ParamSpec = {
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
  ],
  defaultPreset: "colorLogo",
};

describe("App", () => {
  beforeEach(() => {
    mockIPC(
      (cmd) => {
        if (cmd === "load_preview") {
          return new Uint8Array([137, 80, 78, 71]).buffer;
        }
        return null;
      },
      { shouldMockEvents: true },
    );
  });

  afterEach(() => {
    clearMocks();
  });
  it("renders the top bar with app title, mode tabs, language selector, and about button in Japanese", () => {
    render(<App initialSpec={TEST_SPEC} initialLanguage="ja" />);

    expect(screen.getByText("SVG Tracer")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "単体変換" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "一括変換" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getByLabelText("言語")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "このアプリについて" }),
    ).toBeInTheDocument();
  });

  it("switches active tab when clicked", () => {
    render(<App initialSpec={TEST_SPEC} initialLanguage="ja" />);

    const singleTab = screen.getByRole("tab", { name: "単体変換" });
    const batchTab = screen.getByRole("tab", { name: "一括変換" });

    fireEvent.click(batchTab);
    expect(batchTab).toHaveAttribute("aria-selected", "true");
    expect(singleTab).toHaveAttribute("aria-selected", "false");

    fireEvent.click(singleTab);
    expect(singleTab).toHaveAttribute("aria-selected", "true");
    expect(batchTab).toHaveAttribute("aria-selected", "false");
  });

  it("switches UI language dynamically", () => {
    render(<App initialSpec={TEST_SPEC} initialLanguage="ja" />);

    const langSelect = screen.getByLabelText("言語");
    fireEvent.change(langSelect, { target: { value: "en" } });

    // Header tabs should update to English
    expect(screen.getByRole("tab", { name: "Single" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Batch" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "About" })).toBeInTheDocument();

    // ParamsPanel labels should update to English
    expect(screen.getByLabelText("Preset")).toBeInTheDocument();
    expect(screen.getByText("Remove specks")).toBeInTheDocument();
  });

  it("renders with English as default when navigator languages do not contain ja", () => {
    render(<App initialSpec={TEST_SPEC} initialLanguage="en" />);

    expect(screen.getByRole("tab", { name: "Single" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Batch" })).toBeInTheDocument();
    expect(screen.getByLabelText("Language")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "About" })).toBeInTheDocument();
  });

  it("displays localized error message when getParamSpec fails", async () => {
    mockIPC((cmd) => {
      if (cmd === "get_param_spec") {
        return Promise.reject({
          code: "ReadFailed",
          detail: "Backend read error",
        });
      }
    });

    render(<App initialLanguage="ja" />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByText("パラメータ設定の読み込みに失敗しました"),
    ).toBeInTheDocument();
    expect(screen.getByText("Backend read error")).toBeInTheDocument();
  });

  it("switches to single conversion tab when image-dropped event is received while on batch tab", async () => {
    const { emit } = await import("@tauri-apps/api/event");

    mockIPC(
      (cmd) => {
        if (cmd === "load_preview") {
          return new Uint8Array([137, 80, 78, 71]).buffer;
        }
        if (cmd === "convert") {
          return {
            svg: "<svg/>",
            pathCount: 10,
            bytes: 1024,
            elapsedMs: 100,
          };
        }
        return null;
      },
      { shouldMockEvents: true },
    );

    render(<App initialSpec={TEST_SPEC} initialLanguage="ja" />);

    // Switch to batch tab
    const batchTab = screen.getByRole("tab", { name: "一括変換" });
    const singleTab = screen.getByRole("tab", { name: "単体変換" });
    fireEvent.click(batchTab);

    expect(batchTab).toHaveAttribute("aria-selected", "true");
    expect(singleTab).toHaveAttribute("aria-selected", "false");

    // Emit image-dropped event
    await act(async () => {
      await emit("image-dropped", {
        id: "drop-id-99",
        name: "dropped_logo.png",
      });
    });

    // Should switch back to single tab
    expect(singleTab).toHaveAttribute("aria-selected", "true");
    expect(batchTab).toHaveAttribute("aria-selected", "false");

    // The single conversion view should display the dropped image's name
    expect(await screen.findByText("dropped_logo.png")).toBeInTheDocument();
  });

  it("preserves preview and svg URLs and does not re-call load_preview or convert when switching tabs", async () => {
    const { emit } = await import("@tauri-apps/api/event");

    let loadPreviewCalls = 0;
    let convertCalls = 0;

    mockIPC(
      (cmd) => {
        if (cmd === "load_preview") {
          loadPreviewCalls += 1;
          return new Uint8Array([137, 80, 78, 71]).buffer;
        }
        if (cmd === "convert") {
          convertCalls += 1;
          return {
            svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>',
            pathCount: 10,
            bytes: 100,
            elapsedMs: 20,
          };
        }
        return null;
      },
      { shouldMockEvents: true },
    );

    const revokedUrls: string[] = [];
    const origRevoke = window.URL.revokeObjectURL;
    vi.spyOn(window.URL, "revokeObjectURL").mockImplementation((url) => {
      revokedUrls.push(url);
      origRevoke(url);
    });

    try {
      render(<App initialSpec={TEST_SPEC} initialLanguage="ja" />);

      // Load an image via image-dropped
      await act(async () => {
        await emit("image-dropped", {
          id: "tab-test-id",
          name: "tab_test.png",
        });
      });

      expect(await screen.findByText("tab_test.png")).toBeInTheDocument();

      // Wait for load_preview and convert to complete
      const previewImg = await screen.findByAltText("元画像のプレビュー");
      const svgImg = await screen.findByAltText("SVG のプレビュー");

      const previewSrc = previewImg.getAttribute("src");
      const svgSrc = svgImg.getAttribute("src");
      expect(previewSrc).toBeTruthy();
      expect(svgSrc).toBeTruthy();
      expect(loadPreviewCalls).toBe(1);
      expect(convertCalls).toBe(1);

      // Switch to Batch tab
      const batchTab = screen.getByRole("tab", { name: "一括変換" });
      const singleTab = screen.getByRole("tab", { name: "単体変換" });
      fireEvent.click(batchTab);

      expect(batchTab).toHaveAttribute("aria-selected", "true");
      expect(singleTab).toHaveAttribute("aria-selected", "false");

      // Verify URLs were NOT revoked when hidden
      if (!previewSrc || !svgSrc) {
        throw new Error("Preview or SVG URL is missing");
      }
      expect(revokedUrls).not.toContain(previewSrc);
      expect(revokedUrls).not.toContain(svgSrc);

      // Switch back to Single tab
      fireEvent.click(singleTab);
      expect(singleTab).toHaveAttribute("aria-selected", "true");

      // Verify the active image elements still display the same valid URLs
      const activePreview = screen.getByAltText("元画像のプレビュー");
      const activeSvg = screen.getByAltText("SVG のプレビュー");
      expect(activePreview.getAttribute("src")).toBe(previewSrc);
      expect(activeSvg.getAttribute("src")).toBe(svgSrc);

      // Neither URL should have been revoked
      expect(revokedUrls).not.toContain(previewSrc);
      expect(revokedUrls).not.toContain(svgSrc);

      // Neither load_preview nor convert should have been called again
      expect(loadPreviewCalls).toBe(1);
      expect(convertCalls).toBe(1);
    } finally {
      window.URL.revokeObjectURL = origRevoke;
    }
  });

  describe("T11: Settings restoration, Auto-save, and About dialog", () => {
    beforeAll(async () => {
      // Prewarm dynamic import of licenses to prevent timeout in tests
      await import("./licenses");
    });

    it("restores saved language, preset, and params on startup via production get_settings path", async () => {
      const savedSettings: Settings = {
        language: "en",
        preset: "colorIcon",
        params: COLOR_ICON_PARAMS,
        batchInput: null,
        batchOutput: null,
      };

      mockIPC((cmd) => {
        if (cmd === "get_settings") {
          return savedSettings;
        }
        if (cmd === "get_param_spec") {
          return TEST_SPEC;
        }
        return null;
      });

      render(<App />);

      expect(
        await screen.findByRole("tab", { name: "Single" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Batch" })).toBeInTheDocument();

      const langSelect = screen.getByLabelText("Language");
      expect(langSelect).toHaveValue("en");

      const presetSelect = screen.getByLabelText("Preset");
      expect(presetSelect).toHaveValue("colorIcon");

      const colorPrecisionSlider = screen.getByLabelText(/Color precision/);
      expect(colorPrecisionSlider).toHaveValue("4");

      const filterSpeckleSlider = screen.getByLabelText(/Remove specks/);
      expect(filterSpeckleSlider).toHaveValue("8");
    });

    it("restores custom preset (preset: null) and reflects params", async () => {
      const customParams: TraceParams = {
        ...COLOR_LOGO_PARAMS,
        colorPrecision: 8,
        filterSpeckle: 12,
      };
      const savedSettings: Settings = {
        language: "ja",
        preset: null,
        params: customParams,
        batchInput: null,
        batchOutput: null,
      };

      mockIPC((cmd) => {
        if (cmd === "get_settings") {
          return savedSettings;
        }
        if (cmd === "get_param_spec") {
          return TEST_SPEC;
        }
        return null;
      });

      render(<App />);

      expect(
        await screen.findByRole("tab", { name: "単体変換" }),
      ).toBeInTheDocument();

      const presetSelect = screen.getByLabelText("プリセット");
      expect(presetSelect).toHaveValue("custom");

      const colorPrecisionSlider = screen.getByLabelText(/色の精度/);
      expect(colorPrecisionSlider).toHaveValue("8");

      const filterSpeckleSlider = screen.getByLabelText(/ノイズ除去/);
      expect(filterSpeckleSlider).toHaveValue("12");
    });

    it("restores batchInput and batchOutput in batch tab with items in wait status", async () => {
      const savedSettings: Settings = {
        language: "ja",
        preset: "colorLogo",
        params: COLOR_LOGO_PARAMS,
        batchInput: {
          dirLabel: "RestoredInputFolder",
          targets: ["target_a.png", "target_b.png"],
          ignoredCount: 3,
        },
        batchOutput: {
          dirLabel: "RestoredOutputFolder",
        },
      };

      mockIPC((cmd) => {
        if (cmd === "get_settings") {
          return savedSettings;
        }
        if (cmd === "get_param_spec") {
          return TEST_SPEC;
        }
        return null;
      });

      render(<App />);

      expect(
        await screen.findByRole("tab", { name: "一括変換" }),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole("tab", { name: "一括変換" }));

      expect(screen.getByText("RestoredInputFolder")).toBeInTheDocument();
      expect(screen.getByText("RestoredOutputFolder")).toBeInTheDocument();
      expect(screen.getByText(/対象 2 件 · 対象外 3 件/)).toBeInTheDocument();

      expect(screen.getByText("target_a.png")).toBeInTheDocument();
      expect(screen.getByText("target_b.png")).toBeInTheDocument();
      const waitBadges = screen.getAllByText("待機");
      expect(waitBadges).toHaveLength(2);

      const startButton = screen.getByRole("button", { name: "変換を開始" });
      expect(startButton).not.toBeDisabled();
    });

    it("does not invoke save_settings on startup restoration", () => {
      let saveCount = 0;
      mockIPC((cmd) => {
        if (cmd === "save_settings") {
          saveCount += 1;
          return null;
        }
        return null;
      });

      vi.useFakeTimers();
      try {
        render(<App initialSpec={TEST_SPEC} initialLanguage="ja" />);

        act(() => {
          vi.advanceTimersByTime(SETTINGS_SAVE_DEBOUNCE_MS * 3);
        });

        expect(saveCount).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("debounces rapid parameter modifications into a single save_settings call", () => {
      const savedPayloads: unknown[] = [];
      mockIPC((cmd, args) => {
        if (cmd === "save_settings") {
          savedPayloads.push(args);
          return null;
        }
        return null;
      });

      vi.useFakeTimers();
      try {
        render(<App initialSpec={TEST_SPEC} initialLanguage="ja" />);

        const slider1 = screen.getByLabelText(/色の精度/);
        fireEvent.change(slider1, { target: { value: "7" } });

        act(() => {
          vi.advanceTimersByTime(400);
        });
        expect(savedPayloads).toHaveLength(0);

        const slider2 = screen.getByLabelText(/ノイズ除去/);
        fireEvent.change(slider2, { target: { value: "10" } });

        act(() => {
          vi.advanceTimersByTime(400);
        });
        expect(savedPayloads).toHaveLength(0);

        fireEvent.change(slider1, { target: { value: "8" } });

        act(() => {
          vi.advanceTimersByTime(SETTINGS_SAVE_DEBOUNCE_MS);
        });

        expect(savedPayloads).toHaveLength(1);
        expect(savedPayloads[0]).toEqual({
          language: "ja",
          preset: null,
          params: {
            ...COLOR_LOGO_PARAMS,
            colorPrecision: 8,
            filterSpeckle: 10,
          },
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("starts with default values when get_settings fails", async () => {
      mockIPC((cmd) => {
        if (cmd === "get_settings") {
          return Promise.reject(new Error("Config read error"));
        }
        if (cmd === "get_param_spec") {
          return TEST_SPEC;
        }
        return null;
      });

      render(<App />);

      expect(
        await screen.findByRole("tab", { name: "Single" }),
      ).toBeInTheDocument();
      const presetSelect = screen.getByLabelText("Preset");
      expect(presetSelect).toHaveValue("colorLogo");
    });

    it("switches language dynamically and invokes save_settings after 1000ms", () => {
      const savedPayloads: unknown[] = [];
      mockIPC((cmd, args) => {
        if (cmd === "save_settings") {
          savedPayloads.push(args);
          return null;
        }
        return null;
      });

      vi.useFakeTimers();
      try {
        render(<App initialSpec={TEST_SPEC} initialLanguage="ja" />);

        const langSelect = screen.getByLabelText("言語");
        fireEvent.change(langSelect, { target: { value: "en" } });

        expect(screen.getByRole("tab", { name: "Single" })).toBeInTheDocument();
        expect(
          screen.getByRole("button", { name: "About" }),
        ).toBeInTheDocument();

        act(() => {
          vi.advanceTimersByTime(SETTINGS_SAVE_DEBOUNCE_MS);
        });

        expect(savedPayloads).toHaveLength(1);
        expect(savedPayloads[0]).toEqual({
          language: "en",
          preset: "colorLogo",
          params: COLOR_LOGO_PARAMS,
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("opens About dialog, displays version, MIT license, and third party licenses (vtracer and tauri)", async () => {
      mockIPC((cmd) => {
        if (cmd === "get_about") {
          return { version: "0.1.0" };
        }
        return null;
      });

      render(<App initialSpec={TEST_SPEC} initialLanguage="ja" />);

      const aboutBtn = screen.getByRole("button", {
        name: "このアプリについて",
      });
      fireEvent.click(aboutBtn);

      const dialog = await screen.findByRole("dialog");
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(dialog).toHaveAttribute("aria-labelledby", "about-dialog-title");

      expect(await screen.findByText("バージョン 0.1.0")).toBeInTheDocument();

      expect(
        screen.getAllByText(/Permission is hereby granted/).length,
      ).toBeGreaterThan(0);
      expect(
        screen.getByText(/Copyright \(c\) 2026 w034ff/),
      ).toBeInTheDocument();

      // Third-party licenses should not be displayed before expanding
      expect(screen.queryByText(/vtracer/)).toBeNull();

      const toggleBtn = screen.getByRole("button", {
        name: "第三者ライセンスを表示",
      });
      expect(toggleBtn).toHaveAttribute("aria-expanded", "false");
      expect(toggleBtn).not.toHaveAttribute("aria-controls");

      fireEvent.click(toggleBtn);

      expect(toggleBtn).toHaveAttribute("aria-expanded", "true");
      expect(toggleBtn).toHaveAttribute(
        "aria-controls",
        "about-third-party-licenses",
      );
      expect(toggleBtn).toHaveTextContent("第三者ライセンスを隠す");

      await screen.findByText(/vtracer/);
      expect(screen.getAllByText(/vtracer/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/tauri/).length).toBeGreaterThan(0);
    });

    it("opens dialog on click and closes with Escape returning focus to button", async () => {
      mockIPC((cmd) => {
        if (cmd === "get_about") {
          return { version: "0.1.0" };
        }
        return null;
      });

      render(<App initialSpec={TEST_SPEC} initialLanguage="ja" />);

      const aboutBtn = screen.getByRole("button", {
        name: "このアプリについて",
      });
      expect(aboutBtn).toHaveAttribute("type", "button");

      aboutBtn.focus();
      expect(document.activeElement).toBe(aboutBtn);

      fireEvent.click(aboutBtn);

      const dialog = await screen.findByRole("dialog");
      expect(dialog).toBeInTheDocument();

      expect(dialog.contains(document.activeElement)).toBe(true);

      fireEvent.keyDown(window, { key: "Escape" });

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(aboutBtn);
    });

    it("does not re-fetch get_about or move focus on batch-progress event while About dialog is open", async () => {
      let aboutCallCount = 0;
      mockIPC(
        (cmd) => {
          if (cmd === "get_about") {
            aboutCallCount += 1;
            return { version: "0.1.0" };
          }
          return null;
        },
        { shouldMockEvents: true },
      );

      render(<App initialSpec={TEST_SPEC} initialLanguage="ja" />);

      const aboutBtn = screen.getByRole("button", {
        name: "このアプリについて",
      });
      fireEvent.click(aboutBtn);

      const dialog = await screen.findByRole("dialog");
      expect(dialog).toBeInTheDocument();

      const toggleBtn = screen.getByRole("button", {
        name: "第三者ライセンスを表示",
      });
      fireEvent.click(toggleBtn);
      await screen.findByText(/vtracer/);

      expect(aboutCallCount).toBe(1);

      // Focus an element inside the dialog other than close button
      const summaries = document.querySelectorAll("summary");
      expect(summaries.length).toBeGreaterThan(0);
      summaries[0].focus();
      expect(document.activeElement).toBe(summaries[0]);

      // Emit batch-progress event while dialog is open
      const { emit } = await import("@tauri-apps/api/event");
      await act(async () => {
        await emit("batch-progress", {
          done: 1,
          total: 2,
          current: "file.png",
        });
      });

      // Verify get_about was not called again and focus did not move back to close button
      expect(aboutCallCount).toBe(1);
      expect(document.activeElement).toBe(summaries[0]);
    });

    it("preserves null language on param change when settings had null language, and sends explicit language after user selection", async () => {
      const savedPayloads: unknown[] = [];
      mockIPC((cmd, args) => {
        if (cmd === "get_settings") {
          return {
            language: null, // OS default
            preset: "colorLogo",
            params: COLOR_LOGO_PARAMS,
            batchInput: null,
            batchOutput: null,
          };
        }
        if (cmd === "get_param_spec") {
          return TEST_SPEC;
        }
        if (cmd === "save_settings") {
          savedPayloads.push(args);
          return null;
        }
        return null;
      });

      vi.useFakeTimers();
      try {
        render(<App />);

        // Wait for ready state
        await act(async () => {
          await Promise.resolve();
        });

        // Change slider without touching language
        const slider = screen.getByLabelText(/色の精度|Color precision/);
        fireEvent.change(slider, { target: { value: "8" } });

        act(() => {
          vi.advanceTimersByTime(SETTINGS_SAVE_DEBOUNCE_MS);
        });

        expect(savedPayloads).toHaveLength(1);
        expect(savedPayloads[0]).toEqual({
          language: null,
          preset: null,
          params: { ...COLOR_LOGO_PARAMS, colorPrecision: 8 },
        });

        // Now user selects an explicit language in the select box
        const langSelect = screen.getByLabelText(/言語|Language/);
        if (!(langSelect instanceof HTMLSelectElement)) {
          throw new Error("langSelect is not an HTMLSelectElement");
        }
        const targetLang = langSelect.value === "en" ? "ja" : "en";
        fireEvent.change(langSelect, { target: { value: targetLang } });

        act(() => {
          vi.advanceTimersByTime(SETTINGS_SAVE_DEBOUNCE_MS);
        });

        expect(savedPayloads).toHaveLength(2);
        expect(savedPayloads[1]).toEqual({
          language: targetLang,
          preset: null,
          params: { ...COLOR_LOGO_PARAMS, colorPrecision: 8 },
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("marks background app-shell as inert and traps focus while About dialog is open", async () => {
      mockIPC((cmd) => {
        if (cmd === "get_about") {
          return { version: "0.1.0" };
        }
        return null;
      });

      render(<App initialSpec={TEST_SPEC} initialLanguage="ja" />);

      const appShell = document.querySelector(".app-shell");
      expect(appShell).not.toHaveAttribute("inert");

      const aboutBtn = screen.getByRole("button", {
        name: "このアプリについて",
      });
      fireEvent.click(aboutBtn);

      const dialog = await screen.findByRole("dialog");
      expect(dialog).toBeInTheDocument();

      // Background app-shell must have inert attribute to prevent focusing or interaction
      expect(appShell).toHaveAttribute("inert");

      // Focus is trapped inside the dialog
      const closeBtns = screen.getAllByRole("button", { name: "閉じる" });
      const topCloseBtn = closeBtns[0];
      const bottomCloseBtn = closeBtns[closeBtns.length - 1];
      expect(document.activeElement).toBe(topCloseBtn);

      // Shift+Tab from closeBtn wraps to the last focusable element inside the dialog
      fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
      expect(document.activeElement).toBe(bottomCloseBtn);

      // Tab from the last element wraps back to the first focusable element (close button)
      fireEvent.keyDown(window, { key: "Tab" });
      expect(document.activeElement).toBe(topCloseBtn);

      // Close dialog: inert removed from app-shell
      fireEvent.keyDown(window, { key: "Escape" });
      expect(appShell).not.toHaveAttribute("inert");
    });
  });
});

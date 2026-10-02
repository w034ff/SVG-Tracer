import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App";
import type { ParamSpec, TraceParams } from "./ipc";

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
  presets: [{ id: "colorLogo", params: COLOR_LOGO_PARAMS }],
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
    expect(screen.getByText("Filter speckle")).toBeInTheDocument();
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
});

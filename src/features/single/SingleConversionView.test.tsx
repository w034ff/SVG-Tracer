import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ConvertResult,
  IpcError,
  ParamSpec,
  PickedImage,
  TraceParams,
} from "../../ipc";
import {
  LanguageProvider,
  ParamsProvider,
  SingleConversionProvider,
  useParams,
} from "../../state";
import { SingleConversionView } from "./SingleConversionView";

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

const SAMPLE_IMAGE: PickedImage = {
  id: "img-handle-1",
  name: "logo_color.png",
};

const SAMPLE_RESULT: ConvertResult = {
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>',
  pathCount: 38,
  bytes: 12697, // ~12.4 KB
  elapsedMs: 420, // ~0.42 s
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function renderSingleView(options?: {
  language?: "ja" | "en";
  initialImage?: PickedImage;
}) {
  return render(
    <LanguageProvider initialLanguage={options?.language ?? "ja"}>
      <ParamsProvider initialSpec={TEST_SPEC}>
        <SingleConversionProvider
          initialState={
            options?.initialImage
              ? {
                  status: "loading_preview",
                  image: options.initialImage,
                  previewUrl: null,
                  imageDimensions: null,
                  svg: null,
                  svgUrl: null,
                  result: null,
                  error: null,
                  zoom: 1.0,
                  pan: { x: 0, y: 0 },
                }
              : undefined
          }
        >
          <SingleConversionView />
        </SingleConversionProvider>
      </ParamsProvider>
    </LanguageProvider>,
  );
}

describe("SingleConversionView", () => {
  beforeEach(() => {
    mockIPC((cmd) => {
      if (cmd === "load_preview") {
        return new Uint8Array([137, 80, 78, 71]).buffer;
      }
      if (cmd === "convert") {
        return SAMPLE_RESULT;
      }
      if (cmd === "save_svg") {
        return { savedName: "logo_color.svg" };
      }
      return null;
    });
  });

  afterEach(() => {
    clearMocks();
  });

  describe("Empty state (no image selected)", () => {
    it("renders drop area and disabled save button", () => {
      renderSingleView();

      expect(screen.getByText("画像をここにドロップ")).toBeInTheDocument();
      expect(
        screen.getByText("PNG / JPEG / WebP / BMP / GIF に対応"),
      ).toBeInTheDocument();
      expect(screen.getByText("画像が選択されていません")).toBeInTheDocument();

      const saveButtons = screen.getAllByRole("button", {
        name: "SVG を保存",
      });
      expect(saveButtons).toHaveLength(1);
      const saveBtn = saveButtons[0];
      if (!saveBtn) {
        throw new Error("Save button not found");
      }
      expect(saveBtn).toBeDisabled();
    });

    it("triggers pick_image on Open Image button click", async () => {
      let pickCalled = false;
      mockIPC((cmd) => {
        if (cmd === "pick_image") {
          pickCalled = true;
          return SAMPLE_IMAGE;
        }
        if (cmd === "load_preview") {
          return new Uint8Array([137, 80, 78, 71]).buffer;
        }
        if (cmd === "convert") {
          return SAMPLE_RESULT;
        }
        return null;
      });

      renderSingleView();

      const openButton = screen.getByRole("button", { name: "画像を開く" });
      fireEvent.click(openButton);

      await waitFor(() => {
        expect(pickCalled).toBe(true);
      });

      await waitFor(() => {
        expect(screen.getByText("logo_color.png")).toBeInTheDocument();
      });
    });
  });

  describe("Active conversion state", () => {
    it("loads preview, performs vector conversion, and displays results using <img> tags", async () => {
      renderSingleView({ initialImage: SAMPLE_IMAGE });

      // Filename should be visible in toolbar
      await waitFor(() => {
        expect(screen.getByText("logo_color.png")).toBeInTheDocument();
      });

      // Preview pane headers
      expect(screen.getByText("元画像")).toBeInTheDocument();
      expect(screen.getByText("SVG")).toBeInTheDocument();

      // Ensure both images are rendered as <img> elements with blob: URLs (never innerHTML)
      await waitFor(() => {
        const originalImg = screen.getByAltText("元画像のプレビュー");
        expect(originalImg).toBeInstanceOf(HTMLImageElement);
        expect(originalImg.getAttribute("src")).toMatch(/^blob:/);

        const svgImg = screen.getByAltText("SVG のプレビュー");
        expect(svgImg).toBeInstanceOf(HTMLImageElement);
        expect(svgImg.getAttribute("src")).toMatch(/^blob:/);
      });

      // Ensure no raw svg or innerHTML injection is inside the view
      const singleViewContainer = document.querySelector(".single-view");
      if (!singleViewContainer) {
        throw new Error(".single-view element not found");
      }
      // Directly check there is no raw SVG inside .preview-content other than through <img>
      const svgElements = singleViewContainer.querySelectorAll(
        ".preview-content svg",
      );
      expect(svgElements).toHaveLength(0);

      // Verify formatted statistics in footer
      await waitFor(() => {
        expect(screen.getByText("38")).toBeInTheDocument();
        expect(screen.getByText("12.4 KB")).toBeInTheDocument();
        expect(screen.getByText("0.42 秒")).toBeInTheDocument();
      });

      // SVG save button should become enabled
      const saveBtn = screen.getByRole("button", { name: "SVG を保存" });
      expect(saveBtn).not.toBeDisabled();
    });

    it("calls save_svg when save button is clicked", async () => {
      let saveCalledWithId: string | null = null;
      mockIPC((cmd, args) => {
        if (cmd === "load_preview") {
          return new Uint8Array([137, 80, 78, 71]).buffer;
        }
        if (cmd === "convert") {
          return SAMPLE_RESULT;
        }
        if (cmd === "save_svg") {
          if (isRecord(args) && typeof args["id"] === "string") {
            saveCalledWithId = args["id"];
          }
          return { savedName: "logo_color.svg" };
        }
        return null;
      });

      renderSingleView({ initialImage: SAMPLE_IMAGE });

      const saveBtn = await screen.findByRole("button", { name: "SVG を保存" });
      await waitFor(() => {
        expect(saveBtn).not.toBeDisabled();
      });

      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(saveCalledWithId).toBe("img-handle-1");
      });
    });
  });

  describe("Debounce and seq handling", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("debounces rapid parameter modifications within 300ms and calls convert once", async () => {
      const convertCalls: Array<{
        params: Record<string, unknown>;
        seq: number;
      }> = [];

      mockIPC((cmd, args) => {
        if (cmd === "load_preview") {
          return new Uint8Array([137, 80, 78, 71]).buffer;
        }
        if (cmd === "convert") {
          if (
            isRecord(args) &&
            typeof args["seq"] === "number" &&
            isRecord(args["params"])
          ) {
            convertCalls.push({
              params: args["params"],
              seq: args["seq"],
            });
          }
          return SAMPLE_RESULT;
        }
        return null;
      });

      // Component that triggers param change
      function TestParamModifier() {
        const { dispatch } = useParams();
        return (
          <div>
            <SingleConversionView />
            <button
              type="button"
              data-testid="mod-1"
              onClick={() => {
                dispatch({
                  type: "SET_PARAM",
                  key: "colorPrecision",
                  value: 7,
                });
              }}
            >
              Mod 1
            </button>
            <button
              type="button"
              data-testid="mod-2"
              onClick={() => {
                dispatch({
                  type: "SET_PARAM",
                  key: "colorPrecision",
                  value: 8,
                });
              }}
            >
              Mod 2
            </button>
          </div>
        );
      }

      render(
        <LanguageProvider initialLanguage="ja">
          <ParamsProvider initialSpec={TEST_SPEC}>
            <SingleConversionProvider
              initialState={{
                status: "ready",
                image: SAMPLE_IMAGE,
                previewUrl: "blob:mock-png",
                imageDimensions: { width: 100, height: 100 },
                svg: SAMPLE_RESULT.svg,
                svgUrl: "blob:mock-svg",
                result: SAMPLE_RESULT,
                error: null,
                zoom: 1.0,
                pan: { x: 0, y: 0 },
              }}
            >
              <TestParamModifier />
            </SingleConversionProvider>
          </ParamsProvider>
        </LanguageProvider>,
      );

      // Fast successive modifications
      act(() => {
        fireEvent.click(screen.getByTestId("mod-1"));
      });
      act(() => {
        vi.advanceTimersByTime(100);
      });
      act(() => {
        fireEvent.click(screen.getByTestId("mod-2"));
      });
      act(() => {
        vi.advanceTimersByTime(200);
      });

      // At 200ms after mod-2 (300ms after mod-1), convert should NOT have fired for mod-2 yet
      expect(convertCalls).toHaveLength(0);

      // Advance remaining 100ms (total 300ms since mod-2)
      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      expect(convertCalls).toHaveLength(1);
      const call = convertCalls[0];
      if (!call) {
        throw new Error("Expected convert call");
      }
      expect(call.params["colorPrecision"]).toBe(8);
      expect(call.seq).toBe(1);
    });

    it("discards responses with older seq numbers and does not display Superseded errors", async () => {
      let pendingSeq1Resolve: ((res: ConvertResult) => void) | null = null;

      mockIPC((cmd, args) => {
        if (cmd === "load_preview") {
          return new Uint8Array([137, 80, 78, 71]).buffer;
        }
        if (cmd === "convert") {
          if (isRecord(args) && args["seq"] === 1) {
            return new Promise<ConvertResult>((resolve) => {
              pendingSeq1Resolve = resolve;
            });
          }
          if (isRecord(args) && args["seq"] === 2) {
            // Newer request succeeds with 45 paths
            return Promise.resolve({
              ...SAMPLE_RESULT,
              pathCount: 45,
            });
          }
        }
        return null;
      });

      function TestSeqTrigger() {
        const { dispatch } = useParams();
        return (
          <div>
            <SingleConversionView />
            <button
              type="button"
              data-testid="btn-seq-2"
              onClick={() => {
                dispatch({
                  type: "SET_PARAM",
                  key: "filterSpeckle",
                  value: 10,
                });
              }}
            >
              Seq 2
            </button>
          </div>
        );
      }

      render(
        <LanguageProvider initialLanguage="ja">
          <ParamsProvider initialSpec={TEST_SPEC}>
            <SingleConversionProvider
              initialState={{
                status: "ready",
                image: SAMPLE_IMAGE,
                previewUrl: "blob:mock-png",
                imageDimensions: { width: 100, height: 100 },
                svg: SAMPLE_RESULT.svg,
                svgUrl: "blob:mock-svg",
                result: SAMPLE_RESULT,
                error: null,
                zoom: 1.0,
                pan: { x: 0, y: 0 },
              }}
            >
              <TestSeqTrigger />
            </SingleConversionProvider>
          </ParamsProvider>
        </LanguageProvider>,
      );

      // Trigger first conversion
      act(() => {
        vi.advanceTimersByTime(300);
      });

      // Trigger second conversion while seq 1 is pending
      act(() => {
        fireEvent.click(screen.getByTestId("btn-seq-2"));
      });
      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      // Seq 2 resolves first
      expect(screen.getByText("45")).toBeInTheDocument();

      // Now Seq 1 finishes late with pathCount 999
      await act(async () => {
        if (pendingSeq1Resolve) {
          pendingSeq1Resolve({
            ...SAMPLE_RESULT,
            pathCount: 999,
          });
        }
      });

      // Stale Seq 1 response must be discarded; pathCount remains 45
      expect(screen.getByText("45")).toBeInTheDocument();
      expect(screen.queryByText("999")).not.toBeInTheDocument();
    });

    it("silently ignores Superseded errors and does not show error banner", async () => {
      mockIPC((cmd) => {
        if (cmd === "load_preview") {
          return new Uint8Array([137, 80, 78, 71]).buffer;
        }
        if (cmd === "convert") {
          const supersededError: IpcError = {
            code: "Superseded",
            detail: null,
          };
          return Promise.reject(supersededError);
        }
        return null;
      });

      renderSingleView({ initialImage: SAMPLE_IMAGE });

      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      // Error banner must not appear for Superseded
      expect(document.querySelector(".error-banner")).not.toBeInTheDocument();
    });
  });

  describe("Error code mapping and detail display", () => {
    const errorCases: Array<{
      code: IpcError["code"];
      detail: string | null;
      expectedJa: string;
      expectedEn: string;
    }> = [
      {
        code: "UnsupportedFormat",
        detail: null,
        expectedJa: "非対応の画像形式です",
        expectedEn: "Unsupported image format",
      },
      {
        code: "DecodeFailed",
        detail: "broken chunk",
        expectedJa: "画像のデコードに失敗しました: broken chunk",
        expectedEn: "Failed to decode image: broken chunk",
      },
      {
        code: "TooLarge",
        detail: null,
        expectedJa: "画像サイズが上限を超過しています",
        expectedEn: "Image exceeds maximum allowed dimensions",
      },
      {
        code: "ReadFailed",
        detail: "access denied",
        expectedJa: "ファイルの読み込みに失敗しました: access denied",
        expectedEn: "Failed to read file: access denied",
      },
      {
        code: "WriteFailed",
        detail: "disk full",
        expectedJa: "ファイルの書き込みに失敗しました: disk full",
        expectedEn: "Failed to write file: disk full",
      },
      {
        code: "TraceFailed",
        detail: null,
        expectedJa: "ベクター変換に失敗しました",
        expectedEn: "Vector tracing failed",
      },
      {
        code: "UnknownHandle",
        detail: null,
        expectedJa: "画像ハンドルが見つかりません",
        expectedEn: "Image handle not found",
      },
      {
        code: "InvalidParams",
        detail: "out of range",
        expectedJa: "無効なパラメータです: out of range",
        expectedEn: "Invalid parameters: out of range",
      },
    ];

    for (const ec of errorCases) {
      it(`displays localized message for ${ec.code} (with detail: ${ec.detail ?? "none"})`, async () => {
        mockIPC((cmd) => {
          if (cmd === "load_preview") {
            return new Uint8Array([137, 80, 78, 71]).buffer;
          }
          if (cmd === "convert") {
            const err: IpcError = { code: ec.code, detail: ec.detail };
            return Promise.reject(err);
          }
          return null;
        });

        // Test Japanese
        const { unmount } = renderSingleView({
          language: "ja",
          initialImage: SAMPLE_IMAGE,
        });

        await waitFor(() => {
          const banner = document.querySelector(".error-banner");
          expect(banner).toBeInTheDocument();
          expect(banner?.textContent).toContain(ec.expectedJa);
        });

        unmount();

        // Test English
        renderSingleView({ language: "en", initialImage: SAMPLE_IMAGE });

        await waitFor(() => {
          const banner = document.querySelector(".error-banner");
          expect(banner).toBeInTheDocument();
          expect(banner?.textContent).toContain(ec.expectedEn);
        });
      });
    }
  });

  describe("Zoom and Pan controls", () => {
    it("zooms in and out with buttons and clamps between 10% and 1600%", async () => {
      renderSingleView({ initialImage: SAMPLE_IMAGE });

      const zoomInBtn = await screen.findByRole("button", { name: "拡大" });
      const zoomOutBtn = screen.getByRole("button", { name: "縮小" });
      const zoom100Btn = screen.getByRole("button", { name: "100%" });

      expect(
        screen.getByText("100%", { selector: "span" }),
      ).toBeInTheDocument();

      // Zoom in: 100% -> 125%
      fireEvent.click(zoomInBtn);
      expect(screen.getByText("125%")).toBeInTheDocument();

      // Zoom in again: 125% -> 156%
      fireEvent.click(zoomInBtn);
      expect(screen.getByText("156%")).toBeInTheDocument();

      // Zoom in to exceed 200% threshold: 156% -> 195% -> 244%
      fireEvent.click(zoomInBtn);
      fireEvent.click(zoomInBtn);
      expect(screen.getByText("244%")).toBeInTheDocument();

      // At >= 200%, original image should have imageRendering: pixelated
      const origImg = screen.getByAltText("元画像のプレビュー");
      expect(origImg).toHaveStyle({ imageRendering: "pixelated" });

      // Click 100% button to reset
      fireEvent.click(zoom100Btn);
      expect(
        screen.getByText("100%", { selector: "span" }),
      ).toBeInTheDocument();
      expect(origImg).toHaveStyle({ imageRendering: "auto" });

      // Zoom out repeatedly to reach minimum 10%
      for (let i = 0; i < 15; i += 1) {
        fireEvent.click(zoomOutBtn);
      }
      expect(screen.getByText("10%")).toBeInTheDocument();
      expect(zoomOutBtn).toBeDisabled();
    });
  });
});

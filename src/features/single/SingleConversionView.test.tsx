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

const SAMPLE_IMAGE_A: PickedImage = {
  id: "img-handle-a",
  name: "logo_color.png",
};

const SAMPLE_IMAGE_B: PickedImage = {
  id: "img-handle-b",
  name: "icon_mono.png",
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

function renderSingleView(options?: { language?: "ja" | "en" }) {
  return render(
    <LanguageProvider initialLanguage={options?.language ?? "ja"}>
      <ParamsProvider initialSpec={TEST_SPEC}>
        <SingleConversionProvider>
          <SingleConversionView />
        </SingleConversionProvider>
      </ParamsProvider>
    </LanguageProvider>,
  );
}

describe("SingleConversionView", () => {
  beforeEach(() => {
    mockIPC(
      (cmd) => {
        if (cmd === "pick_image") {
          return SAMPLE_IMAGE_A;
        }
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
      },
      { shouldMockEvents: true },
    );
  });

  afterEach(() => {
    clearMocks();
    vi.restoreAllMocks();
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

    it("triggers pick_image on Open Image button click and transitions to active view", async () => {
      renderSingleView();

      const openButton = screen.getByRole("button", { name: "画像を開く" });
      fireEvent.click(openButton);

      await waitFor(() => {
        expect(screen.getByText("logo_color.png")).toBeInTheDocument();
      });
    });
  });

  describe("Active conversion state", () => {
    it("loads preview, performs vector conversion, and displays results using <img> tags", async () => {
      renderSingleView();

      // Open image from empty state
      fireEvent.click(screen.getByRole("button", { name: "画像を開く" }));

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

      // Ensure no raw svg or innerHTML injection is inside .preview-content
      const singleViewContainer = document.querySelector(".single-view");
      if (!singleViewContainer) {
        throw new Error(".single-view element not found");
      }
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
      mockIPC(
        (cmd, args) => {
          if (cmd === "pick_image") {
            return SAMPLE_IMAGE_A;
          }
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
        },
        { shouldMockEvents: true },
      );

      renderSingleView();

      fireEvent.click(screen.getByRole("button", { name: "画像を開く" }));

      await waitFor(() => {
        const btn = screen.getByRole("button", { name: "SVG を保存" });
        expect(btn).not.toBeDisabled();
      });

      const saveBtn = screen.getByRole("button", { name: "SVG を保存" });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(saveCalledWithId).toBe("img-handle-a");
      });
    });
  });

  describe("Ctrl + Wheel zoom after opening image", () => {
    it("zooms on Ctrl + Wheel and calls preventDefault on cancelable wheel event", async () => {
      renderSingleView();

      // Start from empty state, then open image
      fireEvent.click(screen.getByRole("button", { name: "画像を開く" }));

      await waitFor(() => {
        expect(screen.getByText("logo_color.png")).toBeInTheDocument();
      });

      expect(
        screen.getByText("100%", { selector: "span" }),
      ).toBeInTheDocument();

      const origImg = await screen.findByAltText("元画像のプレビュー");
      const viewport = origImg.closest(".preview-viewport");
      if (!viewport) {
        throw new Error("Viewport container not found");
      }

      // Dispatch cancelable wheel event with ctrlKey: true
      const wheelEvent = new WheelEvent("wheel", {
        ctrlKey: true,
        deltaY: -100,
        bubbles: true,
        cancelable: true,
      });

      act(() => {
        viewport.dispatchEvent(wheelEvent);
      });

      // Verify preventDefault was called
      expect(wheelEvent.defaultPrevented).toBe(true);

      // Zoom should have changed from 100% to 125%
      expect(
        await screen.findByText("125%", { selector: "span" }),
      ).toBeInTheDocument();
    });
  });

  describe("Blob URL revocation on image changes", () => {
    it("revokes previewUrl and svgUrl when changing images twice", async () => {
      let pickCount = 0;
      mockIPC(
        (cmd) => {
          if (cmd === "pick_image") {
            pickCount += 1;
            return {
              id: `handle-${pickCount}`,
              name: `image_${pickCount}.png`,
            };
          }
          if (cmd === "load_preview") {
            return new Uint8Array([137, 80, 78, 71]).buffer;
          }
          if (cmd === "convert") {
            return SAMPLE_RESULT;
          }
          return null;
        },
        { shouldMockEvents: true },
      );

      const revokedUrls: string[] = [];
      const createdUrls: string[] = [];

      const origCreate = window.URL.createObjectURL;
      const origRevoke = window.URL.revokeObjectURL;

      vi.spyOn(window.URL, "createObjectURL").mockImplementation(() => {
        const url = `blob:test-url-${createdUrls.length + 1}`;
        createdUrls.push(url);
        return url;
      });

      vi.spyOn(window.URL, "revokeObjectURL").mockImplementation((url) => {
        revokedUrls.push(url);
        origRevoke(url);
      });

      try {
        renderSingleView();

        // 1. Pick Image 1
        fireEvent.click(screen.getByRole("button", { name: "画像を開く" }));
        await waitFor(() => {
          expect(screen.getByText("image_1.png")).toBeInTheDocument();
        });
        await waitFor(() => {
          expect(createdUrls.length).toBeGreaterThanOrEqual(2); // preview and svg
        });

        const image1Preview = createdUrls[0];
        const image1Svg = createdUrls[1];

        // 2. Pick Image 2 (replaces Image 1)
        fireEvent.click(screen.getByRole("button", { name: "画像を開く" }));
        await waitFor(() => {
          expect(screen.getByText("image_2.png")).toBeInTheDocument();
        });

        // Image 1's URLs should have been revoked
        if (!image1Preview || !image1Svg) {
          throw new Error("Image 1 URLs not found");
        }
        await waitFor(() => {
          expect(revokedUrls).toContain(image1Preview);
          expect(revokedUrls).toContain(image1Svg);
        });

        await waitFor(() => {
          expect(createdUrls.length).toBeGreaterThanOrEqual(4); // preview and svg for Image 2
        });

        const image2Preview = createdUrls[2];
        const image2Svg = createdUrls[3];

        // 3. Pick Image 3 (replaces Image 2)
        fireEvent.click(screen.getByRole("button", { name: "画像を開く" }));
        await waitFor(() => {
          expect(screen.getByText("image_3.png")).toBeInTheDocument();
        });

        // Image 2's URLs should have been revoked
        if (!image2Preview || !image2Svg) {
          throw new Error("Image 2 URLs not found");
        }
        await waitFor(() => {
          expect(revokedUrls).toContain(image2Preview);
          expect(revokedUrls).toContain(image2Svg);
        });

        await waitFor(() => {
          expect(createdUrls.length).toBeGreaterThanOrEqual(6); // preview and svg for Image 3
        });
      } finally {
        window.URL.createObjectURL = origCreate;
        window.URL.revokeObjectURL = origRevoke;
      }
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

      mockIPC(
        (cmd, args) => {
          if (cmd === "pick_image") {
            return SAMPLE_IMAGE_A;
          }
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
        },
        { shouldMockEvents: true },
      );

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
            <SingleConversionProvider>
              <TestParamModifier />
            </SingleConversionProvider>
          </ParamsProvider>
        </LanguageProvider>,
      );

      // Open image from empty state
      fireEvent.click(screen.getByRole("button", { name: "画像を開く" }));
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByText("logo_color.png")).toBeInTheDocument();

      // Complete initial conversion
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
      convertCalls.length = 0; // Clear initial call

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

      // At 200ms after mod-2, convert should not have fired yet
      expect(convertCalls).toHaveLength(0);

      // Advance remaining 100ms
      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      expect(convertCalls).toHaveLength(1);
      const call = convertCalls[0];
      if (!call) {
        throw new Error("Expected convert call");
      }
      expect(call.params["colorPrecision"]).toBe(8);
    });

    it("discards responses with older seq numbers when parameters change on the same image", async () => {
      let convertCallCount = 0;
      let pendingCall2Resolve: ((res: ConvertResult) => void) | null = null;

      mockIPC(
        (cmd) => {
          if (cmd === "pick_image") {
            return SAMPLE_IMAGE_A;
          }
          if (cmd === "load_preview") {
            return new Uint8Array([137, 80, 78, 71]).buffer;
          }
          if (cmd === "convert") {
            convertCallCount += 1;
            if (convertCallCount === 1) {
              return Promise.resolve({
                ...SAMPLE_RESULT,
                pathCount: 10,
              });
            }
            if (convertCallCount === 2) {
              return new Promise<ConvertResult>((resolve) => {
                pendingCall2Resolve = resolve;
              });
            }
            if (convertCallCount === 3) {
              return Promise.resolve({
                ...SAMPLE_RESULT,
                pathCount: 45,
              });
            }
          }
          return null;
        },
        { shouldMockEvents: true },
      );

      function TestSeqModifier() {
        const { dispatch } = useParams();
        return (
          <div>
            <SingleConversionView />
            <button
              type="button"
              data-testid="seq-mod-1"
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
              data-testid="seq-mod-2"
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
            <SingleConversionProvider>
              <TestSeqModifier />
            </SingleConversionProvider>
          </ParamsProvider>
        </LanguageProvider>,
      );

      // Start from empty state, open Image A
      fireEvent.click(screen.getByRole("button", { name: "画像を開く" }));
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByText("logo_color.png")).toBeInTheDocument();

      // Complete initial conversion (seq 1)
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByText("10")).toBeInTheDocument();

      // Trigger parameter mod 1 (seq 2)
      act(() => {
        fireEvent.click(screen.getByTestId("seq-mod-1"));
      });
      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      // Trigger parameter mod 2 (seq 3) while seq 2 is still pending
      act(() => {
        fireEvent.click(screen.getByTestId("seq-mod-2"));
      });
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
      await act(async () => {
        await Promise.resolve();
      });

      // Seq 3 completes first and updates UI to 45
      expect(screen.getByText("45")).toBeInTheDocument();

      // Now Seq 2 completes late with pathCount 999
      await act(async () => {
        if (pendingCall2Resolve) {
          pendingCall2Resolve({
            ...SAMPLE_RESULT,
            pathCount: 999,
          });
        }
      });
      await act(async () => {
        await Promise.resolve();
      });

      // Older Seq 2 response must be discarded; UI still shows 45 and not 999
      expect(screen.getByText("45")).toBeInTheDocument();
      expect(screen.queryByText("999")).not.toBeInTheDocument();
    });

    it("does not display results of Image A when Image A conversion finishes while Image B is open", async () => {
      let pendingSeqAResolve: ((res: ConvertResult) => void) | null = null;
      let currentPickImage: PickedImage = SAMPLE_IMAGE_A;

      mockIPC(
        (cmd, args) => {
          if (cmd === "pick_image") {
            return currentPickImage;
          }
          if (cmd === "load_preview") {
            return new Uint8Array([137, 80, 78, 71]).buffer;
          }
          if (cmd === "convert") {
            if (isRecord(args) && args["id"] === "img-handle-a") {
              return new Promise<ConvertResult>((resolve) => {
                pendingSeqAResolve = resolve;
              });
            }
            if (isRecord(args) && args["id"] === "img-handle-b") {
              return Promise.resolve({
                ...SAMPLE_RESULT,
                pathCount: 50,
              });
            }
          }
          return null;
        },
        { shouldMockEvents: true },
      );

      renderSingleView();

      // Open Image A
      currentPickImage = SAMPLE_IMAGE_A;
      fireEvent.click(screen.getByRole("button", { name: "画像を開く" }));
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByText("logo_color.png")).toBeInTheDocument();

      // Trigger Image A convert
      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      // While Image A convert is pending, switch to Image B
      currentPickImage = SAMPLE_IMAGE_B;
      fireEvent.click(screen.getByRole("button", { name: "画像を開く" }));
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByText("icon_mono.png")).toBeInTheDocument();

      // Complete Image B debounce and conversion
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
      await act(async () => {
        await Promise.resolve();
      });

      // Image B should be active with pathCount 50
      expect(screen.getByText("50")).toBeInTheDocument();

      // Now Image A's conversion completes late with pathCount 999
      await act(async () => {
        if (pendingSeqAResolve) {
          pendingSeqAResolve({
            ...SAMPLE_RESULT,
            pathCount: 999,
          });
        }
      });
      await act(async () => {
        await Promise.resolve();
      });

      // Image A's late result must be discarded; screen must still show 50
      expect(screen.getByText("50")).toBeInTheDocument();
      expect(screen.queryByText("999")).not.toBeInTheDocument();
    });

    it("silently ignores Superseded errors and does not show error banner", async () => {
      mockIPC(
        (cmd) => {
          if (cmd === "pick_image") {
            return SAMPLE_IMAGE_A;
          }
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
        },
        { shouldMockEvents: true },
      );

      renderSingleView();

      fireEvent.click(screen.getByRole("button", { name: "画像を開く" }));

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
        mockIPC(
          (cmd) => {
            if (cmd === "pick_image") {
              return SAMPLE_IMAGE_A;
            }
            if (cmd === "load_preview") {
              return new Uint8Array([137, 80, 78, 71]).buffer;
            }
            if (cmd === "convert") {
              const err: IpcError = { code: ec.code, detail: ec.detail };
              return Promise.reject(err);
            }
            return null;
          },
          { shouldMockEvents: true },
        );

        // Test Japanese
        const { unmount } = renderSingleView({ language: "ja" });
        fireEvent.click(screen.getByRole("button", { name: "画像を開く" }));

        await waitFor(() => {
          const banner = document.querySelector(".error-banner");
          expect(banner).toBeInTheDocument();
          expect(banner?.textContent).toContain(ec.expectedJa);
        });

        unmount();

        // Test English
        renderSingleView({ language: "en" });
        fireEvent.click(screen.getByRole("button", { name: "Open image" }));

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
      renderSingleView();

      fireEvent.click(screen.getByRole("button", { name: "画像を開く" }));

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

    it("syncs dragging (pan) across both preview panes", async () => {
      renderSingleView();

      fireEvent.click(screen.getByRole("button", { name: "画像を開く" }));

      const origImg = await screen.findByAltText("元画像のプレビュー");
      const origViewport = origImg.closest(".preview-viewport");
      if (!origViewport) {
        throw new Error("Viewport not found");
      }

      // Drag from (100, 100) to (150, 130)
      fireEvent.pointerDown(origViewport, {
        button: 0,
        clientX: 100,
        clientY: 100,
        pointerId: 1,
      });

      fireEvent.pointerMove(origViewport, {
        clientX: 150,
        clientY: 130,
        pointerId: 1,
      });

      fireEvent.pointerUp(origViewport, {
        pointerId: 1,
      });

      // Both panes should now have transform: translate(50px, 30px)
      const previewContents = document.querySelectorAll(".preview-content");
      expect(previewContents).toHaveLength(2);
      previewContents.forEach((content) => {
        expect(content).toHaveStyle({
          transform: "translate(50px, 30px)",
        });
      });
    });

    it("fits preview zoom to viewport on Zoom Fit button click", async () => {
      renderSingleView();

      fireEvent.click(screen.getByRole("button", { name: "画像を開く" }));

      const origImg = await screen.findByAltText("元画像のプレビュー");
      const origViewport = origImg.closest(".preview-viewport");
      if (!origViewport) {
        throw new Error("Viewport not found");
      }

      // Mock viewport dimensions: 432 x 332
      Object.defineProperty(origViewport, "clientWidth", {
        value: 432,
        configurable: true,
      });
      Object.defineProperty(origViewport, "clientHeight", {
        value: 332,
        configurable: true,
      });

      // Trigger natural dimensions: 200 x 200
      Object.defineProperty(origImg, "naturalWidth", { value: 200 });
      Object.defineProperty(origImg, "naturalHeight", { value: 200 });
      fireEvent.load(origImg);

      // Fit calculation: (432 - 32) / 200 = 2.0, (332 - 32) / 200 = 1.5 -> min is 1.5 (150%)
      const fitBtn = screen.getByRole("button", { name: "全体表示" });
      fireEvent.click(fitBtn);

      expect(
        await screen.findByText("150%", { selector: "span" }),
      ).toBeInTheDocument();
    });

    it("adjusts pan proportionally when clicking zoom in (+) button after panning", async () => {
      renderSingleView();

      fireEvent.click(screen.getByRole("button", { name: "画像を開く" }));

      const origImg = await screen.findByAltText("元画像のプレビュー");
      const origViewport = origImg.closest(".preview-viewport");
      if (!origViewport) {
        throw new Error("Viewport not found");
      }

      // Drag to pan from (100, 100) to (140, 160) -> pan becomes { x: 40, y: 60 }
      fireEvent.pointerDown(origViewport, {
        button: 0,
        clientX: 100,
        clientY: 100,
        pointerId: 1,
      });
      fireEvent.pointerMove(origViewport, {
        clientX: 140,
        clientY: 160,
        pointerId: 1,
      });
      fireEvent.pointerUp(origViewport, {
        pointerId: 1,
      });

      const previewContentsBefore =
        document.querySelectorAll(".preview-content");
      expect(previewContentsBefore).toHaveLength(2);
      previewContentsBefore.forEach((content) => {
        expect(content).toHaveStyle({
          transform: "translate(40px, 60px)",
        });
      });

      // Click + button (zoom in): 100% -> 125%
      // Since p = 0 for button zoom: pan' = pan * (z' / z) = { 40 * 1.25, 60 * 1.25 } = { 50, 75 }
      const zoomInBtn = screen.getByRole("button", { name: "拡大" });
      fireEvent.click(zoomInBtn);

      expect(await screen.findByText("125%")).toBeInTheDocument();

      const previewContentsAfter =
        document.querySelectorAll(".preview-content");
      expect(previewContentsAfter).toHaveLength(2);
      previewContentsAfter.forEach((content) => {
        expect(content).toHaveStyle({
          transform: "translate(50px, 75px)",
        });
      });
    });

    it("adjusts pan according to anchor formula on Ctrl + Wheel when cursor is off pane center", async () => {
      renderSingleView();

      fireEvent.click(screen.getByRole("button", { name: "画像を開く" }));

      const origImg = await screen.findByAltText("元画像のプレビュー");
      const origViewport = origImg.closest(".preview-viewport");
      if (!origViewport) {
        throw new Error("Viewport not found");
      }

      // Mock getBoundingClientRect for the pane:
      // left: 100, top: 100, width: 400, height: 300
      // Center of pane: (100 + 400/2, 100 + 300/2) = (300, 250)
      vi.spyOn(origViewport, "getBoundingClientRect").mockReturnValue({
        left: 100,
        top: 100,
        width: 400,
        height: 300,
        right: 500,
        bottom: 400,
        x: 100,
        y: 100,
        toJSON: () => {},
      });

      // Cursor position: clientX = 380, clientY = 310
      // Relative cursor position to pane center:
      // p.x = 380 - 300 = 80
      // p.y = 310 - 250 = 60
      // Initial pan = { x: 0, y: 0 }, initial zoom = 1.0
      // Zoom factor = 1.25 (zoom in: deltaY = -100)
      // pan'.x = p.x - (p.x - pan.x) * (z' / z) = 80 - (80 - 0) * 1.25 = 80 - 100 = -20
      // pan'.y = p.y - (p.y - pan.y) * (z' / z) = 60 - (60 - 0) * 1.25 = 60 - 75 = -15
      const zoomInWheel = new WheelEvent("wheel", {
        ctrlKey: true,
        deltaY: -100,
        clientX: 380,
        clientY: 310,
        bubbles: true,
        cancelable: true,
      });

      act(() => {
        origViewport.dispatchEvent(zoomInWheel);
      });

      expect(
        await screen.findByText("125%", { selector: "span" }),
      ).toBeInTheDocument();

      const previewContents = document.querySelectorAll(".preview-content");
      expect(previewContents).toHaveLength(2);
      previewContents.forEach((content) => {
        expect(content).toHaveStyle({
          transform: "translate(-20px, -15px)",
        });
      });

      // Now zoom out with cursor at the same position:
      // Current pan = { x: -20, y: -15 }, current zoom = 1.25
      // Zoom factor = 1 / 1.25 = 0.8 (zoom out: deltaY = 100) -> new zoom = 1.0
      // pan'.x = 80 - (80 - (-20)) * 0.8 = 80 - 100 * 0.8 = 0
      // pan'.y = 60 - (60 - (-15)) * 0.8 = 60 - 75 * 0.8 = 0
      const zoomOutWheel = new WheelEvent("wheel", {
        ctrlKey: true,
        deltaY: 100,
        clientX: 380,
        clientY: 310,
        bubbles: true,
        cancelable: true,
      });

      act(() => {
        origViewport.dispatchEvent(zoomOutWheel);
      });

      expect(
        await screen.findByText("100%", { selector: "span" }),
      ).toBeInTheDocument();

      const previewContentsReverted =
        document.querySelectorAll(".preview-content");
      expect(previewContentsReverted).toHaveLength(2);
      previewContentsReverted.forEach((content) => {
        expect(content).toHaveStyle({
          transform: "translate(0px, 0px)",
        });
      });
    });
  });
});

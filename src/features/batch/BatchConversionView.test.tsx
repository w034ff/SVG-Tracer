import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../../App";
import type {
  BatchFinishedPayload,
  BatchItemPayload,
  BatchProgressPayload,
  ParamSpec,
  PickBatchInputResult,
  PickBatchOutputResult,
  TraceParams,
} from "../../ipc";

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

describe("BatchConversionView", () => {
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

  function setupAppOnBatchTab() {
    const rendered = render(
      <App initialSpec={TEST_SPEC} initialLanguage="ja" />,
    );
    const batchTab = screen.getByRole("tab", { name: "一括変換" });
    fireEvent.click(batchTab);
    return rendered;
  }

  it("selects input and output folders, displays dirLabel and counts, and enables start button", async () => {
    const mockInput: PickBatchInputResult = {
      dirLabel: "logos_input",
      targets: ["img1.png", "img2.jpg"],
      ignoredCount: 3,
    };
    const mockOutput: PickBatchOutputResult = {
      dirLabel: "svg_output",
    };

    mockIPC(
      (cmd) => {
        if (cmd === "pick_batch_input") {
          return mockInput;
        }
        if (cmd === "pick_batch_output") {
          return mockOutput;
        }
        return null;
      },
      { shouldMockEvents: true },
    );

    setupAppOnBatchTab();

    // Start button should be disabled initially
    const startBtn = screen.getByRole("button", { name: "変換を開始" });
    expect(startBtn).toBeDisabled();

    // Pick input folder
    const [pickInputBtn, pickOutputBtn] = screen.getAllByRole("button", {
      name: "フォルダを選択",
    });
    if (!pickInputBtn || !pickOutputBtn) {
      throw new Error("Folder select buttons not found");
    }

    await act(async () => {
      fireEvent.click(pickInputBtn);
    });

    expect(await screen.findByText("logos_input")).toBeInTheDocument();
    expect(
      screen.getByText("対象 2 件 · 対象外 3 件（非対応の形式・サブフォルダ）"),
    ).toBeInTheDocument();

    // Target files should be listed with wait status
    expect(screen.getByText("img1.png")).toBeInTheDocument();
    expect(screen.getByText("img2.jpg")).toBeInTheDocument();
    expect(screen.getAllByText("待機")).toHaveLength(2);

    // Pick output folder
    await act(async () => {
      fireEvent.click(pickOutputBtn);
    });

    expect(await screen.findByText("svg_output")).toBeInTheDocument();

    // Now start button should be enabled
    expect(startBtn).toBeEnabled();
  });

  it("updates progress and item status as events arrive, and displays failure reasons on finish", async () => {
    const { emit } = await import("@tauri-apps/api/event");

    const mockInput: PickBatchInputResult = {
      dirLabel: "input_folder",
      targets: ["file1.png", "file2.png"],
      ignoredCount: 0,
    };
    const mockOutput: PickBatchOutputResult = {
      dirLabel: "output_folder",
    };

    let startBatchCalled = false;
    mockIPC(
      (cmd) => {
        if (cmd === "pick_batch_input") {
          return mockInput;
        }
        if (cmd === "pick_batch_output") {
          return mockOutput;
        }
        if (cmd === "start_batch") {
          startBatchCalled = true;
          return null;
        }
        return null;
      },
      { shouldMockEvents: true },
    );

    setupAppOnBatchTab();

    const [pickInputBtn, pickOutputBtn] = screen.getAllByRole("button", {
      name: "フォルダを選択",
    });
    if (!pickInputBtn || !pickOutputBtn) {
      throw new Error("Folder select buttons not found");
    }

    await act(async () => {
      fireEvent.click(pickInputBtn);
      fireEvent.click(pickOutputBtn);
    });

    const startBtn = await screen.findByRole("button", {
      name: "変換を開始",
    });
    expect(startBtn).toBeEnabled();

    // Start conversion
    await act(async () => {
      fireEvent.click(startBtn);
    });
    expect(startBatchCalled).toBe(true);

    // Cancel button should appear and start button should be disabled
    const cancelBtn = screen.getByRole("button", { name: "キャンセル" });
    expect(cancelBtn).toBeEnabled();
    expect(screen.getByRole("button", { name: "変換を開始" })).toBeDisabled();

    // Emit batch-progress indicating file1 is converting
    const progress1: BatchProgressPayload = {
      done: 0,
      total: 2,
      current: "file1.png",
    };
    await act(async () => {
      await emit("batch-progress", progress1);
    });

    expect(screen.getByText("file1.png を変換中")).toBeInTheDocument();
    expect(screen.getByText("0 / 2")).toBeInTheDocument();
    expect(screen.getByText("変換中")).toBeInTheDocument();

    // Emit batch-item: file1 completed successfully
    const item1: BatchItemPayload = {
      name: "file1.png",
      status: "ok",
      outputName: "file1.svg",
      error: null,
    };
    await act(async () => {
      await emit("batch-item", item1);
    });

    expect(screen.getByText("file1.svg")).toBeInTheDocument();
    expect(screen.getByText("✓ 完了")).toBeInTheDocument();

    // Emit batch-progress: file2 is converting
    const progress2: BatchProgressPayload = {
      done: 1,
      total: 2,
      current: "file2.png",
    };
    await act(async () => {
      await emit("batch-progress", progress2);
    });
    expect(screen.getByText("1 / 2")).toBeInTheDocument();

    // Emit batch-item: file2 failed
    const item2: BatchItemPayload = {
      name: "file2.png",
      status: "failed",
      outputName: null,
      error: {
        code: "DecodeFailed",
        detail: "broken image stream",
      },
    };
    await act(async () => {
      await emit("batch-item", item2);
    });
    expect(screen.getByText("✕ 失敗")).toBeInTheDocument();

    // Emit batch-finished
    const finished: BatchFinishedPayload = {
      succeeded: 1,
      failed: 1,
      skipped: 0,
      cancelled: false,
    };
    await act(async () => {
      await emit("batch-finished", finished);
    });

    // Check completion summary (BatchDone)
    const statusSummary = await screen.findByRole("status");
    expect(statusSummary).toBeInTheDocument();
    expect(
      screen.getByText("変換が完了しました：成功 1 件 · 失敗 1 件"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("file2.png")).toHaveLength(2);
    expect(
      screen.getByText("画像のデコードに失敗しました: broken image stream"),
    ).toBeInTheDocument();
    expect(screen.getByText("完了")).toBeInTheDocument();
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
  });

  it("disables folder selection, start button, and ParamsPanel during batch conversion", async () => {
    mockIPC(
      (cmd) => {
        if (cmd === "pick_batch_input") {
          return {
            dirLabel: "in",
            targets: ["a.png"],
            ignoredCount: 0,
          };
        }
        if (cmd === "pick_batch_output") {
          return { dirLabel: "out" };
        }
        if (cmd === "start_batch") {
          return null;
        }
        return null;
      },
      { shouldMockEvents: true },
    );

    setupAppOnBatchTab();

    const [pickInputBtn, pickOutputBtn] = screen.getAllByRole("button", {
      name: "フォルダを選択",
    });
    if (!pickInputBtn || !pickOutputBtn) {
      throw new Error("Folder select buttons not found");
    }

    await act(async () => {
      fireEvent.click(pickInputBtn);
      fireEvent.click(pickOutputBtn);
    });

    const startBtn = await screen.findByRole("button", {
      name: "変換を開始",
    });
    await act(async () => {
      fireEvent.click(startBtn);
    });

    // Both folder picker buttons should now be disabled
    expect(pickInputBtn).toBeDisabled();
    expect(pickOutputBtn).toBeDisabled();

    // Start button should be disabled
    expect(screen.getByRole("button", { name: "変換を開始" })).toBeDisabled();

    // ParamsPanel should display notice and its controls should be disabled
    expect(
      screen.getByText("変換中は設定を変更できません"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("プリセット")).toBeDisabled();
    expect(screen.getByLabelText(/色の精度/)).toBeDisabled();
    expect(screen.getByLabelText(/ノイズ除去/)).toBeDisabled();
    expect(screen.getByLabelText(/角の判定/)).toBeDisabled();
  });

  it("disables cancel button and shows 'キャンセル中…' immediately upon clicking cancel", async () => {
    let cancelCalled = false;
    let resolveCancel: () => void = () => {};
    const cancelPromise = new Promise<void>((resolve) => {
      resolveCancel = resolve;
    });

    mockIPC(
      (cmd) => {
        if (cmd === "pick_batch_input") {
          return { dirLabel: "in", targets: ["a.png"], ignoredCount: 0 };
        }
        if (cmd === "pick_batch_output") {
          return { dirLabel: "out" };
        }
        if (cmd === "start_batch") {
          return null;
        }
        if (cmd === "cancel_batch") {
          cancelCalled = true;
          return cancelPromise;
        }
        return null;
      },
      { shouldMockEvents: true },
    );

    setupAppOnBatchTab();

    const [pickInputBtn, pickOutputBtn] = screen.getAllByRole("button", {
      name: "フォルダを選択",
    });
    if (!pickInputBtn || !pickOutputBtn) {
      throw new Error("Folder select buttons not found");
    }

    await act(async () => {
      fireEvent.click(pickInputBtn);
      fireEvent.click(pickOutputBtn);
    });

    const startBtn = await screen.findByRole("button", {
      name: "変換を開始",
    });
    await act(async () => {
      fireEvent.click(startBtn);
    });

    const cancelBtn = screen.getByRole("button", { name: "キャンセル" });
    expect(cancelBtn).toBeEnabled();

    // Click cancel - immediately disabled and changes text without waiting for cancel_batch
    act(() => {
      fireEvent.click(cancelBtn);
    });

    expect(cancelCalled).toBe(true);
    expect(
      screen.getByRole("button", { name: "キャンセル中…" }),
    ).toBeDisabled();

    // Resolve the cancel promise
    await act(async () => {
      resolveCancel();
    });
  });

  it("adds an unexpected batch-item to the table if not in initial targets", async () => {
    const { emit } = await import("@tauri-apps/api/event");

    mockIPC(
      (cmd) => {
        if (cmd === "pick_batch_input") {
          return {
            dirLabel: "in",
            targets: ["initial.png"],
            ignoredCount: 0,
          };
        }
        if (cmd === "pick_batch_output") {
          return { dirLabel: "out" };
        }
        if (cmd === "start_batch") {
          return null;
        }
        return null;
      },
      { shouldMockEvents: true },
    );

    setupAppOnBatchTab();

    const [pickInputBtn, pickOutputBtn] = screen.getAllByRole("button", {
      name: "フォルダを選択",
    });
    if (!pickInputBtn || !pickOutputBtn) {
      throw new Error("Folder select buttons not found");
    }

    await act(async () => {
      fireEvent.click(pickInputBtn);
      fireEvent.click(pickOutputBtn);
    });

    const startBtn = await screen.findByRole("button", {
      name: "変換を開始",
    });
    await act(async () => {
      fireEvent.click(startBtn);
    });

    expect(screen.queryByText("unexpected.png")).not.toBeInTheDocument();

    // Receive batch-item for unexpected.png
    await act(async () => {
      await emit("batch-item", {
        name: "unexpected.png",
        status: "ok",
        outputName: "unexpected.svg",
        error: null,
      });
    });

    expect(await screen.findByText("unexpected.png")).toBeInTheDocument();
    expect(screen.getByText("unexpected.svg")).toBeInTheDocument();
    expect(screen.getByText("✓ 完了")).toBeInTheDocument();
  });

  it("marks unprocessed items and displays cancelled summary when cancelled", async () => {
    const { emit } = await import("@tauri-apps/api/event");

    mockIPC(
      (cmd) => {
        if (cmd === "pick_batch_input") {
          return {
            dirLabel: "in",
            targets: ["done.png", "pending1.png", "pending2.png"],
            ignoredCount: 0,
          };
        }
        if (cmd === "pick_batch_output") {
          return { dirLabel: "out" };
        }
        if (cmd === "start_batch") {
          return null;
        }
        return null;
      },
      { shouldMockEvents: true },
    );

    setupAppOnBatchTab();

    const [pickInputBtn, pickOutputBtn] = screen.getAllByRole("button", {
      name: "フォルダを選択",
    });
    if (!pickInputBtn || !pickOutputBtn) {
      throw new Error("Folder select buttons not found");
    }

    await act(async () => {
      fireEvent.click(pickInputBtn);
      fireEvent.click(pickOutputBtn);
    });

    const startBtn = await screen.findByRole("button", {
      name: "変換を開始",
    });
    await act(async () => {
      fireEvent.click(startBtn);
    });

    // 1 item finished
    await act(async () => {
      await emit("batch-item", {
        name: "done.png",
        status: "ok",
        outputName: "done.svg",
        error: null,
      });
    });

    // Cancelled finish event
    await act(async () => {
      await emit("batch-finished", {
        succeeded: 1,
        failed: 0,
        skipped: 2,
        cancelled: true,
      });
    });

    // Summary should show cancellation message
    expect(
      await screen.findByText(
        "変換を中止しました：成功 1 件 · 失敗 0 件 · 未処理 2 件",
      ),
    ).toBeInTheDocument();

    // Remaining items should show '未処理'
    const unprocessedPills = screen.getAllByText("未処理");
    expect(unprocessedPills).toHaveLength(2);
  });

  it("restores idle state and displays error banner when start_batch fails", async () => {
    mockIPC(
      (cmd) => {
        if (cmd === "pick_batch_input") {
          return { dirLabel: "in", targets: ["a.png"], ignoredCount: 0 };
        }
        if (cmd === "pick_batch_output") {
          return { dirLabel: "out" };
        }
        if (cmd === "start_batch") {
          return Promise.reject({
            code: "UnknownHandle",
            detail: "input directory handle lost",
          });
        }
        return null;
      },
      { shouldMockEvents: true },
    );

    setupAppOnBatchTab();

    const [pickInputBtn, pickOutputBtn] = screen.getAllByRole("button", {
      name: "フォルダを選択",
    });
    if (!pickInputBtn || !pickOutputBtn) {
      throw new Error("Folder select buttons not found");
    }

    await act(async () => {
      fireEvent.click(pickInputBtn);
      fireEvent.click(pickOutputBtn);
    });

    const startBtn = await screen.findByRole("button", {
      name: "変換を開始",
    });
    await act(async () => {
      fireEvent.click(startBtn);
    });

    // Should return to idle: start button re-enabled, error banner displayed
    expect(startBtn).toBeEnabled();
    const alert = await screen.findByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(
      screen.getByText(
        "画像ハンドルが見つかりません: input directory handle lost",
      ),
    ).toBeInTheDocument();
  });

  it("reflects batch events that arrived while the batch tab was hidden", async () => {
    const { emit } = await import("@tauri-apps/api/event");

    mockIPC(
      (cmd) => {
        if (cmd === "pick_batch_input") {
          return { dirLabel: "in", targets: ["img.png"], ignoredCount: 0 };
        }
        if (cmd === "pick_batch_output") {
          return { dirLabel: "out" };
        }
        if (cmd === "start_batch") {
          return null;
        }
        return null;
      },
      { shouldMockEvents: true },
    );

    setupAppOnBatchTab();

    const [pickInputBtn, pickOutputBtn] = screen.getAllByRole("button", {
      name: "フォルダを選択",
    });
    if (!pickInputBtn || !pickOutputBtn) {
      throw new Error("Folder select buttons not found");
    }

    await act(async () => {
      fireEvent.click(pickInputBtn);
      fireEvent.click(pickOutputBtn);
    });

    const startBtn = await screen.findByRole("button", {
      name: "変換を開始",
    });
    await act(async () => {
      fireEvent.click(startBtn);
    });

    // Switch to single conversion tab
    const singleTab = screen.getByRole("tab", { name: "単体変換" });
    const batchTab = screen.getByRole("tab", { name: "一括変換" });
    fireEvent.click(singleTab);
    expect(singleTab).toHaveAttribute("aria-selected", "true");

    // Events arrive while single tab is active
    await act(async () => {
      await emit("batch-item", {
        name: "img.png",
        status: "ok",
        outputName: "img.svg",
        error: null,
      });
      await emit("batch-finished", {
        succeeded: 1,
        failed: 0,
        skipped: 0,
        cancelled: false,
      });
    });

    // Switch back to batch tab
    fireEvent.click(batchTab);
    expect(batchTab).toHaveAttribute("aria-selected", "true");

    // Finished status and converted item should be displayed
    expect(
      screen.getByText("変換が完了しました：成功 1 件 · 失敗 0 件"),
    ).toBeInTheDocument();
    expect(screen.getByText("img.svg")).toBeInTheDocument();
    expect(screen.getByText("✓ 完了")).toBeInTheDocument();
  });
});

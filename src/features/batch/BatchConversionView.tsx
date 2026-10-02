import type { ReactElement } from "react";
import { formatMessage, getIpcErrorMessage } from "../../i18n";
import {
  cancelBatch,
  normalizeIpcError,
  pickBatchInput,
  pickBatchOutput,
  startBatch,
} from "../../ipc";
import { useBatchConversion, useLanguage, useParams } from "../../state";
import type { BatchItemRowStatus } from "../../state/batchConversion";

export function BatchConversionView(): ReactElement {
  const { t } = useLanguage();
  const { state: paramsState } = useParams();
  const { state: batchState, dispatch: batchDispatch } = useBatchConversion();

  const isBusy =
    batchState.status === "running" || batchState.status === "cancelling";
  const isCancelling = batchState.status === "cancelling";

  const canStart =
    batchState.inputDir !== null &&
    batchState.outputDir !== null &&
    batchState.inputDir.targets.length > 0 &&
    !isBusy &&
    paramsState.params !== null;

  async function handlePickInput(): Promise<void> {
    if (isBusy) {
      return;
    }
    try {
      const result = await pickBatchInput();
      if (result) {
        batchDispatch({ type: "SET_INPUT_DIR", inputDir: result });
      }
    } catch (err: unknown) {
      const ipcError = normalizeIpcError(err);
      batchDispatch({ type: "SET_ERROR", error: ipcError });
    }
  }

  async function handlePickOutput(): Promise<void> {
    if (isBusy) {
      return;
    }
    try {
      const result = await pickBatchOutput();
      if (result) {
        batchDispatch({ type: "SET_OUTPUT_DIR", outputDir: result });
      }
    } catch (err: unknown) {
      const ipcError = normalizeIpcError(err);
      batchDispatch({ type: "SET_ERROR", error: ipcError });
    }
  }

  async function handleStart(): Promise<void> {
    if (!canStart || !paramsState.params) {
      return;
    }
    // Set status to "running" before invoking start_batch per requirements
    batchDispatch({ type: "START_BATCH" });
    try {
      await startBatch(paramsState.params);
    } catch (err: unknown) {
      const ipcError = normalizeIpcError(err);
      batchDispatch({ type: "START_BATCH_FAILED", error: ipcError });
    }
  }

  async function handleCancel(): Promise<void> {
    // Set status to "cancelling" immediately without awaiting per requirements
    batchDispatch({ type: "CANCEL_BATCH" });
    try {
      await cancelBatch();
    } catch {
      // Ignore cancellation failure if batch is already finished
    }
  }

  const total = batchState.progress
    ? batchState.progress.total
    : batchState.inputDir
      ? batchState.inputDir.targets.length
      : 0;

  const done = batchState.progress
    ? batchState.progress.done
    : batchState.finished
      ? batchState.finished.succeeded + batchState.finished.failed
      : 0;

  const percent =
    total > 0 ? Math.min(100, Math.max(0, (done / total) * 100)) : 0;

  const runningItems = batchState.items.filter(
    (item) => item.status === "running",
  );

  let progressStatusText = "";
  if (isBusy) {
    if (runningItems.length > 1) {
      const primary = runningItems[0];
      progressStatusText = primary
        ? formatMessage(t.batchProgressConverting, {
            name: primary.name,
            count: runningItems.length - 1,
          })
        : t.batchStatusRunning;
    } else if (runningItems.length === 1) {
      const primary = runningItems[0];
      progressStatusText = primary
        ? formatMessage(t.batchProgressConvertingSingle, {
            name: primary.name,
          })
        : t.batchStatusRunning;
    } else if (batchState.progress?.current) {
      progressStatusText = formatMessage(t.batchProgressConvertingSingle, {
        name: batchState.progress.current,
      });
    } else {
      progressStatusText = t.batchStatusRunning;
    }
  } else if (batchState.status === "finished") {
    if (batchState.finished?.cancelled) {
      progressStatusText = t.batchProgressCancelled;
    } else {
      progressStatusText = t.batchProgressComplete;
    }
  }

  function renderStatusPill(status: BatchItemRowStatus): ReactElement {
    switch (status) {
      case "ok":
        return <span className="pill pill-ok">{t.batchStatusOk}</span>;
      case "failed":
        return <span className="pill pill-ng">{t.batchStatusNg}</span>;
      case "running":
        return <span className="pill pill-run">{t.batchStatusRunning}</span>;
      case "wait":
        return <span className="pill pill-wait">{t.batchStatusWait}</span>;
      case "unprocessed":
        return (
          <span className="pill pill-wait">{t.batchStatusUnprocessed}</span>
        );
    }
  }

  const failedItems = batchState.items.filter(
    (item) => item.status === "failed",
  );

  return (
    <div className="batch-view">
      <div className="batch-content">
        {/* Folder selection box */}
        <div className="batch-folders">
          <div className="batch-folder-row">
            <span className="batch-folder-label">{t.batchInputFolder}</span>
            <span className="batch-path">
              {batchState.inputDir
                ? batchState.inputDir.dirLabel
                : t.noFolderSelected}
            </span>
            <button
              type="button"
              className="btn"
              disabled={isBusy}
              onClick={handlePickInput}
            >
              {t.selectFolder}
            </button>
          </div>
          {batchState.inputDir && (
            <div className="batch-folder-summary">
              {formatMessage(t.batchInputSummary, {
                count: batchState.inputDir.targets.length,
                ignored: batchState.inputDir.ignoredCount,
              })}
            </div>
          )}
          <div className="batch-folder-row">
            <span className="batch-folder-label">{t.batchOutputFolder}</span>
            <span className="batch-path">
              {batchState.outputDir
                ? batchState.outputDir.dirLabel
                : t.noFolderSelected}
            </span>
            <button
              type="button"
              className="btn"
              disabled={isBusy}
              onClick={handlePickOutput}
            >
              {t.selectFolder}
            </button>
          </div>
        </div>

        {/* Error banner if start_batch failed */}
        {batchState.error && (
          <div role="alert" className="error-banner">
            <span>{getIpcErrorMessage(batchState.error, t)}</span>
          </div>
        )}

        {/* Finished summary banner */}
        {batchState.status === "finished" && batchState.finished && (
          <div role="status" className="batch-summary">
            <div className="batch-summary-title">
              {batchState.finished.cancelled
                ? formatMessage(t.batchSummaryCancelled, {
                    succeeded: batchState.finished.succeeded,
                    failed: batchState.finished.failed,
                    skipped: batchState.finished.skipped,
                  })
                : formatMessage(t.batchSummaryCompleted, {
                    succeeded: batchState.finished.succeeded,
                    failed: batchState.finished.failed,
                  })}
            </div>
            {failedItems.map((item) => (
              <div key={item.name} className="batch-failure-item">
                <span className="batch-failure-name">{item.name}</span>
                <span className="batch-failure-reason">
                  {item.error ? getIpcErrorMessage(item.error, t) : ""}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Item table */}
        <div className="batch-table-container">
          <div className="batch-row batch-table-header">
            <span>{t.batchTableHeaderName}</span>
            <span>{t.batchTableHeaderOutput}</span>
            <span>{t.batchTableHeaderStatus}</span>
          </div>
          <div className="batch-table-body">
            {batchState.items.map((item) => (
              <div key={item.name} className="batch-row">
                <span className="batch-cell-name">{item.name}</span>
                <span className="batch-cell-output val">
                  {item.outputName ?? "—"}
                </span>
                <span>{renderStatusPill(item.status)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Progress section */}
        <div className="batch-progress-section">
          <div className="batch-progress-text">
            <span>{progressStatusText}</span>
            <span className="val">{`${done} / ${total}`}</span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={done}
            aria-label={t.batchProgressBarAria}
            className="batch-progressbar"
          >
            <div
              className="batch-progressbar-fill"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="batch-footer">
        <span className="batch-notice">{t.batchNoticeSameName}</span>
        <div className="app-spacer" />
        {isBusy && (
          <button
            type="button"
            className="btn"
            disabled={isCancelling}
            onClick={handleCancel}
          >
            {isCancelling ? t.batchCancelling : t.batchCancel}
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canStart}
          onClick={handleStart}
        >
          {t.batchStart}
        </button>
      </footer>
    </div>
  );
}

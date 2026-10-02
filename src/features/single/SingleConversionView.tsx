import { useCallback, useEffect, useRef, type ReactElement } from "react";
import { getIpcErrorMessage } from "../../i18n";
import {
  convert,
  loadPreview,
  normalizeIpcError,
  pickImage,
  saveSvg,
} from "../../ipc";
import { useLanguage, useParams, useSingleConversion } from "../../state";
import {
  CONVERT_DEBOUNCE_MS,
  DEFAULT_ZOOM,
  FIT_PADDING,
  MAX_ZOOM,
  MIN_ZOOM,
  PIXELATED_ZOOM_THRESHOLD,
  ZOOM_STEP_FACTOR,
} from "./constants";
import { formatDuration, formatFileSize, getImageFormatLabel } from "./utils";

export function SingleConversionView(): ReactElement {
  const { t } = useLanguage();
  const { state: paramsState } = useParams();
  const { state, dispatch } = useSingleConversion();

  const seqRef = useRef<number>(0);
  const previewUrlRef = useRef<string | null>(null);
  const svgUrlRef = useRef<string | null>(null);
  const originalPaneRef = useRef<HTMLDivElement | null>(null);
  const svgPaneRef = useRef<HTMLDivElement | null>(null);

  // Keep track of latest blob URLs for cleanup
  useEffect(() => {
    previewUrlRef.current = state.previewUrl;
  }, [state.previewUrl]);

  useEffect(() => {
    svgUrlRef.current = state.svgUrl;
  }, [state.svgUrl]);

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
      if (svgUrlRef.current) {
        URL.revokeObjectURL(svgUrlRef.current);
      }
    };
  }, []);

  // Handle image loading (load_preview) when image changes
  useEffect(() => {
    const image = state.image;
    if (!image) {
      return;
    }

    let isCurrent = true;

    loadPreview(image.id)
      .then((bytes) => {
        if (!isCurrent) {
          return;
        }
        if (previewUrlRef.current) {
          URL.revokeObjectURL(previewUrlRef.current);
        }
        const blob = new Blob([bytes], { type: "image/png" });
        const url = URL.createObjectURL(blob);
        previewUrlRef.current = url;
        dispatch({ type: "SET_PREVIEW", previewUrl: url });
      })
      .catch((error: unknown) => {
        if (!isCurrent) {
          return;
        }
        const ipcError = normalizeIpcError(error);
        dispatch({ type: "SET_ERROR", error: ipcError });
      });

    return () => {
      isCurrent = false;
    };
  }, [state.image, dispatch]);

  // Handle conversion with debouncing (300ms)
  useEffect(() => {
    const image = state.image;
    const params = paramsState.params;
    if (!image || !params) {
      return;
    }

    const timer = setTimeout(() => {
      seqRef.current += 1;
      const thisSeq = seqRef.current;
      dispatch({ type: "START_CONVERT" });

      convert(image.id, params, thisSeq)
        .then((result) => {
          if (thisSeq !== seqRef.current) {
            return;
          }
          if (svgUrlRef.current) {
            URL.revokeObjectURL(svgUrlRef.current);
          }
          const blob = new Blob([result.svg], { type: "image/svg+xml" });
          const url = URL.createObjectURL(blob);
          svgUrlRef.current = url;
          dispatch({
            type: "CONVERT_SUCCESS",
            result,
            svg: result.svg,
            svgUrl: url,
          });
        })
        .catch((error: unknown) => {
          if (thisSeq !== seqRef.current) {
            return;
          }
          const ipcError = normalizeIpcError(error);
          if (ipcError.code === "Superseded") {
            return;
          }
          dispatch({ type: "CONVERT_ERROR", error: ipcError });
        });
    }, CONVERT_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [state.image, paramsState.params, dispatch]);

  // Shared dragging (Pan) logic
  const isDraggingRef = useRef(false);
  const dragStartPosRef = useRef({ x: 0, y: 0 });
  const dragStartPanRef = useRef({ x: 0, y: 0 });

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) {
        return;
      }
      isDraggingRef.current = true;
      dragStartPosRef.current = { x: e.clientX, y: e.clientY };
      dragStartPanRef.current = { ...state.pan };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [state.pan],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) {
        return;
      }
      const dx = e.clientX - dragStartPosRef.current.x;
      const dy = e.clientY - dragStartPosRef.current.y;
      dispatch({
        type: "SET_PAN",
        pan: {
          x: dragStartPanRef.current.x + dx,
          y: dragStartPanRef.current.y + dy,
        },
      });
    },
    [dispatch],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) {
        return;
      }
      isDraggingRef.current = false;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Pointer capture may have already been released
      }
    },
    [],
  );

  // Ctrl + Wheel Zoom logic with passive: false
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) {
        return;
      }
      e.preventDefault();
      const currentZoom = state.zoom;
      const factor = e.deltaY < 0 ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
      const nextZoom = currentZoom * factor;
      dispatch({ type: "SET_ZOOM", zoom: nextZoom });
    };

    const origPane = originalPaneRef.current;
    const svgPane = svgPaneRef.current;

    origPane?.addEventListener("wheel", handleWheel, { passive: false });
    svgPane?.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      origPane?.removeEventListener("wheel", handleWheel);
      svgPane?.removeEventListener("wheel", handleWheel);
    };
  }, [state.zoom, dispatch]);

  const handleZoomIn = () => {
    dispatch({ type: "SET_ZOOM", zoom: state.zoom * ZOOM_STEP_FACTOR });
  };

  const handleZoomOut = () => {
    dispatch({ type: "SET_ZOOM", zoom: state.zoom / ZOOM_STEP_FACTOR });
  };

  const handleZoom100 = () => {
    dispatch({
      type: "SET_ZOOM_AND_PAN",
      zoom: DEFAULT_ZOOM,
      pan: { x: 0, y: 0 },
    });
  };

  const handleZoomFit = () => {
    const dims = state.imageDimensions;
    const pane = originalPaneRef.current;
    if (!dims || !pane) {
      dispatch({
        type: "SET_ZOOM_AND_PAN",
        zoom: DEFAULT_ZOOM,
        pan: { x: 0, y: 0 },
      });
      return;
    }

    const availableWidth = Math.max(10, pane.clientWidth - FIT_PADDING);
    const availableHeight = Math.max(10, pane.clientHeight - FIT_PADDING);
    const fitScale = Math.min(
      availableWidth / dims.width,
      availableHeight / dims.height,
    );

    dispatch({
      type: "SET_ZOOM_AND_PAN",
      zoom: fitScale,
      pan: { x: 0, y: 0 },
    });
  };

  const handlePickImage = async () => {
    try {
      const picked = await pickImage();
      if (picked) {
        dispatch({ type: "SET_IMAGE", image: picked });
      }
    } catch (error: unknown) {
      dispatch({ type: "SET_ERROR", error: normalizeIpcError(error) });
    }
  };

  const handleSaveSvg = async () => {
    const image = state.image;
    if (!image || !state.result) {
      return;
    }
    try {
      await saveSvg(image.id);
    } catch (error: unknown) {
      dispatch({ type: "SET_ERROR", error: normalizeIpcError(error) });
    }
  };

  const dims = state.imageDimensions;
  const displayWidth = dims ? Math.round(dims.width * state.zoom) : undefined;
  const displayHeight = dims ? Math.round(dims.height * state.zoom) : undefined;

  // Empty state (no image selected)
  if (!state.image) {
    return (
      <div className="single-view">
        {state.error && state.error.code !== "Superseded" && (
          <div className="error-banner">
            <span>{getIpcErrorMessage(state.error, t)}</span>
          </div>
        )}
        <div className="dropzone-container">
          <div className="dropzone-box">
            <svg
              width="56"
              height="56"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-fg-muted)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <circle cx="9" cy="9" r="2" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
            <div className="dropzone-title">{t.dropImageHere}</div>
            <div className="dropzone-hint">{t.supportedFormats}</div>
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: 8 }}
              onClick={handlePickImage}
            >
              {t.openImage}
            </button>
          </div>
        </div>
        <footer className="single-footer">
          <span style={{ color: "var(--color-fg-muted)" }}>
            {t.noImageSelected}
          </span>
          <div className="app-spacer" />
          <button type="button" className="btn btn-primary" disabled>
            {t.saveSvg}
          </button>
        </footer>
      </div>
    );
  }

  // Active state (image selected)
  const formatLabel = getImageFormatLabel(state.image.name);
  const dimsText = dims
    ? `${dims.width} × ${dims.height} · ${formatLabel}`
    : `· ${formatLabel}`;

  return (
    <div className="single-view">
      {state.error && state.error.code !== "Superseded" && (
        <div className="error-banner">
          <span>{getIpcErrorMessage(state.error, t)}</span>
        </div>
      )}

      {/* Toolbar */}
      <div className="single-toolbar">
        <span className="single-filename">{state.image.name}</span>
        <span className="val">{dimsText}</span>
        <div className="app-spacer" />
        <button
          type="button"
          className="btn icon-btn"
          aria-label={t.zoomOut}
          onClick={handleZoomOut}
          disabled={state.zoom <= MIN_ZOOM}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M5 12h14" />
          </svg>
        </button>
        <span
          className="val"
          style={{ width: 44, textAlign: "center", display: "inline-block" }}
        >
          {Math.round(state.zoom * 100)}%
        </span>
        <button
          type="button"
          className="btn icon-btn"
          aria-label={t.zoomIn}
          onClick={handleZoomIn}
          disabled={state.zoom >= MAX_ZOOM}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M5 12h14" />
            <path d="M12 5v14" />
          </svg>
        </button>
        <button type="button" className="btn" onClick={handleZoomFit}>
          {t.zoomFit}
        </button>
        <button type="button" className="btn" onClick={handleZoom100}>
          {t.zoom100}
        </button>
      </div>

      {/* Dual preview panes */}
      <div className="single-preview-grid">
        {/* Original pane */}
        <section className="preview-pane">
          <div className="preview-pane-header">{t.originalImage}</div>
          <div
            ref={originalPaneRef}
            className="preview-viewport checker"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <div
              className="preview-content"
              style={{
                transform: `translate(${state.pan.x}px, ${state.pan.y}px)`,
              }}
            >
              {state.previewUrl && (
                <img
                  src={state.previewUrl}
                  alt={t.originalPreviewAria}
                  className="preview-image"
                  style={{
                    width: displayWidth,
                    height: displayHeight,
                    imageRendering:
                      state.zoom >= PIXELATED_ZOOM_THRESHOLD
                        ? "pixelated"
                        : "auto",
                  }}
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    if (
                      !state.imageDimensions ||
                      state.imageDimensions.width !== img.naturalWidth ||
                      state.imageDimensions.height !== img.naturalHeight
                    ) {
                      dispatch({
                        type: "SET_DIMENSIONS",
                        dimensions: {
                          width: img.naturalWidth,
                          height: img.naturalHeight,
                        },
                      });
                    }
                  }}
                />
              )}
            </div>
          </div>
        </section>

        {/* SVG pane */}
        <section className="preview-pane">
          <div className="preview-pane-header">{t.svgImage}</div>
          <div
            ref={svgPaneRef}
            className="preview-viewport checker"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <div
              className="preview-content"
              style={{
                transform: `translate(${state.pan.x}px, ${state.pan.y}px)`,
              }}
            >
              {state.svgUrl && (
                <img
                  src={state.svgUrl}
                  alt={t.svgPreviewAria}
                  className="preview-image"
                  style={{
                    width: displayWidth,
                    height: displayHeight,
                  }}
                />
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Footer */}
      <footer className="single-footer">
        <span className="footer-stat">
          {t.pathCount}{" "}
          <span className="val">
            {state.result ? state.result.pathCount : "-"}
          </span>
        </span>
        <span className="footer-stat">
          {t.fileSize}{" "}
          <span className="val">
            {state.result ? formatFileSize(state.result.bytes) : "-"}
          </span>
        </span>
        <span className="footer-stat">
          {t.elapsedTime}{" "}
          <span className="val">
            {state.result
              ? formatDuration(state.result.elapsedMs, t.unitSeconds)
              : "-"}
          </span>
        </span>
        <div className="app-spacer" />
        <button type="button" className="btn" onClick={handlePickImage}>
          {t.openImage}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleSaveSvg}
          disabled={!state.result}
        >
          {t.saveSvg}
        </button>
      </footer>
    </div>
  );
}

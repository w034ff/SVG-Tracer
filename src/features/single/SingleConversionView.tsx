import { useCallback, useEffect, useRef, type ReactElement } from "react";
import { getIpcErrorMessage } from "../../i18n";
import {
  convert,
  loadPreview,
  normalizeIpcError,
  pickImage,
  saveSvg,
} from "../../ipc";
import {
  useLanguage,
  useParams,
  useSingleConversion,
  type PanOffset,
} from "../../state";
import {
  CONVERT_DEBOUNCE_MS,
  DEFAULT_ZOOM,
  FIT_PADDING,
  MAX_ZOOM,
  MIN_ZOOM,
  MOUSE_BUTTON_MIDDLE,
  MOUSE_BUTTON_PRIMARY,
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
  const currentImageIdRef = useRef<string | null>(null);
  const prevImageIdRef = useRef<string | null>(null);

  const revokePreviewUrl = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }, []);

  const revokeSvgUrl = useCallback(() => {
    if (svgUrlRef.current) {
      URL.revokeObjectURL(svgUrlRef.current);
      svgUrlRef.current = null;
    }
  }, []);

  const revokeAllUrls = useCallback(() => {
    revokePreviewUrl();
    revokeSvgUrl();
  }, [revokePreviewUrl, revokeSvgUrl]);

  // Clean up object URLs on component unmount
  useEffect(() => {
    return () => {
      revokeAllUrls();
    };
  }, [revokeAllUrls]);

  // Track image changes to invalidate in-flight conversions and revoke previous URLs immediately
  useEffect(() => {
    const currentId = state.image?.id ?? null;
    currentImageIdRef.current = currentId;

    if (prevImageIdRef.current !== currentId) {
      seqRef.current += 1;
      revokeAllUrls();
      prevImageIdRef.current = currentId;
    }
  }, [state.image?.id, revokeAllUrls]);

  // Handle image loading (load_preview) when image changes
  useEffect(() => {
    const imageId = state.image?.id;
    if (!imageId) {
      return;
    }

    let isCurrent = true;
    loadPreview(imageId)
      .then((bytes) => {
        if (!isCurrent || imageId !== currentImageIdRef.current) {
          return;
        }
        revokePreviewUrl();
        const blob = new Blob([bytes], { type: "image/png" });
        const url = URL.createObjectURL(blob);
        previewUrlRef.current = url;
        dispatch({ type: "SET_PREVIEW", previewUrl: url });
      })
      .catch((error: unknown) => {
        if (!isCurrent || imageId !== currentImageIdRef.current) {
          return;
        }
        const ipcError = normalizeIpcError(error);
        dispatch({ type: "SET_ERROR", error: ipcError });
      });

    return () => {
      isCurrent = false;
    };
  }, [state.image?.id, dispatch, revokePreviewUrl]);

  // Handle conversion with debouncing (300ms)
  useEffect(() => {
    const imageId = state.image?.id;
    const params = paramsState.params;
    if (!imageId || !params) {
      return;
    }

    const timer = setTimeout(() => {
      seqRef.current += 1;
      const thisSeq = seqRef.current;
      dispatch({ type: "START_CONVERT" });

      convert(imageId, params, thisSeq)
        .then((result) => {
          if (
            thisSeq !== seqRef.current ||
            imageId !== currentImageIdRef.current
          ) {
            return;
          }
          revokeSvgUrl();
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
          if (
            thisSeq !== seqRef.current ||
            imageId !== currentImageIdRef.current
          ) {
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
  }, [state.image?.id, paramsState.params, dispatch, revokeSvgUrl]);

  // Shared dragging (Pan) logic
  const isDraggingRef = useRef(false);
  const dragStartPosRef = useRef({ x: 0, y: 0 });
  const dragStartPanRef = useRef({ x: 0, y: 0 });

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (
        e.button !== MOUSE_BUTTON_PRIMARY &&
        e.button !== MOUSE_BUTTON_MIDDLE
      ) {
        return;
      }
      if (e.button === MOUSE_BUTTON_MIDDLE) {
        e.preventDefault();
      }
      isDraggingRef.current = true;
      dragStartPosRef.current = { x: e.clientX, y: e.clientY };
      dragStartPanRef.current = { ...state.pan };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [state.pan],
  );

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button === MOUSE_BUTTON_MIDDLE) {
      e.preventDefault();
    }
  }, []);

  const handleAuxClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button === MOUSE_BUTTON_MIDDLE) {
      e.preventDefault();
    }
  }, []);

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

  // Ctrl + Wheel Zoom logic with callback refs and anchored ZOOM_BY action
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if (!e.ctrlKey) {
        return;
      }
      e.preventDefault();
      const factor = e.deltaY < 0 ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;

      let anchor: PanOffset | undefined;
      if (e.currentTarget instanceof HTMLElement) {
        const rect = e.currentTarget.getBoundingClientRect();
        anchor = {
          x: e.clientX - (rect.left + rect.width / 2),
          y: e.clientY - (rect.top + rect.height / 2),
        };
      }

      dispatch({ type: "ZOOM_BY", factor, anchor });
    },
    [dispatch],
  );

  const originalPaneRef = useRef<HTMLDivElement | null>(null);
  const setOriginalPaneRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (originalPaneRef.current) {
        originalPaneRef.current.removeEventListener("wheel", handleWheel);
      }
      originalPaneRef.current = node;
      if (node) {
        node.addEventListener("wheel", handleWheel, { passive: false });
      }
    },
    [handleWheel],
  );

  const svgPaneRef = useRef<HTMLDivElement | null>(null);
  const setSvgPaneRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (svgPaneRef.current) {
        svgPaneRef.current.removeEventListener("wheel", handleWheel);
      }
      svgPaneRef.current = node;
      if (node) {
        node.addEventListener("wheel", handleWheel, { passive: false });
      }
    },
    [handleWheel],
  );

  const handleZoomIn = () => {
    dispatch({ type: "ZOOM_BY", factor: ZOOM_STEP_FACTOR });
  };

  const handleZoomOut = () => {
    dispatch({ type: "ZOOM_BY", factor: 1 / ZOOM_STEP_FACTOR });
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
    const pane = originalPaneRef.current ?? svgPaneRef.current;
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
  const dimsPart = dims ? `${dims.width} × ${dims.height}` : "";
  const dimsText = [dimsPart, formatLabel]
    .filter((s) => s.length > 0)
    .join(" · ");

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
        {dimsText.length > 0 && <span className="val">{dimsText}</span>}
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
            ref={setOriginalPaneRef}
            className="preview-viewport checker"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onMouseDown={handleMouseDown}
            onAuxClick={handleAuxClick}
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
            ref={setSvgPaneRef}
            className="preview-viewport checker"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onMouseDown={handleMouseDown}
            onAuxClick={handleAuxClick}
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

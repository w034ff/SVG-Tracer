import type { ChangeEvent, ReactElement } from "react";
import type { TraceParams } from "../../ipc";
import { useLanguage, useParams } from "../../state";
import { INTEGER_PARAM_STEP, LENGTH_THRESHOLD_STEP } from "./constants";

export function ParamsPanel(): ReactElement {
  const { t } = useLanguage();
  const { state, dispatch } = useParams();
  const { spec, params, preset, isAdvancedOpen, error } = state;

  if (error) {
    return (
      <aside className="app-aside" role="alert">
        <div className="field">
          <span className="field-head">{t.paramSpecLoadFailed}</span>
          {error.detail && <span className="val">{error.detail}</span>}
        </div>
      </aside>
    );
  }

  if (!spec || !params) {
    return (
      <aside className="app-aside" aria-busy="true">
        <div className="field">
          <span className="field-head">{t.preset}</span>
        </div>
      </aside>
    );
  }

  function handlePresetChange(event: ChangeEvent<HTMLSelectElement>): void {
    const value = event.target.value;
    if (value === "colorLogo" || value === "colorIcon" || value === "binary") {
      dispatch({ type: "SET_PRESET", preset: value });
    }
  }

  function updateParam<K extends keyof TraceParams>(
    key: K,
    value: TraceParams[K],
  ): void {
    dispatch({ type: "SET_PARAM", key, value });
  }

  function handleIntSlider(
    key: keyof TraceParams,
    event: ChangeEvent<HTMLInputElement>,
  ): void {
    const parsed = parseInt(event.target.value, 10);
    if (!Number.isNaN(parsed)) {
      updateParam(key, parsed);
    }
  }

  function handleFloatSlider(
    key: keyof TraceParams,
    event: ChangeEvent<HTMLInputElement>,
  ): void {
    const parsed = parseFloat(event.target.value);
    if (!Number.isNaN(parsed)) {
      updateParam(key, parsed);
    }
  }

  const isColorMode = params.colorMode === "color";

  return (
    <aside className="app-aside">
      {/* Preset selector */}
      <div className="field">
        <label htmlFor="preset" className="field-head">
          {t.preset}
        </label>
        <select id="preset" value={preset} onChange={handlePresetChange}>
          {preset === "custom" && (
            <option value="custom">{t.presetCustom}</option>
          )}
          <option value="colorLogo">{t.presetColorLogo}</option>
          <option value="colorIcon">{t.presetColorIcon}</option>
          <option value="binary">{t.presetBinary}</option>
        </select>
      </div>

      <div className="divider" />

      {/* Color mode */}
      <div className="field">
        <span className="field-head">{t.colorMode}</span>
        <div className="seg">
          <button
            type="button"
            aria-pressed={params.colorMode === "color"}
            onClick={() => updateParam("colorMode", "color")}
          >
            {t.colorModeColor}
          </button>
          <button
            type="button"
            aria-pressed={params.colorMode === "binary"}
            onClick={() => updateParam("colorMode", "binary")}
          >
            {t.colorModeBinary}
          </button>
        </div>
      </div>

      {/* Color precision (color mode only) */}
      {isColorMode && (
        <div className="field">
          <label htmlFor="cp" className="field-head">
            <span>{t.colorPrecision}</span>
            <span className="val">{params.colorPrecision}</span>
          </label>
          <input
            id="cp"
            type="range"
            min={spec.ranges.colorPrecision.min}
            max={spec.ranges.colorPrecision.max}
            step={INTEGER_PARAM_STEP}
            value={params.colorPrecision}
            onChange={(e) => handleIntSlider("colorPrecision", e)}
          />
        </div>
      )}

      {/* Filter speckle */}
      <div className="field">
        <label htmlFor="fs" className="field-head">
          <span>{t.filterSpeckle}</span>
          <span className="val">{params.filterSpeckle}</span>
        </label>
        <input
          id="fs"
          type="range"
          min={spec.ranges.filterSpeckle.min}
          max={spec.ranges.filterSpeckle.max}
          step={INTEGER_PARAM_STEP}
          value={params.filterSpeckle}
          onChange={(e) => handleIntSlider("filterSpeckle", e)}
        />
      </div>

      {/* Corner threshold */}
      <div className="field">
        <label htmlFor="ct" className="field-head">
          <span>{t.cornerThreshold}</span>
          <span className="val">{params.cornerThreshold}°</span>
        </label>
        <input
          id="ct"
          type="range"
          min={spec.ranges.cornerThreshold.min}
          max={spec.ranges.cornerThreshold.max}
          step={INTEGER_PARAM_STEP}
          value={params.cornerThreshold}
          onChange={(e) => handleIntSlider("cornerThreshold", e)}
        />
      </div>

      {/* Curve type */}
      <div className="field">
        <span className="field-head">{t.curveMode}</span>
        <div className="seg">
          <button
            type="button"
            aria-pressed={params.curveMode === "spline"}
            onClick={() => updateParam("curveMode", "spline")}
          >
            {t.curveModeSpline}
          </button>
          <button
            type="button"
            aria-pressed={params.curveMode === "polygon"}
            onClick={() => updateParam("curveMode", "polygon")}
          >
            {t.curveModePolygon}
          </button>
        </div>
      </div>

      {/* Advanced toggle */}
      <button
        type="button"
        className="btn btn-advanced"
        aria-expanded={isAdvancedOpen}
        onClick={() => dispatch({ type: "TOGGLE_ADVANCED" })}
      >
        <span>{t.advanced}</span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {isAdvancedOpen ? (
            <path d="M6 9l6 6 6-6" />
          ) : (
            <path d="M9 6l6 6-6 6" />
          )}
        </svg>
      </button>

      {/* Advanced settings section */}
      {isAdvancedOpen && (
        <>
          {/* Gradient step (color mode only) */}
          {isColorMode && (
            <div className="field">
              <label htmlFor="ld" className="field-head">
                <span>{t.layerDifference}</span>
                <span className="val">{params.layerDifference}</span>
              </label>
              <input
                id="ld"
                type="range"
                min={spec.ranges.layerDifference.min}
                max={spec.ranges.layerDifference.max}
                step={INTEGER_PARAM_STEP}
                value={params.layerDifference}
                onChange={(e) => handleIntSlider("layerDifference", e)}
              />
            </div>
          )}

          {/* Layering (color mode only) */}
          {isColorMode && (
            <div className="field">
              <span className="field-head">{t.hierarchical}</span>
              <div className="seg">
                <button
                  type="button"
                  aria-pressed={params.hierarchical === "stacked"}
                  onClick={() => updateParam("hierarchical", "stacked")}
                >
                  {t.hierarchicalStacked}
                </button>
                <button
                  type="button"
                  aria-pressed={params.hierarchical === "cutout"}
                  onClick={() => updateParam("hierarchical", "cutout")}
                >
                  {t.hierarchicalCutout}
                </button>
              </div>
            </div>
          )}

          {/* Segment length */}
          <div className="field">
            <label htmlFor="lt" className="field-head">
              <span>{t.lengthThreshold}</span>
              <span className="val">{params.lengthThreshold.toFixed(1)}</span>
            </label>
            <input
              id="lt"
              type="range"
              min={spec.ranges.lengthThreshold.min}
              max={spec.ranges.lengthThreshold.max}
              step={LENGTH_THRESHOLD_STEP}
              value={params.lengthThreshold}
              onChange={(e) => handleFloatSlider("lengthThreshold", e)}
            />
          </div>

          {/* Splice threshold */}
          <div className="field">
            <label htmlFor="st" className="field-head">
              <span>{t.spliceThreshold}</span>
              <span className="val">{params.spliceThreshold}°</span>
            </label>
            <input
              id="st"
              type="range"
              min={spec.ranges.spliceThreshold.min}
              max={spec.ranges.spliceThreshold.max}
              step={INTEGER_PARAM_STEP}
              value={params.spliceThreshold}
              onChange={(e) => handleIntSlider("spliceThreshold", e)}
            />
          </div>

          {/* Path precision */}
          <div className="field">
            <label htmlFor="pp" className="field-head">
              <span>{t.pathPrecision}</span>
              <span className="val">{params.pathPrecision}</span>
            </label>
            <input
              id="pp"
              type="range"
              min={spec.ranges.pathPrecision.min}
              max={spec.ranges.pathPrecision.max}
              step={INTEGER_PARAM_STEP}
              value={params.pathPrecision}
              onChange={(e) => handleIntSlider("pathPrecision", e)}
            />
          </div>
        </>
      )}
    </aside>
  );
}

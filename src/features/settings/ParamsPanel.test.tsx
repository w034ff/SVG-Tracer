import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { IpcError, ParamSpec, TraceParams } from "../../ipc";
import { LanguageProvider, ParamsProvider } from "../../state";
import { ParamsPanel } from "./ParamsPanel";

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

const BINARY_PARAMS: TraceParams = {
  colorMode: "binary",
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
  presets: [
    { id: "colorLogo", params: COLOR_LOGO_PARAMS },
    { id: "colorIcon", params: COLOR_ICON_PARAMS },
    { id: "binary", params: BINARY_PARAMS },
  ],
  defaultPreset: "colorLogo",
};

function renderParamsPanel(options?: {
  spec?: ParamSpec;
  language?: "ja" | "en";
}) {
  return render(
    <LanguageProvider initialLanguage={options?.language ?? "ja"}>
      <ParamsProvider initialSpec={options?.spec ?? TEST_SPEC}>
        <ParamsPanel />
      </ParamsProvider>
    </LanguageProvider>,
  );
}

describe("ParamsPanel", () => {
  afterEach(() => {
    clearMocks();
  });

  it("displays localized error message when get_param_spec fails in Japanese", async () => {
    const error: IpcError = {
      code: "ReadFailed",
      detail: "Config file inaccessible",
    };
    mockIPC((cmd) => {
      if (cmd === "get_param_spec") {
        return Promise.reject(error);
      }
    });

    render(
      <LanguageProvider initialLanguage="ja">
        <ParamsProvider>
          <ParamsPanel />
        </ParamsProvider>
      </LanguageProvider>,
    );

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByText("パラメータ設定の読み込みに失敗しました"),
    ).toBeInTheDocument();
    expect(screen.getByText("Config file inaccessible")).toBeInTheDocument();
  });

  it("displays localized error message when get_param_spec fails in English", async () => {
    const error: IpcError = {
      code: "ReadFailed",
      detail: null,
    };
    mockIPC((cmd) => {
      if (cmd === "get_param_spec") {
        return Promise.reject(error);
      }
    });

    render(
      <LanguageProvider initialLanguage="en">
        <ParamsProvider>
          <ParamsPanel />
        </ParamsProvider>
      </LanguageProvider>,
    );

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByText("Failed to load parameter settings"),
    ).toBeInTheDocument();
  });
  it("uses ranges from get_param_spec and named step constants for sliders", () => {
    renderParamsPanel();

    const colorPrecisionSlider = screen.getByLabelText(/色の精度/);
    expect(colorPrecisionSlider).toHaveAttribute("min", "1");
    expect(colorPrecisionSlider).toHaveAttribute("max", "8");
    expect(colorPrecisionSlider).toHaveAttribute("step", "1");

    const filterSpeckleSlider = screen.getByLabelText(/ノイズ除去/);
    expect(filterSpeckleSlider).toHaveAttribute("min", "0");
    expect(filterSpeckleSlider).toHaveAttribute("max", "16");
    expect(filterSpeckleSlider).toHaveAttribute("step", "1");

    const cornerThresholdSlider = screen.getByLabelText(/角の判定/);
    expect(cornerThresholdSlider).toHaveAttribute("min", "0");
    expect(cornerThresholdSlider).toHaveAttribute("max", "180");
    expect(cornerThresholdSlider).toHaveAttribute("step", "1");

    // Open advanced to inspect detailed sliders
    const advancedButton = screen.getByRole("button", { name: /詳細設定/ });
    fireEvent.click(advancedButton);

    const lengthThresholdSlider = screen.getByLabelText(/線分の長さ/);
    expect(lengthThresholdSlider).toHaveAttribute("min", "3.5");
    expect(lengthThresholdSlider).toHaveAttribute("max", "10");
    expect(lengthThresholdSlider).toHaveAttribute("step", "0.5");
  });

  it("populates values when a preset is selected", () => {
    renderParamsPanel();

    const presetSelect = screen.getByLabelText("プリセット");
    expect(presetSelect).toHaveValue("colorLogo");

    const filterSpeckleSlider = screen.getByLabelText(/ノイズ除去/);
    expect(filterSpeckleSlider).toHaveValue("4");

    // Select colorIcon preset
    fireEvent.change(presetSelect, { target: { value: "colorIcon" } });

    expect(presetSelect).toHaveValue("colorIcon");
    expect(filterSpeckleSlider).toHaveValue("8");

    const colorPrecisionSlider = screen.getByLabelText(/色の精度/);
    expect(colorPrecisionSlider).toHaveValue("4");
  });

  it("switches preset to 'カスタム' when a value is changed", () => {
    renderParamsPanel();

    const presetSelect = screen.getByLabelText("プリセット");
    expect(presetSelect).toHaveValue("colorLogo");

    const cornerThresholdSlider = screen.getByLabelText(/角の判定/);
    fireEvent.change(cornerThresholdSlider, { target: { value: "90" } });

    expect(presetSelect).toHaveValue("custom");
    expect(screen.getByText("カスタム")).toBeInTheDocument();
    expect(cornerThresholdSlider).toHaveValue("90");
  });

  it("switches preset to 'カスタム' when curve type is changed", () => {
    renderParamsPanel();

    const presetSelect = screen.getByLabelText("プリセット");
    expect(presetSelect).toHaveValue("colorLogo");

    const polygonButton = screen.getByRole("button", { name: "多角形" });
    fireEvent.click(polygonButton);

    expect(presetSelect).toHaveValue("custom");
    expect(polygonButton).toHaveAttribute("aria-pressed", "true");
  });

  it("hides color-only items in binary mode (both via preset and toggle)", () => {
    renderParamsPanel();

    // In color mode, color precision is visible
    expect(screen.queryByLabelText(/色の精度/)).toBeInTheDocument();

    // Open advanced settings
    const advancedButton = screen.getByRole("button", { name: /詳細設定/ });
    fireEvent.click(advancedButton);

    expect(screen.queryByLabelText(/色の階調差/)).toBeInTheDocument();
    expect(screen.queryByText("重ね方")).toBeInTheDocument();

    // Switch to binary via segmented button
    const binaryModeButton = screen.getByRole("button", { name: "白黒" });
    fireEvent.click(binaryModeButton);

    // Color-only fields must now be hidden
    expect(screen.queryByLabelText(/色の精度/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/色の階調差/)).not.toBeInTheDocument();
    expect(screen.queryByText("重ね方")).not.toBeInTheDocument();

    // Non-color fields remain visible
    expect(screen.getByLabelText(/ノイズ除去/)).toBeInTheDocument();
    expect(screen.getByLabelText(/角の判定/)).toBeInTheDocument();
    expect(screen.getByLabelText(/線分の長さ/)).toBeInTheDocument();
    expect(screen.getByLabelText(/曲線の分割/)).toBeInTheDocument();
    expect(screen.getByLabelText(/座標の精度/)).toBeInTheDocument();

    // Selecting binary preset also keeps them hidden
    const presetSelect = screen.getByLabelText("プリセット");
    fireEvent.change(presetSelect, { target: { value: "binary" } });

    expect(screen.queryByLabelText(/色の精度/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/色の階調差/)).not.toBeInTheDocument();
    expect(screen.queryByText("重ね方")).not.toBeInTheDocument();

    // Switching back to color mode restores them
    const colorModeButton = screen.getByRole("button", { name: "カラー" });
    fireEvent.click(colorModeButton);

    expect(screen.queryByLabelText(/色の精度/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/色の階調差/)).toBeInTheDocument();
    expect(screen.queryByText("重ね方")).toBeInTheDocument();
  });

  it("toggles advanced settings expansion", () => {
    renderParamsPanel();

    const advancedButton = screen.getByRole("button", { name: /詳細設定/ });
    expect(advancedButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText(/座標の精度/)).not.toBeInTheDocument();

    fireEvent.click(advancedButton);
    expect(advancedButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText(/座標の精度/)).toBeInTheDocument();

    fireEvent.click(advancedButton);
    expect(advancedButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText(/座標の精度/)).not.toBeInTheDocument();
  });

  it("disables all controls and displays notice when disabled prop is true", () => {
    render(
      <LanguageProvider initialLanguage="ja">
        <ParamsProvider initialSpec={TEST_SPEC}>
          <ParamsPanel disabled={true} />
        </ParamsProvider>
      </LanguageProvider>,
    );

    expect(
      screen.getByText("変換中は設定を変更できません"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("プリセット")).toBeDisabled();
    expect(screen.getByLabelText(/色の精度/)).toBeDisabled();
    expect(screen.getByLabelText(/ノイズ除去/)).toBeDisabled();
    expect(screen.getByLabelText(/角の判定/)).toBeDisabled();
    expect(screen.getByRole("button", { name: "カラー" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "白黒" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "曲線" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "多角形" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /詳細設定/ })).toBeDisabled();
  });
});

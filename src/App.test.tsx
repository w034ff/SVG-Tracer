import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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

  it("displays localized error message when getParamSpec fails", () => {
    render(
      <App
        initialLanguage="ja"
        initialParamError={{
          code: "ReadFailed",
          detail: "Backend read error",
        }}
      />,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByText("パラメータ設定の読み込みに失敗しました"),
    ).toBeInTheDocument();
    expect(screen.getByText("Backend read error")).toBeInTheDocument();
  });
});

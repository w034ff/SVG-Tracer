import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { translations } from "./i18n";

describe("App", () => {
  it("renders the application title", () => {
    render(<App />);
    expect(
      screen.getByRole("heading", { name: translations.ja.appTitle }),
    ).toBeInTheDocument();
  });
});

import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../state";
import { AboutDialog } from "./AboutDialog";

describe("AboutDialog", () => {
  afterEach(() => {
    clearMocks();
  });

  it("renders nothing when isOpen is false", () => {
    render(
      <LanguageProvider initialLanguage="ja">
        <AboutDialog isOpen={false} onClose={vi.fn()} />
      </LanguageProvider>,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders dialog with version, MIT license, and third-party licenses", async () => {
    mockIPC((cmd) => {
      if (cmd === "get_about") {
        return { version: "0.1.0" };
      }
      return null;
    });

    render(
      <LanguageProvider initialLanguage="ja">
        <AboutDialog isOpen={true} onClose={vi.fn()} />
      </LanguageProvider>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "about-dialog-title");

    // Version
    expect(await screen.findByText("バージョン 0.1.0")).toBeInTheDocument();

    // MIT license text from repository LICENSE file
    expect(
      screen.getByText(/Permission is hereby granted/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Copyright \(c\) 2026/)).toBeInTheDocument();

    // Third-party licenses loaded dynamically
    await screen.findByText(/vtracer/);
    expect(screen.getAllByText(/vtracer/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/tauri/).length).toBeGreaterThan(0);
  });

  it("calls onClose when Escape key is pressed", async () => {
    const handleClose = vi.fn();
    render(
      <LanguageProvider initialLanguage="ja">
        <AboutDialog
          isOpen={true}
          onClose={handleClose}
          initialAbout={{ version: "1.0.0" }}
        />
      </LanguageProvider>,
    );

    // Wait for dynamic imports to settle
    await screen.findByText(/vtracer/);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when close button is clicked", async () => {
    const handleClose = vi.fn();
    render(
      <LanguageProvider initialLanguage="ja">
        <AboutDialog
          isOpen={true}
          onClose={handleClose}
          initialAbout={{ version: "1.0.0" }}
        />
      </LanguageProvider>,
    );

    await screen.findByText(/vtracer/);

    const closeBtns = screen.getAllByRole("button", { name: "閉じる" });
    expect(closeBtns.length).toBeGreaterThan(0);
    fireEvent.click(closeBtns[0]);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("moves focus inside the dialog when opened", async () => {
    render(
      <LanguageProvider initialLanguage="ja">
        <AboutDialog
          isOpen={true}
          onClose={vi.fn()}
          initialAbout={{ version: "1.0.0" }}
        />
      </LanguageProvider>,
    );

    await screen.findByText(/vtracer/);

    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});

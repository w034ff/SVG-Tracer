import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { LanguageProvider } from "../../state";
import { AboutDialog } from "./AboutDialog";

describe("AboutDialog", () => {
  beforeAll(async () => {
    // Prewarm dynamic import of licenses to prevent timeout
    await import("../../licenses");
  });

  beforeEach(() => {
    mockIPC((cmd) => {
      if (cmd === "get_about") {
        return { version: "0.1.0" };
      }
      return null;
    });
  });

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
      screen.getAllByText(/Permission is hereby granted/).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/Copyright \(c\) 2026 w034ff/)).toBeInTheDocument();

    // Third-party licenses loaded dynamically
    await screen.findByText(/vtracer/);
    expect(screen.getAllByText(/vtracer/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/tauri/).length).toBeGreaterThan(0);
  });

  it("calls onClose when Escape key is pressed", async () => {
    const handleClose = vi.fn();
    render(
      <LanguageProvider initialLanguage="ja">
        <AboutDialog isOpen={true} onClose={handleClose} />
      </LanguageProvider>,
    );

    await screen.findByText(/vtracer/);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when close button is clicked", async () => {
    const handleClose = vi.fn();
    render(
      <LanguageProvider initialLanguage="ja">
        <AboutDialog isOpen={true} onClose={handleClose} />
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
        <AboutDialog isOpen={true} onClose={vi.fn()} />
      </LanguageProvider>,
    );

    await screen.findByText(/vtracer/);

    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("traps Tab key navigation inside the dialog", async () => {
    render(
      <LanguageProvider initialLanguage="ja">
        <AboutDialog isOpen={true} onClose={vi.fn()} />
      </LanguageProvider>,
    );

    await screen.findByText(/vtracer/);

    const closeBtns = screen.getAllByRole("button", { name: "閉じる" });
    const topCloseBtn = closeBtns[0];
    const bottomCloseBtn = closeBtns[closeBtns.length - 1];
    expect(document.activeElement).toBe(topCloseBtn);

    // Shift+Tab from the first focusable element wraps to the last focusable element
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(bottomCloseBtn);

    // Tab from the last focusable element wraps back to the first focusable element (close button)
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(topCloseBtn);
  });

  it("maintains consistent dialog class and reserved version height before and after licenses load", async () => {
    render(
      <LanguageProvider initialLanguage="ja">
        <AboutDialog isOpen={true} onClose={vi.fn()} />
      </LanguageProvider>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveClass("modal-dialog");

    // Version row area is rendered immediately to reserve space
    const versionArea = document.querySelector(".about-version");
    expect(versionArea).toBeInTheDocument();

    const classNameBefore = dialog.className;

    // Wait for third-party licenses to load
    await screen.findByText(/vtracer/);

    expect(dialog.className).toBe(classNameBefore);
    expect(dialog).toHaveClass("modal-dialog");
  });
});

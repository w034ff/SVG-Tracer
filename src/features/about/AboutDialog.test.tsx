import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act, fireEvent, render, screen } from "@testing-library/react";
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

  it("renders dialog initially with version, MIT license, and collapsed toggle button without third-party licenses", async () => {
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

    // Toggle button should be rendered in collapsed state initially
    const toggleBtn = screen.getByRole("button", {
      name: "第三者ライセンスを表示",
    });
    expect(toggleBtn).toBeInTheDocument();
    expect(toggleBtn).toHaveAttribute("aria-expanded", "false");
    expect(toggleBtn).not.toHaveAttribute("aria-controls");

    // Third-party licenses should not be loaded or present initially
    expect(screen.queryByText(/vtracer/)).toBeNull();
    expect(document.getElementById("about-third-party-licenses")).toBeNull();
  });

  it("expands third-party licenses when toggle button is clicked and collapses when clicked again", async () => {
    render(
      <LanguageProvider initialLanguage="ja">
        <AboutDialog isOpen={true} onClose={vi.fn()} />
      </LanguageProvider>,
    );

    const toggleBtn = screen.getByRole("button", {
      name: "第三者ライセンスを表示",
    });
    expect(toggleBtn).toHaveAttribute("aria-expanded", "false");

    // Click to expand
    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute("aria-expanded", "true");
    expect(toggleBtn).toHaveAttribute(
      "aria-controls",
      "about-third-party-licenses",
    );
    expect(toggleBtn).toHaveTextContent("第三者ライセンスを隠す");

    // Third-party licenses loaded and displayed
    await screen.findByText(/vtracer/);
    expect(screen.getAllByText(/vtracer/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/tauri/).length).toBeGreaterThan(0);
    expect(
      document.getElementById("about-third-party-licenses"),
    ).toBeInTheDocument();

    // Click to collapse
    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute("aria-expanded", "false");
    expect(toggleBtn).not.toHaveAttribute("aria-controls");
    expect(toggleBtn).toHaveTextContent("第三者ライセンスを表示");

    expect(screen.queryByText(/vtracer/)).toBeNull();
    expect(document.getElementById("about-third-party-licenses")).toBeNull();
  });

  it("sets aria-controls to about-third-party-licenses when expanded and targets the rendered element", async () => {
    render(
      <LanguageProvider initialLanguage="ja">
        <AboutDialog isOpen={true} onClose={vi.fn()} />
      </LanguageProvider>,
    );

    const toggleBtn = screen.getByRole("button", {
      name: "第三者ライセンスを表示",
    });
    expect(toggleBtn).not.toHaveAttribute("aria-controls");

    fireEvent.click(toggleBtn);

    expect(toggleBtn).toHaveAttribute(
      "aria-controls",
      "about-third-party-licenses",
    );
    expect(
      document.getElementById("about-third-party-licenses"),
    ).toBeInTheDocument();

    await screen.findByText(/vtracer/);
  });

  it("collapses third-party licenses when dialog is closed and reopened", async () => {
    const { rerender } = render(
      <LanguageProvider initialLanguage="ja">
        <AboutDialog isOpen={true} onClose={vi.fn()} />
      </LanguageProvider>,
    );

    const toggleBtn = screen.getByRole("button", {
      name: "第三者ライセンスを表示",
    });
    fireEvent.click(toggleBtn);

    await screen.findByText(/vtracer/);
    expect(toggleBtn).toHaveAttribute("aria-expanded", "true");

    // Close the dialog
    act(() => {
      rerender(
        <LanguageProvider initialLanguage="ja">
          <AboutDialog isOpen={false} onClose={vi.fn()} />
        </LanguageProvider>,
      );
    });
    expect(screen.queryByRole("dialog")).toBeNull();

    // Reopen the dialog
    act(() => {
      rerender(
        <LanguageProvider initialLanguage="ja">
          <AboutDialog isOpen={true} onClose={vi.fn()} />
        </LanguageProvider>,
      );
    });

    expect(await screen.findByText("バージョン 0.1.0")).toBeInTheDocument();

    // Should be reset to collapsed state
    const reopenedToggleBtn = screen.getByRole("button", {
      name: "第三者ライセンスを表示",
    });
    expect(reopenedToggleBtn).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/vtracer/)).toBeNull();
    expect(document.getElementById("about-third-party-licenses")).toBeNull();
  });

  it("maintains consistent dialog class and style before and after expanding licenses", async () => {
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
    const styleBefore = dialog.getAttribute("style");

    const toggleBtn = screen.getByRole("button", {
      name: "第三者ライセンスを表示",
    });
    fireEvent.click(toggleBtn);

    // Wait for third-party licenses to load
    await screen.findByText(/vtracer/);

    expect(dialog.className).toBe(classNameBefore);
    expect(dialog.getAttribute("style")).toBe(styleBefore);
    expect(dialog).toHaveClass("modal-dialog");
  });

  it("calls onClose when Escape key is pressed", async () => {
    const handleClose = vi.fn();
    render(
      <LanguageProvider initialLanguage="ja">
        <AboutDialog isOpen={true} onClose={handleClose} />
      </LanguageProvider>,
    );

    expect(await screen.findByRole("dialog")).toBeInTheDocument();

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

    expect(await screen.findByRole("dialog")).toBeInTheDocument();

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

    const dialog = await screen.findByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("traps Tab key navigation inside the dialog when collapsed", async () => {
    render(
      <LanguageProvider initialLanguage="ja">
        <AboutDialog isOpen={true} onClose={vi.fn()} />
      </LanguageProvider>,
    );

    await screen.findByRole("dialog");

    const closeBtns = screen.getAllByRole("button", { name: "閉じる" });
    const topCloseBtn = closeBtns[0];
    const bottomCloseBtn = closeBtns[closeBtns.length - 1];
    const toggleBtn = screen.getByRole("button", {
      name: "第三者ライセンスを表示",
    });

    expect(document.activeElement).toBe(topCloseBtn);

    // Shift+Tab from the first focusable element wraps to the last focusable element
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(bottomCloseBtn);

    // Tab from the last focusable element wraps back to the first focusable element (top close button)
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(topCloseBtn);

    // Toggle button can receive focus
    toggleBtn.focus();
    expect(document.activeElement).toBe(toggleBtn);
  });
});

import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

if (typeof window.URL.createObjectURL === "undefined") {
  let counter = 0;
  window.URL.createObjectURL = (): string => {
    counter += 1;
    return `blob:mock-url-${counter}`;
  };
}

if (typeof window.URL.revokeObjectURL === "undefined") {
  window.URL.revokeObjectURL = (): void => {};
}

if (typeof Element.prototype.setPointerCapture === "undefined") {
  Element.prototype.setPointerCapture = (): void => {};
}

if (typeof Element.prototype.releasePointerCapture === "undefined") {
  Element.prototype.releasePointerCapture = (): void => {};
}

afterEach(() => {
  if (
    typeof window !== "undefined" &&
    "__TAURI_EVENT_PLUGIN_INTERNALS__" in window
  ) {
    const internals = window.__TAURI_EVENT_PLUGIN_INTERNALS__;
    if (typeof internals === "object" && internals !== null) {
      Reflect.set(internals, "unregisterListener", () => {});
    }
  }
});

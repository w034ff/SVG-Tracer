import { describe, expect, it } from "vitest";
import { formatMessage, resolveInitialLanguage, translations } from "./index";

describe("i18n", () => {
  describe("resolveInitialLanguage", () => {
    it("returns saved language if it is ja", () => {
      expect(resolveInitialLanguage("ja", ["en-US"])).toBe("ja");
    });

    it("returns saved language if it is en", () => {
      expect(resolveInitialLanguage("en", ["ja-JP"])).toBe("en");
    });

    it("ignores unknown saved language and checks browser languages", () => {
      expect(resolveInitialLanguage("fr", ["ja-JP"])).toBe("ja");
      expect(resolveInitialLanguage("unknown", ["en-GB"])).toBe("en");
    });

    it("falls back to ja when browser language begins with ja", () => {
      expect(resolveInitialLanguage(undefined, ["ja-JP", "en-US"])).toBe("ja");
      expect(resolveInitialLanguage(null, ["JA", "en"])).toBe("ja");
    });

    it("falls back to en when browser language does not begin with ja", () => {
      expect(resolveInitialLanguage(undefined, ["en-US", "ja"])).toBe("en");
      expect(resolveInitialLanguage(undefined, ["de-DE"])).toBe("en");
      expect(resolveInitialLanguage(undefined, [])).toBe("en");
      expect(resolveInitialLanguage(undefined, undefined)).toBe("en");
    });
  });

  describe("formatMessage", () => {
    it("interpolates named placeholders", () => {
      const result = formatMessage("Processed {count} items of {total}", {
        count: 5,
        total: 10,
      });
      expect(result).toBe("Processed 5 items of 10");
    });

    it("leaves unknown placeholders intact", () => {
      const result = formatMessage("Hello {name} {missing}", { name: "World" });
      expect(result).toBe("Hello World {missing}");
    });
  });

  describe("translations", () => {
    it("has identical keys in ja and en", () => {
      const jaKeys = Object.keys(translations.ja).sort();
      const enKeys = Object.keys(translations.en).sort();
      expect(jaKeys).toEqual(enKeys);
    });
  });

  describe("getIpcErrorMessage", () => {
    it("returns base message when detail is null", async () => {
      const { getIpcErrorMessage } = await import("./index");
      const msg = getIpcErrorMessage(
        { code: "UnsupportedFormat", detail: null },
        translations.ja,
      );
      expect(msg).toBe("非対応の画像形式です");
    });

    it("appends detail when detail is present", async () => {
      const { getIpcErrorMessage } = await import("./index");
      const msg = getIpcErrorMessage(
        { code: "DecodeFailed", detail: "corrupt header" },
        translations.en,
      );
      expect(msg).toBe("Failed to decode image: corrupt header");
    });
  });
});

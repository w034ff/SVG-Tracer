import { describe, expect, it } from "vitest";

const HEX_COLOR_REGEX = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;
const FUNCTIONAL_COLOR_REGEX = /\b(?:rgb|rgba|hsl|hsla)\s*\(/;

describe("Theme and Style tokens", () => {
  it("ensures no color literal values are hard-coded outside src/styles/tokens.css", () => {
    const allFiles = import.meta.glob<string>(
      ["../**/*.css", "../**/*.tsx", "../**/*.ts"],
      { query: "?raw", import: "default", eager: true },
    );

    const violations: { file: string; line: number; text: string }[] = [];

    for (const [filePath, content] of Object.entries(allFiles)) {
      // tokens.css is the single source of truth for color literals
      if (filePath.endsWith("tokens.css")) {
        continue;
      }
      // Also ignore test files
      if (filePath.includes(".test.")) {
        continue;
      }

      const lines = content.split("\n");
      lines.forEach((line: string, index: number) => {
        if (HEX_COLOR_REGEX.test(line) || FUNCTIONAL_COLOR_REGEX.test(line)) {
          violations.push({
            file: filePath,
            line: index + 1,
            text: line.trim(),
          });
        }
      });
    }

    expect(violations).toEqual([]);
  });
});

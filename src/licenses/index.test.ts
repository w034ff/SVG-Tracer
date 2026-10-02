import { describe, expect, it } from "vitest";
import {
  parseThirdPartyLicenses,
  thirdPartyLicenses,
  type PackageEcosystem,
} from "./index";

const COPYLEFT_PATTERN = /GPL/i;

function hasPackage(ecosystem: PackageEcosystem, name: string): boolean {
  return thirdPartyLicenses.some((license) =>
    license.packages.some(
      (pkg) => pkg.ecosystem === ecosystem && pkg.name === name,
    ),
  );
}

describe("third-party license list", () => {
  it("includes the core Rust crates and npm packages that ship in the app", () => {
    expect(hasPackage("cargo", "vtracer")).toBe(true);
    expect(hasPackage("cargo", "tauri")).toBe(true);
    expect(hasPackage("npm", "react")).toBe(true);
    expect(hasPackage("npm", "@tauri-apps/api")).toBe(true);
  });

  it("does not list the app's own crates", () => {
    expect(hasPackage("cargo", "svg-tracer")).toBe(false);
    expect(hasPackage("cargo", "tracer")).toBe(false);
  });

  it("gives every entry a license text and at least one package", () => {
    expect(thirdPartyLicenses.length).toBeGreaterThan(0);
    for (const license of thirdPartyLicenses) {
      expect(license.text.trim()).not.toBe("");
      expect(license.packages.length).toBeGreaterThan(0);
    }
  });

  it("contains no GPL-family license", () => {
    const ids = thirdPartyLicenses.map((license) => license.id);
    expect(ids.filter((id) => COPYLEFT_PATTERN.test(id))).toEqual([]);
  });
});

describe("parseThirdPartyLicenses", () => {
  it("rejects an entry with an unknown ecosystem", () => {
    expect(() =>
      parseThirdPartyLicenses({
        licenses: [
          {
            id: "MIT",
            name: "MIT License",
            text: "text",
            packages: [{ name: "x", version: "1.0.0", ecosystem: "pip" }],
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects data without a licenses array", () => {
    expect(() => parseThirdPartyLicenses({})).toThrow();
  });
});

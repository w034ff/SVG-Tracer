import rawLicenses from "./third-party-licenses.json";

export type PackageEcosystem = "cargo" | "npm";

export type LicensedPackage = {
  readonly name: string;
  readonly version: string;
  readonly ecosystem: PackageEcosystem;
};

/** One license text and every bundled package distributed under it. */
export type ThirdPartyLicense = {
  /** SPDX identifier, e.g. "MIT". */
  readonly id: string;
  readonly name: string;
  readonly text: string;
  readonly packages: readonly LicensedPackage[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePackage(value: unknown): LicensedPackage {
  if (
    isRecord(value) &&
    typeof value["name"] === "string" &&
    typeof value["version"] === "string" &&
    (value["ecosystem"] === "cargo" || value["ecosystem"] === "npm")
  ) {
    return {
      name: value["name"],
      version: value["version"],
      ecosystem: value["ecosystem"],
    };
  }
  throw new Error("Malformed package entry in third-party license list");
}

function parseLicense(value: unknown): ThirdPartyLicense {
  if (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    typeof value["name"] === "string" &&
    typeof value["text"] === "string" &&
    Array.isArray(value["packages"])
  ) {
    return {
      id: value["id"],
      name: value["name"],
      text: value["text"],
      packages: value["packages"].map(parsePackage),
    };
  }
  throw new Error("Malformed license entry in third-party license list");
}

/**
 * Validates the shape of the generated license list.
 *
 * @throws Error when the data does not match {@link ThirdPartyLicense}; the
 * file is produced by `npm run licenses:generate`, so this means the generator
 * and this module disagree.
 */
export function parseThirdPartyLicenses(
  value: unknown,
): readonly ThirdPartyLicense[] {
  if (isRecord(value) && Array.isArray(value["licenses"])) {
    return value["licenses"].map(parseLicense);
  }
  throw new Error("Malformed third-party license list");
}

/** Licenses of every Rust crate and npm package bundled in the app (NFR-05). */
export const thirdPartyLicenses: readonly ThirdPartyLicense[] =
  parseThirdPartyLicenses(rawLicenses);

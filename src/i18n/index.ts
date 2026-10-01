import { ja } from "./ja";
import { en } from "./en";

export type TranslationKeys = typeof ja;

// Enforce at compile-time that en and ja have identical key sets.
const _enMatchesJa: TranslationKeys = en;
const _jaMatchesEn: typeof en = ja;
void _enMatchesJa;
void _jaMatchesEn;

export type Language = "ja" | "en";

export const translations: Record<Language, TranslationKeys> = {
  ja,
  en,
};

/**
 * Resolves the initial UI language per design §8.4:
 * 1. Saved language from settings (if "ja" or "en").
 * 2. Otherwise, if the primary language in `navigator.languages` starts with "ja", use "ja".
 * 3. Otherwise, fallback to "en".
 */
export function resolveInitialLanguage(
  savedLanguage?: string | null,
  languages?: readonly string[],
): Language {
  if (savedLanguage === "ja" || savedLanguage === "en") {
    return savedLanguage;
  }
  if (languages && languages.length > 0) {
    const primary = languages[0];
    if (typeof primary === "string" && primary.toLowerCase().startsWith("ja")) {
      return "ja";
    }
  }
  return "en";
}

/**
 * Replaces `{name}` placeholders in `template` with values from `params`.
 */
export function formatMessage(
  template: string,
  params: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      return String(params[key]);
    }
    return match;
  });
}

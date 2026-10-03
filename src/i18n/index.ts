import { ja } from "./ja";
import { en } from "./en";
import type { ErrorCode } from "../ipc/generated/ErrorCode";
import type { IpcError } from "../ipc/generated/IpcError";
import type { Language } from "../ipc/generated/Language";

export type { Language };

export type TranslationKeys = typeof ja;

// Enforce at compile-time that en and ja have identical key sets.
const _enMatchesJa: TranslationKeys = en;
const _jaMatchesEn: typeof en = ja;
void _enMatchesJa;
void _jaMatchesEn;

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

const ERROR_MESSAGE_KEYS = {
  UnsupportedFormat: "errorUnsupportedFormat",
  DecodeFailed: "errorDecodeFailed",
  TooLarge: "errorTooLarge",
  ReadFailed: "errorReadFailed",
  WriteFailed: "errorWriteFailed",
  TraceFailed: "errorTraceFailed",
  Superseded: "errorSuperseded",
  BatchRunning: "errorBatchRunning",
  UnknownHandle: "errorUnknownHandle",
  InvalidParams: "errorInvalidParams",
} satisfies Record<ErrorCode, keyof TranslationKeys>;

/**
 * Returns localized error message for an IpcError per design §5.5.
 * If the message contains `{detail}`, interpolates the detail;
 * otherwise appends `: <detail>` if detail is present.
 */
export function getIpcErrorMessage(
  error: IpcError,
  t: TranslationKeys,
): string {
  const key = ERROR_MESSAGE_KEYS[error.code];
  const baseMessage = t[key];
  if (error.detail !== null && error.detail.length > 0) {
    if (baseMessage.includes("{detail}")) {
      return formatMessage(baseMessage, { detail: error.detail });
    }
    return `${baseMessage}: ${error.detail}`;
  }
  return baseMessage;
}

import type { Language } from "../i18n";
import { resolveInitialLanguage } from "../i18n";

export type LanguageState = {
  readonly language: Language;
  readonly savedLanguage: Language | null;
};

export type LanguageAction = {
  readonly type: "SET_LANGUAGE";
  readonly language: Language;
};

export function languageReducer(
  state: LanguageState,
  action: LanguageAction,
): LanguageState {
  switch (action.type) {
    case "SET_LANGUAGE":
      return { language: action.language, savedLanguage: action.language };
    default:
      return state;
  }
}

export function createInitialLanguageState(
  savedLanguage?: string | null,
  languages?: readonly string[],
): LanguageState {
  const validSavedLanguage: Language | null =
    savedLanguage === "ja" || savedLanguage === "en" ? savedLanguage : null;
  return {
    language: resolveInitialLanguage(savedLanguage, languages),
    savedLanguage: validSavedLanguage,
  };
}

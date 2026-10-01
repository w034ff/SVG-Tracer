import type { Language } from "../i18n";
import { resolveInitialLanguage } from "../i18n";

export type LanguageState = {
  language: Language;
};

export type LanguageAction = {
  type: "SET_LANGUAGE";
  language: Language;
};

export function languageReducer(
  state: LanguageState,
  action: LanguageAction,
): LanguageState {
  switch (action.type) {
    case "SET_LANGUAGE":
      return { ...state, language: action.language };
    default:
      return state;
  }
}

export function createInitialLanguageState(
  savedLanguage?: string | null,
  languages?: readonly string[],
): LanguageState {
  return {
    language: resolveInitialLanguage(savedLanguage, languages),
  };
}

import { createContext, useContext, type Dispatch } from "react";
import type { TranslationKeys } from "../i18n";
import type {
  BatchConversionAction,
  BatchConversionState,
} from "./batchConversion";
import type { LanguageAction, LanguageState } from "./language";
import type { ParamsAction, ParamsState } from "./params";
import type {
  SingleConversionAction,
  SingleConversionState,
} from "./singleConversion";

export type LanguageContextValue = {
  state: LanguageState;
  dispatch: Dispatch<LanguageAction>;
  t: TranslationKeys;
};

export const LanguageContext = createContext<LanguageContextValue | null>(null);

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
}

export type ParamsContextValue = {
  state: ParamsState;
  dispatch: Dispatch<ParamsAction>;
};

export const ParamsContext = createContext<ParamsContextValue | null>(null);

export function useParams(): ParamsContextValue {
  const context = useContext(ParamsContext);
  if (!context) {
    throw new Error("useParams must be used within a ParamsProvider");
  }
  return context;
}

export type SingleConversionContextValue = {
  state: SingleConversionState;
  dispatch: Dispatch<SingleConversionAction>;
};

export const SingleConversionContext =
  createContext<SingleConversionContextValue | null>(null);

export function useSingleConversion(): SingleConversionContextValue {
  const context = useContext(SingleConversionContext);
  if (!context) {
    throw new Error(
      "useSingleConversion must be used within a SingleConversionProvider",
    );
  }
  return context;
}

export type BatchConversionContextValue = {
  state: BatchConversionState;
  dispatch: Dispatch<BatchConversionAction>;
};

export const BatchConversionContext =
  createContext<BatchConversionContextValue | null>(null);

export function useBatchConversion(): BatchConversionContextValue {
  const context = useContext(BatchConversionContext);
  if (!context) {
    throw new Error(
      "useBatchConversion must be used within a BatchConversionProvider",
    );
  }
  return context;
}

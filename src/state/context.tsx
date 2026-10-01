import {
  useEffect,
  useReducer,
  type ReactElement,
  type ReactNode,
} from "react";
import type { Language } from "../i18n";
import { translations } from "../i18n";
import type { IpcError, ParamSpec } from "../ipc";
import { getParamSpec, normalizeIpcError } from "../ipc";
import {
  batchConversionReducer,
  createInitialBatchConversionState,
  type BatchConversionState,
} from "./batchConversion";
import {
  BatchConversionContext,
  LanguageContext,
  ParamsContext,
  SingleConversionContext,
} from "./contexts";
import { createInitialLanguageState, languageReducer } from "./language";
import { createInitialParamsState, paramsReducer } from "./params";
import {
  createInitialSingleConversionState,
  singleConversionReducer,
  type SingleConversionState,
} from "./singleConversion";

export function LanguageProvider({
  children,
  initialLanguage,
  savedLanguage,
  languages,
}: {
  children: ReactNode;
  initialLanguage?: Language;
  savedLanguage?: string | null;
  languages?: readonly string[];
}): ReactElement {
  const [state, dispatch] = useReducer(languageReducer, undefined, () =>
    initialLanguage
      ? { language: initialLanguage }
      : createInitialLanguageState(
          savedLanguage,
          languages ??
            (typeof navigator !== "undefined"
              ? navigator.languages
              : undefined),
        ),
  );

  const t = translations[state.language];

  return (
    <LanguageContext.Provider value={{ state, dispatch, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function ParamsProvider({
  children,
  initialSpec,
  initialError,
}: {
  children: ReactNode;
  initialSpec?: ParamSpec;
  initialError?: IpcError;
}): ReactElement {
  const [state, dispatch] = useReducer(
    paramsReducer,
    initialSpec ?? null,
    createInitialParamsState,
  );

  useEffect(() => {
    if (initialError) {
      dispatch({ type: "INIT_ERROR", error: initialError });
      return;
    }
    if (initialSpec) {
      return;
    }
    let isMounted = true;
    getParamSpec()
      .then((spec) => {
        if (isMounted) {
          dispatch({ type: "INIT_SPEC", spec });
        }
      })
      .catch((error: unknown) => {
        if (isMounted) {
          const normalized = normalizeIpcError(error);
          dispatch({ type: "INIT_ERROR", error: normalized });
        }
      });

    return () => {
      isMounted = false;
    };
  }, [initialSpec, initialError]);

  return (
    <ParamsContext.Provider value={{ state, dispatch }}>
      {children}
    </ParamsContext.Provider>
  );
}

export function SingleConversionProvider({
  children,
  initialState,
}: {
  children: ReactNode;
  initialState?: SingleConversionState;
}): ReactElement {
  const [state, dispatch] = useReducer(
    singleConversionReducer,
    initialState ?? createInitialSingleConversionState(),
  );

  return (
    <SingleConversionContext.Provider value={{ state, dispatch }}>
      {children}
    </SingleConversionContext.Provider>
  );
}

export function BatchConversionProvider({
  children,
  initialState,
}: {
  children: ReactNode;
  initialState?: BatchConversionState;
}): ReactElement {
  const [state, dispatch] = useReducer(
    batchConversionReducer,
    initialState ?? createInitialBatchConversionState(),
  );

  return (
    <BatchConversionContext.Provider value={{ state, dispatch }}>
      {children}
    </BatchConversionContext.Provider>
  );
}

export function AppProviders({
  children,
  initialSpec,
  initialLanguage,
  initialParamError,
}: {
  children: ReactNode;
  initialSpec?: ParamSpec;
  initialLanguage?: Language;
  initialParamError?: IpcError;
}): ReactElement {
  return (
    <LanguageProvider initialLanguage={initialLanguage}>
      <ParamsProvider
        initialSpec={initialSpec}
        initialError={initialParamError}
      >
        <SingleConversionProvider>
          <BatchConversionProvider>{children}</BatchConversionProvider>
        </SingleConversionProvider>
      </ParamsProvider>
    </LanguageProvider>
  );
}

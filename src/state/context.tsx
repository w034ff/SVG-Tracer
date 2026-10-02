import {
  useEffect,
  useReducer,
  type ReactElement,
  type ReactNode,
} from "react";
import type { Language } from "../i18n";
import { translations } from "../i18n";
import type {
  IpcError,
  ParamSpec,
  PickBatchInputResult,
  PickBatchOutputResult,
  TraceParams,
} from "../ipc";
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
import {
  createInitialParamsState,
  paramsReducer,
  type PresetSelection,
} from "./params";
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
  initialPreset,
  initialParams,
  initialError,
}: {
  children: ReactNode;
  initialSpec?: ParamSpec | null;
  initialPreset?: PresetSelection | null;
  initialParams?: TraceParams | null;
  initialError?: IpcError | null;
}): ReactElement {
  const [state, dispatch] = useReducer(paramsReducer, undefined, () =>
    createInitialParamsState(
      initialSpec,
      initialPreset,
      initialParams,
      initialError,
    ),
  );

  useEffect(() => {
    if (initialSpec || initialError) {
      return;
    }
    let isMounted = true;
    getParamSpec()
      .then((spec) => {
        if (isMounted) {
          dispatch({
            type: "INIT_SPEC",
            spec,
            initialPreset: initialPreset ?? undefined,
            initialParams: initialParams ?? undefined,
          });
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
  }, [initialSpec, initialError, initialPreset, initialParams]);

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
  initialInput,
  initialOutput,
}: {
  children: ReactNode;
  initialState?: BatchConversionState;
  initialInput?: PickBatchInputResult | null;
  initialOutput?: PickBatchOutputResult | null;
}): ReactElement {
  const [state, dispatch] = useReducer(
    batchConversionReducer,
    initialState ??
      createInitialBatchConversionState(initialInput, initialOutput),
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
  initialPreset,
  initialParams,
  initialBatchInput,
  initialBatchOutput,
  initialSpecError,
}: {
  children: ReactNode;
  initialSpec?: ParamSpec | null;
  initialLanguage?: Language;
  initialPreset?: PresetSelection | null;
  initialParams?: TraceParams | null;
  initialBatchInput?: PickBatchInputResult | null;
  initialBatchOutput?: PickBatchOutputResult | null;
  initialSpecError?: IpcError | null;
}): ReactElement {
  return (
    <LanguageProvider initialLanguage={initialLanguage}>
      <ParamsProvider
        initialSpec={initialSpec}
        initialPreset={initialPreset}
        initialParams={initialParams}
        initialError={initialSpecError}
      >
        <SingleConversionProvider>
          <BatchConversionProvider
            initialInput={initialBatchInput}
            initialOutput={initialBatchOutput}
          >
            {children}
          </BatchConversionProvider>
        </SingleConversionProvider>
      </ParamsProvider>
    </LanguageProvider>
  );
}

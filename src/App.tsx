import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
} from "react";
import { AboutDialog } from "./features/about/AboutDialog";
import { BatchConversionView } from "./features/batch/BatchConversionView";
import { ParamsPanel } from "./features/settings/ParamsPanel";
import { useSettingsAutoSave } from "./features/settings/useSettingsAutoSave";
import { SingleConversionView } from "./features/single/SingleConversionView";
import type { Language } from "./i18n";
import { resolveInitialLanguage } from "./i18n";
import {
  getParamSpec,
  getSettings,
  normalizeIpcError,
  onBatchFinished,
  onBatchItem,
  onBatchProgress,
  onImageDropped,
  type IpcError,
  type ParamSpec,
  type Settings,
  type UnlistenFn,
} from "./ipc";
import {
  AppProviders,
  useBatchConversion,
  useLanguage,
  useParams,
  useSingleConversion,
} from "./state";
import type { PresetSelection } from "./state/params";
import "./styles/app.css";

function AppContent(): ReactElement {
  const { t, state: langState, dispatch: langDispatch } = useLanguage();
  const { state: paramsState } = useParams();
  const { dispatch: singleDispatch } = useSingleConversion();
  const { state: batchState, dispatch: batchDispatch } = useBatchConversion();
  const [activeTab, setActiveTab] = useState<"single" | "batch">("single");

  // About dialog state and focus restoration ref
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const aboutButtonRef = useRef<HTMLButtonElement>(null);
  const prevAboutOpenRef = useRef(isAboutOpen);

  useEffect(() => {
    if (prevAboutOpenRef.current && !isAboutOpen) {
      aboutButtonRef.current?.focus();
    }
    prevAboutOpenRef.current = isAboutOpen;
  }, [isAboutOpen]);

  function handleOpenAbout(): void {
    setIsAboutOpen(true);
  }

  function handleCloseAbout(): void {
    setIsAboutOpen(false);
  }

  // Automatic debounced settings persistence per design §5.6
  useSettingsAutoSave({
    language: langState.language,
    preset: paramsState.preset,
    params: paramsState.params,
  });

  const isBatchActive =
    batchState.status === "running" || batchState.status === "cancelling";

  useEffect(() => {
    let unlistenPromise: Promise<UnlistenFn> | null = null;
    let isMounted = true;

    unlistenPromise = onImageDropped((payload) => {
      if (!isMounted) {
        return;
      }
      setActiveTab("single");
      if ("error" in payload) {
        singleDispatch({ type: "SET_ERROR", error: payload.error });
      } else {
        singleDispatch({
          type: "SET_IMAGE",
          image: { id: payload.id, name: payload.name },
        });
      }
    });

    return () => {
      isMounted = false;
      if (unlistenPromise) {
        void unlistenPromise
          .then((unlisten) => unlisten())
          .catch(() => {
            // Ignore unlisten errors on teardown
          });
      }
    };
  }, [singleDispatch]);

  useEffect(() => {
    let isMounted = true;
    const unlisteners: Promise<UnlistenFn>[] = [];

    unlisteners.push(
      onBatchProgress((payload) => {
        if (isMounted) {
          batchDispatch({ type: "UPDATE_PROGRESS", progress: payload });
        }
      }),
    );

    unlisteners.push(
      onBatchItem((payload) => {
        if (isMounted) {
          batchDispatch({ type: "ITEM_PROCESSED", item: payload });
        }
      }),
    );

    unlisteners.push(
      onBatchFinished((payload) => {
        if (isMounted) {
          batchDispatch({ type: "FINISH_BATCH", finished: payload });
        }
      }),
    );

    return () => {
      isMounted = false;
      for (const p of unlisteners) {
        void p
          .then((unlisten) => unlisten())
          .catch(() => {
            // Ignore unlisten errors on teardown
          });
      }
    };
  }, [batchDispatch]);

  function handleLanguageChange(event: ChangeEvent<HTMLSelectElement>): void {
    const nextLang = event.target.value;
    if (nextLang === "ja" || nextLang === "en") {
      langDispatch({ type: "SET_LANGUAGE", language: nextLang });
    }
  }

  return (
    <div className="app-shell">
      {/* Top bar header */}
      <header className="app-header">
        <div className="app-logo">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 20c4-12 12-12 16-16" />
            <circle cx="4" cy="20" r="2" />
            <circle cx="20" cy="4" r="2" />
          </svg>
          <span>{t.appTitle}</span>
        </div>

        <nav role="tablist" aria-label={t.mode} className="app-nav">
          <button
            id="tab-single"
            type="button"
            className="tab"
            role="tab"
            aria-selected={activeTab === "single"}
            aria-controls="panel-single"
            onClick={() => setActiveTab("single")}
          >
            {t.tabSingle}
          </button>
          <button
            id="tab-batch"
            type="button"
            className="tab"
            role="tab"
            aria-selected={activeTab === "batch"}
            aria-controls="panel-batch"
            onClick={() => setActiveTab("batch")}
          >
            {t.tabBatch}
          </button>
        </nav>

        <div className="app-spacer" />

        <select
          aria-label={t.language}
          value={langState.language}
          onChange={handleLanguageChange}
        >
          <option value="ja">{t.languageJa}</option>
          <option value="en">{t.languageEn}</option>
        </select>

        <button
          ref={aboutButtonRef}
          type="button"
          className="btn icon-btn"
          aria-label={t.about}
          onClick={handleOpenAbout}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleOpenAbout();
            }
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5" />
            <path d="M12 8h.01" />
          </svg>
        </button>
      </header>

      {/* Main layout: left parameter panel and active tab area */}
      <div className="app-body">
        <ParamsPanel disabled={isBatchActive} />
        <main className="app-main">
          <div
            id="panel-single"
            role="tabpanel"
            aria-labelledby="tab-single"
            hidden={activeTab !== "single"}
            className="tabpanel"
          >
            <SingleConversionView />
          </div>
          <div
            id="panel-batch"
            role="tabpanel"
            aria-labelledby="tab-batch"
            hidden={activeTab !== "batch"}
            className="tabpanel"
          >
            <BatchConversionView />
          </div>
        </main>
      </div>

      <AboutDialog isOpen={isAboutOpen} onClose={handleCloseAbout} />
    </div>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidSettings(value: unknown): value is Settings {
  if (!isRecord(value)) {
    return false;
  }
  return (
    "params" in value &&
    isRecord(value.params) &&
    "preset" in value &&
    "language" in value
  );
}

export type AppProps = {
  readonly initialSpec?: ParamSpec;
  readonly initialLanguage?: Language;
  readonly initialSettings?: Settings | null;
};

type InitData = {
  readonly isReady: boolean;
  readonly spec: ParamSpec | null;
  readonly specError: IpcError | null;
  readonly settings: Settings | null;
};

export function App({
  initialSpec,
  initialLanguage,
  initialSettings,
}: AppProps = {}): ReactElement | null {
  const isDirectMode = initialSpec !== undefined;

  const [initData, setInitData] = useState<InitData>(() => ({
    isReady: isDirectMode,
    spec: initialSpec ?? null,
    specError: null,
    settings: initialSettings ?? null,
  }));

  useEffect(() => {
    if (isDirectMode) {
      return;
    }

    let isMounted = true;

    const settingsPromise = getSettings()
      .then((res) => (isValidSettings(res) ? res : null))
      .catch(() => null);

    const specPromise = getParamSpec()
      .then((spec) => ({ spec, error: null }))
      .catch((err: unknown) => ({ spec: null, error: normalizeIpcError(err) }));

    Promise.all([settingsPromise, specPromise]).then(
      ([settings, specResult]) => {
        if (!isMounted) {
          return;
        }
        setInitData({
          isReady: true,
          spec: specResult.spec,
          specError: specResult.error,
          settings,
        });
      },
    );

    return () => {
      isMounted = false;
    };
  }, [isDirectMode]);

  // Do not render app body until both settings and param spec are retrieved per design §8.4
  if (!initData.isReady) {
    return <div className="app-shell" />;
  }

  // Resolve language: prop > saved setting > navigator.languages
  let resolvedLanguage: Language;
  if (initialLanguage) {
    resolvedLanguage = initialLanguage;
  } else if (
    initData.settings?.language === "ja" ||
    initData.settings?.language === "en"
  ) {
    resolvedLanguage = initData.settings.language;
  } else {
    resolvedLanguage = resolveInitialLanguage(null);
  }

  // Resolve preset: preset === null in settings represents "custom"
  let resolvedPreset: PresetSelection | undefined;
  if (initData.settings) {
    resolvedPreset =
      initData.settings.preset === null ? "custom" : initData.settings.preset;
  }

  const resolvedParams = initData.settings?.params ?? undefined;
  const resolvedBatchInput = initData.settings?.batchInput ?? null;
  const resolvedBatchOutput = initData.settings?.batchOutput ?? null;

  return (
    <AppProviders
      initialSpec={initData.spec}
      initialSpecError={initData.specError}
      initialLanguage={resolvedLanguage}
      initialPreset={resolvedPreset}
      initialParams={resolvedParams}
      initialBatchInput={resolvedBatchInput}
      initialBatchOutput={resolvedBatchOutput}
    >
      <AppContent />
    </AppProviders>
  );
}

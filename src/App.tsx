import { useState, type ChangeEvent, type ReactElement } from "react";
import { ParamsPanel } from "./features/settings/ParamsPanel";
import type { Language } from "./i18n";
import type { IpcError, ParamSpec } from "./ipc";
import { AppProviders, useLanguage } from "./state";
import "./styles/app.css";

function AppContent(): ReactElement {
  const { t, state: langState, dispatch: langDispatch } = useLanguage();
  const [activeTab, setActiveTab] = useState<"single" | "batch">("single");

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
            type="button"
            className="tab"
            role="tab"
            aria-selected={activeTab === "single"}
            onClick={() => setActiveTab("single")}
          >
            {t.tabSingle}
          </button>
          <button
            type="button"
            className="tab"
            role="tab"
            aria-selected={activeTab === "batch"}
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

        <button type="button" className="btn icon-btn" aria-label={t.about}>
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
        <ParamsPanel />
        <main
          className="app-main"
          role="tabpanel"
          aria-label={activeTab === "single" ? t.tabSingle : t.tabBatch}
        />
      </div>
    </div>
  );
}

export type AppProps = {
  initialSpec?: ParamSpec;
  initialLanguage?: Language;
  initialParamError?: IpcError;
};

export function App({
  initialSpec,
  initialLanguage,
  initialParamError,
}: AppProps = {}): ReactElement {
  return (
    <AppProviders
      initialSpec={initialSpec}
      initialLanguage={initialLanguage}
      initialParamError={initialParamError}
    >
      <AppContent />
    </AppProviders>
  );
}

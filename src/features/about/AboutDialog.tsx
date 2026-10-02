import { useEffect, useRef, useState, type ReactElement } from "react";
import appLicenseText from "../../../LICENSE?raw";
import { formatMessage } from "../../i18n";
import type { AboutInfo } from "../../ipc";
import { getAbout } from "../../ipc";
import type { ThirdPartyLicense } from "../../licenses";
import { useLanguage } from "../../state";

export type AboutDialogProps = {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly initialAbout?: AboutInfo;
};

export function AboutDialog({
  isOpen,
  onClose,
  initialAbout,
}: AboutDialogProps): ReactElement | null {
  const { t } = useLanguage();
  const [aboutInfo, setAboutInfo] = useState<AboutInfo | null>(
    initialAbout ?? null,
  );
  const [licenses, setLicenses] = useState<readonly ThirdPartyLicense[] | null>(
    null,
  );

  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    // Move focus inside dialog upon opening
    closeButtonRef.current?.focus();

    let isMounted = true;

    if (!initialAbout) {
      getAbout()
        .then((info) => {
          if (isMounted) {
            setAboutInfo(info);
          }
        })
        .catch(() => {
          // Fallback gracefully if about info cannot be loaded
        });
    }

    // Dynamically load third-party license catalog only when dialog is opened
    import("../../licenses")
      .then((mod) => {
        if (isMounted) {
          setLicenses(mod.thirdPartyLicenses);
        }
      })
      .catch(() => {
        // Fallback gracefully if license bundle cannot be loaded
      });

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      isMounted = false;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, initialAbout, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-dialog-title"
        className="modal-dialog"
      >
        <div className="modal-header">
          <h2 id="about-dialog-title" className="modal-title">
            {t.aboutTitle}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            className="btn icon-btn"
            aria-label={t.aboutClose}
            onClick={onClose}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="modal-body">
          <div className="about-app-info">
            <div className="about-app-name">{t.appTitle}</div>
            {aboutInfo !== null && (
              <div className="about-version">
                {formatMessage(t.aboutVersion, { version: aboutInfo.version })}
              </div>
            )}
          </div>

          <section className="about-section">
            <h3 className="about-section-title">{t.aboutAppLicense}</h3>
            <pre className="license-box">{appLicenseText}</pre>
          </section>

          <section className="about-section">
            <h3 className="about-section-title">{t.aboutThirdPartyLicenses}</h3>
            {licenses === null ? (
              <div className="about-loading">{t.aboutLoadingLicenses}</div>
            ) : (
              <div className="about-licenses-list">
                {licenses.map((license, licenseIndex) => (
                  <div
                    key={`${license.id}-${licenseIndex}`}
                    className="license-item"
                  >
                    <div className="license-item-header">{license.name}</div>
                    <ul className="license-packages">
                      {license.packages.map((pkg, pkgIndex) => (
                        <li
                          key={`${pkg.ecosystem}-${pkg.name}-${pkg.version}-${pkgIndex}`}
                        >
                          {pkg.name} {pkg.version}
                        </li>
                      ))}
                    </ul>
                    <details className="license-details">
                      <summary>{t.aboutViewLicenseText}</summary>
                      <pre className="license-box">{license.text}</pre>
                    </details>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>
            {t.aboutClose}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef } from "react";
import type { Language, Preset, TraceParams } from "../../ipc";
import { saveSettings } from "../../ipc";
import type { PresetSelection } from "../../state/params";
import { SETTINGS_SAVE_DEBOUNCE_MS } from "./constants";

export type SettingsAutoSaveInput = {
  readonly language: Language;
  readonly preset: PresetSelection;
  readonly params: TraceParams | null;
};

/**
 * Automatically debounces and persists settings changes via `save_settings` per design §5.6.
 *
 * - Does not trigger during initial mount / startup restoration.
 * - Debounces rapid changes within {@link SETTINGS_SAVE_DEBOUNCE_MS}.
 * - Transforms "custom" preset to `null`.
 * - Silently catches and ignores save errors (non-blocking Should requirement).
 */
export function useSettingsAutoSave({
  language,
  preset,
  params,
}: SettingsAutoSaveInput): void {
  const isInitialMount = useRef(true);
  const prevSavedRef = useRef<{
    language: Language;
    preset: PresetSelection;
    params: TraceParams | null;
  }>({
    language,
    preset,
    params,
  });

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      prevSavedRef.current = {
        language,
        preset,
        params,
      };
      return;
    }

    if (!params) {
      return;
    }

    const langChanged = language !== prevSavedRef.current.language;
    const presetChanged = preset !== prevSavedRef.current.preset;
    const paramsChanged = params !== prevSavedRef.current.params;

    if (!langChanged && !presetChanged && !paramsChanged) {
      return;
    }

    const timer = setTimeout(() => {
      const presetToSend: Preset | null = preset === "custom" ? null : preset;
      prevSavedRef.current = {
        language,
        preset,
        params,
      };

      saveSettings(language, presetToSend, params).catch(() => {
        // Silently ignore save failures per FR-07 (Should requirement)
      });
    }, SETTINGS_SAVE_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [language, preset, params]);
}

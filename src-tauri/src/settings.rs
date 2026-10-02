//! Application settings management and persistence per design §5.6.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tracer::{Preset, TraceParams};
use ts_rs::TS;

use crate::batch::{PickBatchInputResult, PickBatchOutputResult};
use crate::error::{ErrorCode, IpcError};

/// Current schema version for the settings file per design §5.6.
pub const SCHEMA_VERSION: u32 = 1;

/// Filename of the settings file on disk per design §5.6.
pub const SETTINGS_FILE_NAME: &str = "settings.json";

/// Supported UI languages per design §5.6 and §8.4.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    Ja,
    En,
}

/// Persistent settings structure stored on disk in `settings.json` per design §5.6.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsFile {
    /// Schema version for future format migrations.
    pub schema_version: u32,
    /// Selected UI language, or None for system/unconfigured default.
    pub language: Option<Language>,
    /// Selected preset name, or None for custom parameters.
    pub preset: Option<Preset>,
    /// Vectorization parameters.
    pub params: TraceParams,
    /// Absolute path of input directory for batch conversion, kept on Rust side.
    pub batch_input_dir: Option<PathBuf>,
    /// Absolute path of output directory for batch conversion, kept on Rust side.
    pub batch_output_dir: Option<PathBuf>,
}

impl Default for SettingsFile {
    /// Returns default settings with ColorLogo preset per design §4.5 and §5.6.
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            language: None,
            preset: Some(Preset::ColorLogo),
            params: Preset::ColorLogo.params(),
            batch_input_dir: None,
            batch_output_dir: None,
        }
    }
}

/// Settings payload returned to the frontend via `get_settings` per design §5.6 and §6.1.
///
/// Contains no filesystem paths: `batch_input` and `batch_output` contain only
/// display labels and enumeration summaries.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// Selected UI language, or None for system/unconfigured default.
    pub language: Option<Language>,
    /// Selected preset name, or None for custom parameters.
    pub preset: Option<Preset>,
    /// Vectorization parameters.
    pub params: TraceParams,
    /// Re-enumerated batch input summary, or None if unselected.
    pub batch_input: Option<PickBatchInputResult>,
    /// Batch output directory label, or None if unselected.
    pub batch_output: Option<PickBatchOutputResult>,
}

/// Application version information returned by `get_about` per design §6.1.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AboutInfo {
    /// Application semantic version string from package metadata.
    pub version: String,
}

/// Parses JSON text into [`SettingsFile`] using resilient per-field decoding per design §5.6.
///
/// - Malformed JSON or unknown `schemaVersion` returns default settings.
/// - Unknown `preset` or out-of-bounds `params` resets both `preset` and `params`
///   to their defaults (ColorLogo) while preserving `language` and directory paths.
pub fn parse_settings_json(json_str: &str) -> SettingsFile {
    let Ok(val) = serde_json::from_str::<serde_json::Value>(json_str) else {
        return SettingsFile::default();
    };

    let Some(obj) = val.as_object() else {
        return SettingsFile::default();
    };

    // Schema version check: must be a number matching SCHEMA_VERSION exactly
    let Some(schema_version) = obj.get("schemaVersion").and_then(|v| v.as_u64()) else {
        return SettingsFile::default();
    };
    if schema_version != SCHEMA_VERSION as u64 {
        return SettingsFile::default();
    }

    // Language check: parse as Language enum, falling back to None if unknown/null
    let language = obj
        .get("language")
        .and_then(|v| serde_json::from_value::<Language>(v.clone()).ok());

    // Preset & Params check:
    // If preset is unknown or params is out of range, reset both to defaults per design §5.6.
    let preset_result: Result<Option<Preset>, ()> = match obj.get("preset") {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(v) => serde_json::from_value::<Preset>(v.clone())
            .map(Some)
            .map_err(|_| ()),
    };

    let params_result: Result<TraceParams, ()> = match obj.get("params") {
        Some(v) => serde_json::from_value::<TraceParams>(v.clone())
            .map_err(|_| ())
            .and_then(|p| p.validate().map(|()| p).map_err(|_| ())),
        None => Err(()),
    };

    let (preset, params) = match (preset_result, params_result) {
        (Ok(preset), Ok(params)) => (preset, params),
        _ => (Some(Preset::ColorLogo), Preset::ColorLogo.params()),
    };

    // Batch input and output directories (kept as paths on Rust side)
    let batch_input_dir = obj
        .get("batchInputDir")
        .and_then(|v| v.as_str())
        .map(PathBuf::from);

    let batch_output_dir = obj
        .get("batchOutputDir")
        .and_then(|v| v.as_str())
        .map(PathBuf::from);

    SettingsFile {
        schema_version: SCHEMA_VERSION,
        language,
        preset,
        params,
        batch_input_dir,
        batch_output_dir,
    }
}

/// Loads and validates settings from the given directory per design §5.6.
///
/// If `settings.json` is missing or fails to parse, default settings are returned.
/// If saved directory paths do not exist as directories on disk, they are reset to `None`.
pub fn load_settings(config_dir: &Path) -> SettingsFile {
    let file_path = config_dir.join(SETTINGS_FILE_NAME);
    if !file_path.is_file() {
        return SettingsFile::default();
    }

    let mut settings = match std::fs::read_to_string(&file_path) {
        Ok(content) => parse_settings_json(&content),
        Err(_) => SettingsFile::default(),
    };

    // Folder existence verification: reset to None if path does not exist as a directory
    if let Some(ref dir) = settings.batch_input_dir
        && !dir.is_dir()
    {
        settings.batch_input_dir = None;
    }
    if let Some(ref dir) = settings.batch_output_dir
        && !dir.is_dir()
    {
        settings.batch_output_dir = None;
    }

    settings
}

/// Atomically writes settings to `settings.json` inside `config_dir` per design §5.4 and §5.6.
///
/// Writes to a temporary file first and atomically persists it over `settings.json`.
pub fn save_settings_to_dir(config_dir: &Path, settings: &SettingsFile) -> Result<(), IpcError> {
    std::fs::create_dir_all(config_dir).map_err(|e| {
        IpcError::new(
            ErrorCode::WriteFailed,
            format!("Failed to create config directory: {e}"),
        )
    })?;

    let json_bytes = serde_json::to_vec_pretty(settings).map_err(|e| {
        IpcError::new(
            ErrorCode::WriteFailed,
            format!("Failed to serialize settings: {e}"),
        )
    })?;

    let mut temp = tempfile::NamedTempFile::new_in(config_dir).map_err(|e| {
        IpcError::new(
            ErrorCode::WriteFailed,
            format!("Failed to create temporary settings file: {e}"),
        )
    })?;

    use std::io::Write;
    temp.write_all(&json_bytes).map_err(|e| {
        IpcError::new(
            ErrorCode::WriteFailed,
            format!("Failed to write settings content: {e}"),
        )
    })?;
    temp.flush().map_err(|e| {
        IpcError::new(
            ErrorCode::WriteFailed,
            format!("Failed to flush settings file: {e}"),
        )
    })?;

    let dest = config_dir.join(SETTINGS_FILE_NAME);
    temp.persist(&dest).map_err(|e| {
        IpcError::new(
            ErrorCode::WriteFailed,
            format!("Failed to persist settings file: {}", e.error),
        )
    })?;

    Ok(())
}

/// Thread-safe in-memory manager for application settings per design §5.6.
#[derive(Debug, Default)]
pub struct SettingsManager {
    /// Directory where `settings.json` is stored, or None in unconfigured test environments.
    pub config_dir: Mutex<Option<PathBuf>>,
    /// In-memory copy of the settings file.
    pub file: Mutex<SettingsFile>,
}

impl SettingsManager {
    /// Creates a new settings manager with explicit config directory and initial file content.
    pub fn new(config_dir: PathBuf, file: SettingsFile) -> Self {
        Self {
            config_dir: Mutex::new(Some(config_dir)),
            file: Mutex::new(file),
        }
    }

    /// Mutates the in-memory settings file and attempts to persist to disk while holding the lock.
    fn update_folder_and_persist<F>(&self, update: F)
    where
        F: FnOnce(&mut SettingsFile),
    {
        let mut file = self
            .file
            .lock()
            .expect("settings file mutex should not be poisoned");
        update(&mut file);
        let config_dir = self
            .config_dir
            .lock()
            .expect("config_dir mutex should not be poisoned")
            .clone();
        if let Some(dir) = config_dir {
            let _ = save_settings_to_dir(&dir, &file);
        }
    }

    /// Records batch input directory selection and attempts to persist to disk.
    ///
    /// Persistence errors are intentionally ignored per design §5.6 (Should requirement).
    pub fn record_batch_input(&self, path: PathBuf) {
        self.update_folder_and_persist(|file| {
            file.batch_input_dir = Some(path);
        });
    }

    /// Records batch output directory selection and attempts to persist to disk.
    ///
    /// Persistence errors are intentionally ignored per design §5.6 (Should requirement).
    pub fn record_batch_output(&self, path: PathBuf) {
        self.update_folder_and_persist(|file| {
            file.batch_output_dir = Some(path);
        });
    }

    /// Saves trace settings to memory and persists them to disk while holding the settings lock.
    pub fn save_settings(
        &self,
        language: Option<Language>,
        preset: Option<Preset>,
        params: TraceParams,
    ) -> Result<(), IpcError> {
        let mut file = self
            .file
            .lock()
            .expect("settings file mutex should not be poisoned");
        file.language = language;
        file.preset = preset;
        file.params = params;

        let config_dir = self
            .config_dir
            .lock()
            .expect("config_dir mutex should not be poisoned")
            .clone();
        if let Some(dir) = config_dir {
            save_settings_to_dir(&dir, &file)?;
        }
        Ok(())
    }
}

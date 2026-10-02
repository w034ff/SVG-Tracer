//! IPC commands and parameter specifications per design §4.5, §5.1, §5.5, §6.1.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::Ordering;

use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tauri_plugin_dialog::DialogExt;
use tracer::{
    COLOR_PRECISION_MAX, COLOR_PRECISION_MIN, CORNER_THRESHOLD_MAX, CORNER_THRESHOLD_MIN,
    FILTER_SPECKLE_MAX, FILTER_SPECKLE_MIN, LAYER_DIFFERENCE_MAX, LAYER_DIFFERENCE_MIN,
    LENGTH_THRESHOLD_MAX, LENGTH_THRESHOLD_MIN, PATH_PRECISION_MAX, PATH_PRECISION_MIN, Preset,
    SPLICE_THRESHOLD_MAX, SPLICE_THRESHOLD_MIN, SUPPORTED_EXTENSIONS, TraceParams,
};
use ts_rs::TS;

use crate::AppState;
use crate::batch::{
    BatchFinishedPayload, BatchItemPayload, BatchProgressPayload, PickBatchInputResult,
    PickBatchOutputResult,
};
use crate::error::{ErrorCode, IpcError};
use crate::settings::{AboutInfo, Language, Settings};

/// Integer range specification with minimum and maximum values.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct IntRange {
    pub min: i32,
    pub max: i32,
}

/// Floating-point range specification with minimum and maximum values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FloatRange {
    pub min: f64,
    pub max: f64,
}

/// Boundary specifications for all customizable trace parameters per design §4.5.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ParamRanges {
    pub color_precision: IntRange,
    pub filter_speckle: IntRange,
    pub corner_threshold: IntRange,
    pub layer_difference: IntRange,
    pub length_threshold: FloatRange,
    pub splice_threshold: IntRange,
    pub path_precision: IntRange,
}

/// Specification of a single preset and its trace parameters.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PresetSpec {
    pub id: Preset,
    pub params: TraceParams,
}

/// Full parameter specification returned by [`get_param_spec`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ParamSpec {
    pub ranges: ParamRanges,
    pub presets: Vec<PresetSpec>,
    pub default_preset: Preset,
}

/// Response payload from [`pick_image`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PickedImage {
    pub id: String,
    pub name: String,
}

/// Vectorization output and execution statistics returned by [`convert`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ConvertResult {
    /// Formatted SVG string.
    pub svg: String,
    /// Number of path elements in the SVG.
    pub path_count: usize,
    /// Size of the generated SVG in bytes.
    pub bytes: usize,
    /// Time taken to vectorize the image in milliseconds.
    #[ts(type = "number")]
    pub elapsed_ms: u32,
}

/// Result returned by [`save_svg`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SaveSvgResult {
    pub saved_name: String,
}

/// Event payload emitted for `image-dropped` per design §6.2.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(untagged)]
pub enum ImageDroppedPayload {
    Success { id: String, name: String },
    Error { error: IpcError },
}

/// Returns parameter limits and preset definitions per design §4.5 and §6.1.
#[tauri::command]
pub fn get_param_spec() -> ParamSpec {
    ParamSpec {
        ranges: ParamRanges {
            color_precision: IntRange {
                min: COLOR_PRECISION_MIN,
                max: COLOR_PRECISION_MAX,
            },
            filter_speckle: IntRange {
                min: FILTER_SPECKLE_MIN as i32,
                max: FILTER_SPECKLE_MAX as i32,
            },
            corner_threshold: IntRange {
                min: CORNER_THRESHOLD_MIN,
                max: CORNER_THRESHOLD_MAX,
            },
            layer_difference: IntRange {
                min: LAYER_DIFFERENCE_MIN,
                max: LAYER_DIFFERENCE_MAX,
            },
            length_threshold: FloatRange {
                min: LENGTH_THRESHOLD_MIN,
                max: LENGTH_THRESHOLD_MAX,
            },
            splice_threshold: IntRange {
                min: SPLICE_THRESHOLD_MIN,
                max: SPLICE_THRESHOLD_MAX,
            },
            path_precision: IntRange {
                min: PATH_PRECISION_MIN as i32,
                max: PATH_PRECISION_MAX as i32,
            },
        },
        presets: Preset::all()
            .iter()
            .map(|&p| PresetSpec {
                id: p,
                params: p.params(),
            })
            .collect(),
        default_preset: Preset::ColorLogo,
    }
}

/// Returns current application settings without exposing absolute filesystem paths per design §5.6 and §6.1.
#[tauri::command]
pub fn get_settings(state: tauri::State<'_, AppState>) -> Settings {
    get_settings_internal(state.inner())
}

/// Internal implementation of `get_settings` decoupled from `tauri::State`.
pub fn get_settings_internal(state: &AppState) -> Settings {
    let (language, preset, params) = {
        let file = state
            .settings
            .file
            .lock()
            .expect("settings file mutex should not be poisoned");
        (file.language, file.preset, file.params.clone())
    };

    let batch_input = {
        let input_guard = state
            .batch
            .input_dir
            .lock()
            .expect("input_dir mutex should not be poisoned");
        match *input_guard {
            Some(ref path) if path.is_dir() => match crate::batch::enumerate_targets(path) {
                Ok((targets, ignored_count)) => {
                    let dir_label = crate::batch::extract_dir_label(path);
                    Some(PickBatchInputResult {
                        dir_label,
                        targets,
                        ignored_count,
                    })
                }
                Err(_) => None,
            },
            _ => None,
        }
    };

    let batch_output = {
        let output_guard = state
            .batch
            .output_dir
            .lock()
            .expect("output_dir mutex should not be poisoned");
        match *output_guard {
            Some(ref path) if path.is_dir() => {
                let dir_label = crate::batch::extract_dir_label(path);
                Some(PickBatchOutputResult { dir_label })
            }
            _ => None,
        }
    };

    Settings {
        language,
        preset,
        params,
        batch_input,
        batch_output,
    }
}

/// Saves application settings per design §4.5, §5.6, and §6.1.
///
/// Validates parameters via [`TraceParams::validate`] before saving.
/// Preserves existing directory paths from in-memory state.
#[tauri::command]
pub async fn save_settings(
    language: Option<Language>,
    preset: Option<Preset>,
    params: TraceParams,
    state: tauri::State<'_, AppState>,
) -> Result<(), IpcError> {
    save_settings_internal(language, preset, params, state.inner())
}

/// Internal implementation of `save_settings` decoupled from `tauri::State`.
pub fn save_settings_internal(
    language: Option<Language>,
    preset: Option<Preset>,
    params: TraceParams,
    state: &AppState,
) -> Result<(), IpcError> {
    params.validate()?;
    state.settings.save_settings(language, preset, params)
}

/// Returns application package version information per design §6.1.
#[tauri::command]
pub fn get_about(app: tauri::AppHandle) -> AboutInfo {
    get_about_internal(app.package_info().version.to_string())
}

/// Internal implementation of `get_about` returning version info.
pub fn get_about_internal(version: String) -> AboutInfo {
    AboutInfo { version }
}

/// Opens an OS file picker for selecting an image and registers its path.
///
/// Returns the opaque handle ID and display name, or `None` if dismissed.
#[tauri::command]
pub async fn pick_image(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Option<PickedImage>, IpcError> {
    let file_path = app
        .dialog()
        .file()
        .add_filter("Images", SUPPORTED_EXTENSIONS)
        .blocking_pick_file();

    let Some(file_path) = file_path else {
        return Ok(None);
    };

    let path_buf = file_path
        .into_path()
        .map_err(|e| IpcError::new(ErrorCode::ReadFailed, format!("{e:?}")))?;

    let (id, name) = state.handles.register(path_buf);
    Ok(Some(PickedImage { id, name }))
}

/// Decodes the image corresponding to the given handle ID and returns its PNG preview bytes.
///
/// Conforms to design §6.1: returns raw bytes wrapped in [`tauri::ipc::Response`].
#[tauri::command]
pub async fn load_preview(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<tauri::ipc::Response, IpcError> {
    let bytes = load_preview_internal(&id, state.inner()).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Internal implementation of `load_preview` decoupled from [`tauri::State`].
pub async fn load_preview_internal(id: &str, state: &AppState) -> Result<Vec<u8>, IpcError> {
    let handle = state
        .handles
        .get(id)
        .ok_or_else(|| IpcError::from_code(ErrorCode::UnknownHandle))?;

    if let Some(preview_png) = handle.preview_png {
        return Ok(preview_png.to_vec());
    }

    let handles_ref = Arc::clone(&state.handles);
    let id_clone = id.to_string();
    let path = handle.path.clone();

    let png_bytes = tauri::async_runtime::spawn_blocking(move || -> Result<Arc<[u8]>, IpcError> {
        let image = match handle.image {
            Some(img) => img,
            None => {
                let loaded = tracer::load_image(&path)?;
                Arc::new(loaded)
            }
        };

        let bytes = tracer::encode_png(&image)?;
        let arc_bytes: Arc<[u8]> = Arc::from(bytes.into_boxed_slice());
        handles_ref.set_image_and_preview(&id_clone, image, Arc::clone(&arc_bytes));
        Ok(arc_bytes)
    })
    .await
    .map_err(|e| IpcError::new(ErrorCode::DecodeFailed, e.to_string()))??;

    Ok(png_bytes.to_vec())
}

/// Converts the image for the specified handle into SVG per design §5.1.
///
/// Rejects conversion with [`ErrorCode::Superseded`] if a newer request (`seq`) arrives
/// before or during conversion execution.
#[tauri::command]
pub async fn convert(
    id: String,
    params: TraceParams,
    seq: u64,
    state: tauri::State<'_, AppState>,
) -> Result<ConvertResult, IpcError> {
    convert_internal(id, params, seq, state.inner()).await
}

/// Internal implementation of `convert` decoupled from [`tauri::State`].
pub async fn convert_internal(
    id: String,
    params: TraceParams,
    seq: u64,
    state: &AppState,
) -> Result<ConvertResult, IpcError> {
    params.validate()?;

    let prev = state.latest_seq.fetch_max(seq, Ordering::SeqCst);
    let current_max = prev.max(seq);
    if seq < current_max {
        return Err(IpcError::from_code(ErrorCode::Superseded));
    }

    let handle = state
        .handles
        .get(&id)
        .ok_or_else(|| IpcError::from_code(ErrorCode::UnknownHandle))?;

    let image = match handle.image {
        Some(img) => img,
        None => {
            let path = handle.path.clone();
            let loaded = tauri::async_runtime::spawn_blocking(move || tracer::load_image(&path))
                .await
                .map_err(|e| IpcError::new(ErrorCode::ReadFailed, e.to_string()))??;
            let arc_img = Arc::new(loaded);
            state.handles.set_image(&id, Arc::clone(&arc_img));
            arc_img
        }
    };

    if seq < state.latest_seq.load(Ordering::SeqCst) {
        return Err(IpcError::from_code(ErrorCode::Superseded));
    }

    let latest_seq_ref = Arc::clone(&state.latest_seq);
    let handles_ref = Arc::clone(&state.handles);
    let id_clone = id.clone();

    let result =
        tauri::async_runtime::spawn_blocking(move || -> Result<ConvertResult, IpcError> {
            if seq < latest_seq_ref.load(Ordering::SeqCst) {
                return Err(IpcError::from_code(ErrorCode::Superseded));
            }

            let start = std::time::Instant::now();
            let output = tracer::trace(&image, &params)?;
            let elapsed_ms = start.elapsed().as_millis() as u32;
            let bytes = output.svg.len();

            if seq < latest_seq_ref.load(Ordering::SeqCst) {
                return Err(IpcError::from_code(ErrorCode::Superseded));
            }

            let arc_svg: Arc<str> = Arc::from(output.svg.as_str());
            handles_ref.set_last_svg(&id_clone, arc_svg);

            Ok(ConvertResult {
                svg: output.svg,
                path_count: output.path_count,
                bytes,
                elapsed_ms,
            })
        })
        .await
        .map_err(|e| IpcError::new(ErrorCode::TraceFailed, e.to_string()))??;

    Ok(result)
}

/// Prompts the user with a save file dialog and writes the most recent SVG output.
///
/// Writes atomically using a temporary file in the destination folder per design §5.4.
#[tauri::command]
pub async fn save_svg(
    id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Option<SaveSvgResult>, IpcError> {
    let handle = state
        .handles
        .get(&id)
        .ok_or_else(|| IpcError::from_code(ErrorCode::UnknownHandle))?;

    let svg = handle.last_svg.ok_or_else(|| {
        IpcError::new(ErrorCode::WriteFailed, "No converted SVG available to save")
    })?;

    let default_stem = Path::new(&handle.name)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "image".to_string());
    let default_name = format!("{default_stem}.svg");

    let file_path = app
        .dialog()
        .file()
        .add_filter("SVG", &["svg"])
        .set_file_name(&default_name)
        .blocking_save_file();

    let Some(file_path) = file_path else {
        return Ok(None);
    };

    let dest_path = file_path
        .into_path()
        .map_err(|e| IpcError::new(ErrorCode::WriteFailed, format!("{e:?}")))?;

    let parent_dir = dest_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| Path::new(".").to_path_buf());

    let saved_name = dest_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or(default_name);

    tauri::async_runtime::spawn_blocking(move || -> Result<(), IpcError> {
        use std::io::Write;
        let mut temp = tempfile::NamedTempFile::new_in(&parent_dir)
            .map_err(|e| IpcError::new(ErrorCode::WriteFailed, e.to_string()))?;
        temp.write_all(svg.as_bytes())
            .map_err(|e| IpcError::new(ErrorCode::WriteFailed, e.to_string()))?;
        temp.flush()
            .map_err(|e| IpcError::new(ErrorCode::WriteFailed, e.to_string()))?;
        temp.persist(&dest_path)
            .map_err(|e| IpcError::new(ErrorCode::WriteFailed, e.error.to_string()))?;
        Ok(())
    })
    .await
    .map_err(|e| IpcError::new(ErrorCode::WriteFailed, e.to_string()))??;

    Ok(Some(SaveSvgResult { saved_name }))
}

/// Opens an OS folder picker for selecting the batch input folder per design §5.2 and §6.1.
#[tauri::command]
pub async fn pick_batch_input(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Option<PickBatchInputResult>, IpcError> {
    let folder_path = app.dialog().file().blocking_pick_folder();

    let Some(folder_path) = folder_path else {
        return Ok(None);
    };

    let path_buf = folder_path
        .into_path()
        .map_err(|e| IpcError::new(ErrorCode::ReadFailed, format!("{e:?}")))?;

    let result = pick_batch_input_internal(path_buf, state.inner())?;
    Ok(Some(result))
}

/// Internal helper for selecting batch input directory and recording it in settings per design §5.6.
pub fn pick_batch_input_internal(
    path: PathBuf,
    state: &AppState,
) -> Result<PickBatchInputResult, IpcError> {
    let result = crate::batch::select_batch_input_internal(path.clone(), &state.batch)?;
    state.settings.record_batch_input(path);
    Ok(result)
}

/// Opens an OS folder picker for selecting the batch output folder per design §5.2 and §6.1.
#[tauri::command]
pub async fn pick_batch_output(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Option<PickBatchOutputResult>, IpcError> {
    let folder_path = app.dialog().file().blocking_pick_folder();

    let Some(folder_path) = folder_path else {
        return Ok(None);
    };

    let path_buf = folder_path
        .into_path()
        .map_err(|e| IpcError::new(ErrorCode::ReadFailed, format!("{e:?}")))?;

    let result = pick_batch_output_internal(path_buf, state.inner());
    Ok(Some(result))
}

/// Internal helper for selecting batch output directory and recording it in settings per design §5.6.
pub fn pick_batch_output_internal(path: PathBuf, state: &AppState) -> PickBatchOutputResult {
    let result = crate::batch::select_batch_output_internal(path.clone(), &state.batch);
    state.settings.record_batch_output(path);
    result
}

/// Initiates batch conversion in a background thread per design §5.2 and §6.1.
#[tauri::command]
pub fn start_batch(
    params: TraceParams,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), IpcError> {
    let app_for_progress = app.clone();
    let on_progress = move |payload: BatchProgressPayload| {
        let _ = app_for_progress.emit("batch-progress", &payload);
    };

    let app_for_item = app.clone();
    let on_item = move |payload: BatchItemPayload| {
        let _ = app_for_item.emit("batch-item", &payload);
    };

    let app_for_finished = app.clone();
    let on_finished = move |payload: BatchFinishedPayload| {
        let _ = app_for_finished.emit("batch-finished", &payload);
    };

    let callbacks = crate::batch::BatchCallbacks {
        on_progress,
        on_item,
        on_finished,
    };

    crate::batch::start_batch_internal(params, &state.batch, callbacks)
}

/// Signals cancellation for any executing batch conversion per design §5.4 and §6.1.
#[tauri::command]
pub fn cancel_batch(state: tauri::State<'_, AppState>) -> Result<(), IpcError> {
    state.batch.cancel_flag.store(true, Ordering::SeqCst);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_param_spec_matches_design() {
        let spec = get_param_spec();
        assert_eq!(spec.ranges.color_precision.min, 1);
        assert_eq!(spec.ranges.color_precision.max, 8);
        assert_eq!(spec.ranges.filter_speckle.min, 0);
        assert_eq!(spec.ranges.filter_speckle.max, 16);
        assert_eq!(spec.ranges.corner_threshold.min, 0);
        assert_eq!(spec.ranges.corner_threshold.max, 180);
        assert_eq!(spec.ranges.layer_difference.min, 0);
        assert_eq!(spec.ranges.layer_difference.max, 128);
        assert_eq!(spec.ranges.length_threshold.min, 3.5);
        assert_eq!(spec.ranges.length_threshold.max, 10.0);
        assert_eq!(spec.ranges.splice_threshold.min, 0);
        assert_eq!(spec.ranges.splice_threshold.max, 180);
        assert_eq!(spec.ranges.path_precision.min, 0);
        assert_eq!(spec.ranges.path_precision.max, 8);

        assert_eq!(spec.presets.len(), 3);
        assert_eq!(spec.default_preset, Preset::ColorLogo);
    }
}

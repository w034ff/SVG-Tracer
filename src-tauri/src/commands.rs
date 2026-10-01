//! IPC commands and parameter specifications per design §4.5, §5.1, §5.5, §6.1.

use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::Ordering;

use serde::{Deserialize, Serialize};
use tauri_plugin_dialog::DialogExt;
use tracer::{
    COLOR_PRECISION_MAX, COLOR_PRECISION_MIN, CORNER_THRESHOLD_MAX, CORNER_THRESHOLD_MIN,
    FILTER_SPECKLE_MAX, FILTER_SPECKLE_MIN, LAYER_DIFFERENCE_MAX, LAYER_DIFFERENCE_MIN,
    LENGTH_THRESHOLD_MAX, LENGTH_THRESHOLD_MIN, PATH_PRECISION_MAX, PATH_PRECISION_MIN, Preset,
    SPLICE_THRESHOLD_MAX, SPLICE_THRESHOLD_MIN, SUPPORTED_EXTENSIONS, TraceParams,
};
use ts_rs::TS;

use crate::AppState;
use crate::error::{ErrorCode, IpcError};

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
    pub elapsed_ms: u64,
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
        return Ok(preview_png);
    }

    let handles_ref = Arc::clone(&state.handles);
    let id_clone = id.to_string();
    let path = handle.path.clone();

    let png_bytes = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, IpcError> {
        let image = match handle.image {
            Some(img) => img,
            None => {
                let loaded = tracer::load_image(&path)?;
                Arc::new(loaded)
            }
        };

        let bytes = tracer::encode_png(&image)?;
        handles_ref.set_image_and_preview(&id_clone, image, bytes.clone());
        Ok(bytes)
    })
    .await
    .map_err(|e| IpcError::new(ErrorCode::DecodeFailed, e.to_string()))??;

    Ok(png_bytes)
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
            let elapsed_ms = start.elapsed().as_millis() as u64;
            let bytes = output.svg.len();

            if seq < latest_seq_ref.load(Ordering::SeqCst) {
                return Err(IpcError::from_code(ErrorCode::Superseded));
            }

            handles_ref.set_last_svg(&id_clone, output.svg.clone());

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

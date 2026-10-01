//! Application library entry point and runtime configuration.

use std::sync::Arc;
use std::sync::atomic::AtomicU64;

use tauri::{Emitter, Manager};
use tracer::SUPPORTED_EXTENSIONS;

pub mod commands;
pub mod error;
pub mod handles;

/// Shared application state managed across Tauri commands.
#[derive(Debug, Default)]
pub struct AppState {
    /// In-memory table mapping opaque handle IDs to file paths.
    pub handles: Arc<handles::HandleStore>,
    /// Global conversion request sequence counter for tracking Superseded requests per design §5.1.
    pub latest_seq: Arc<AtomicU64>,
}

/// Runs the Tauri application.
///
/// # Panics
///
/// Panics if Tauri initialization fails.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::get_param_spec,
            commands::pick_image,
            commands::load_preview,
            commands::convert,
            commands::save_svg,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                let state = window.state::<AppState>();
                let payload = handle_drag_drop_event(paths, &state);
                #[cfg(debug_assertions)]
                if let commands::ImageDroppedPayload::Success { ref id, ref name } = payload {
                    eprintln!("[debug] DragDrop: name={}, id={}", name, id);
                }
                let _ = window.emit("image-dropped", &payload);
            }
        })
        .run(tauri::generate_context!())
        .expect("Tauri context and runtime initialization must succeed");
}

/// Processes dropped file paths and returns the payload to emit for `image-dropped`.
///
/// If multiple files are dropped, selects the first supported file per design §6.2.
/// If no supported file is dropped, returns an error payload with [`error::ErrorCode::UnsupportedFormat`].
pub fn handle_drag_drop_event(
    paths: &[std::path::PathBuf],
    state: &AppState,
) -> commands::ImageDroppedPayload {
    let supported = paths.iter().find(|p| {
        p.extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| {
                let lower = ext.to_lowercase();
                SUPPORTED_EXTENSIONS.iter().any(|&s| s == lower)
            })
            .unwrap_or(false)
    });

    match supported {
        Some(path) => {
            let (id, name) = state.handles.register(path.clone());
            commands::ImageDroppedPayload::Success { id, name }
        }
        None => commands::ImageDroppedPayload::Error {
            error: error::IpcError::from_code(error::ErrorCode::UnsupportedFormat),
        },
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    #[test]
    fn test_drag_drop_single_supported_file() {
        let state = AppState::default();
        let paths = vec![PathBuf::from("/path/to/my_icon.png")];

        let payload = handle_drag_drop_event(&paths, &state);
        match payload {
            commands::ImageDroppedPayload::Success { id, name } => {
                assert_eq!(name, "my_icon.png");
                let handle = state.handles.get(&id).expect("handle must be registered");
                assert_eq!(handle.name, "my_icon.png");
            }
            commands::ImageDroppedPayload::Error { .. } => {
                panic!("Expected Success payload for supported image drop");
            }
        }
    }

    #[test]
    fn test_drag_drop_multiple_files_selects_first_supported() {
        let state = AppState::default();
        let paths = vec![
            PathBuf::from("/path/to/readme.txt"),
            PathBuf::from("/path/to/diagram.pdf"),
            PathBuf::from("/path/to/logo.webp"),
            PathBuf::from("/path/to/second.png"),
        ];

        let payload = handle_drag_drop_event(&paths, &state);
        match payload {
            commands::ImageDroppedPayload::Success { id, name } => {
                assert_eq!(name, "logo.webp");
                let handle = state.handles.get(&id).expect("handle must be registered");
                assert_eq!(handle.name, "logo.webp");
            }
            commands::ImageDroppedPayload::Error { .. } => {
                panic!("Expected Success payload selecting first supported file");
            }
        }
    }

    #[test]
    fn test_drag_drop_no_supported_files_returns_unsupported_format() {
        let state = AppState::default();
        let paths = vec![
            PathBuf::from("/path/to/notes.txt"),
            PathBuf::from("/path/to/archive.zip"),
        ];

        let payload = handle_drag_drop_event(&paths, &state);
        match payload {
            commands::ImageDroppedPayload::Error { error } => {
                assert_eq!(error.code, error::ErrorCode::UnsupportedFormat);
            }
            commands::ImageDroppedPayload::Success { .. } => {
                panic!("Expected Error payload for unsupported file drop");
            }
        }
    }

    #[test]
    fn test_drag_drop_empty_paths_returns_unsupported_format() {
        let state = AppState::default();
        let paths = vec![];

        let payload = handle_drag_drop_event(&paths, &state);
        match payload {
            commands::ImageDroppedPayload::Error { error } => {
                assert_eq!(error.code, error::ErrorCode::UnsupportedFormat);
            }
            commands::ImageDroppedPayload::Success { .. } => {
                panic!("Expected Error payload for empty drop paths");
            }
        }
    }
}

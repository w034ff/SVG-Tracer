//! Application library entry point.

/// Runs the Tauri application.
///
/// # Panics
///
/// Panics if Tauri initialization fails.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("Tauri context and runtime initialization must succeed");
}

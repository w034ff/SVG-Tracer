//! In-memory table for mapping file paths to opaque handle IDs per design §1 and §6.1.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use tracer::RgbaImage;

/// An image handle representing an imported file and its associated cached assets.
#[derive(Debug, Clone)]
pub struct ImageHandle {
    /// Opaque handle ID exposed to the frontend.
    pub id: String,
    /// Absolute filesystem path held strictly within Rust.
    pub path: PathBuf,
    /// User-facing file name (e.g. `logo.png`).
    pub name: String,
    /// Decoded image buffer, cached to avoid re-decoding from disk on parameter tweaks.
    pub image: Option<Arc<RgbaImage>>,
    /// Pre-rendered PNG preview binary bytes, returned to frontend via `load_preview`.
    pub preview_png: Option<Vec<u8>>,
    /// Most recent vectorization result SVG string, written to disk by `save_svg`.
    pub last_svg: Option<String>,
}

/// Thread-safe storage for active image handles.
#[derive(Debug, Default)]
pub struct HandleStore {
    handles: Mutex<HashMap<String, ImageHandle>>,
    counter: AtomicU64,
}

impl HandleStore {
    /// Creates an empty handle store.
    pub fn new() -> Self {
        Self::default()
    }

    /// Registers a file path and returns its opaque handle ID and display name.
    pub fn register(&self, path: PathBuf) -> (String, String) {
        let id_num = self.counter.fetch_add(1, Ordering::Relaxed);
        let id = format!("handle-{id_num}");

        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "image".to_string());

        let handle = ImageHandle {
            id: id.clone(),
            path,
            name: name.clone(),
            image: None,
            preview_png: None,
            last_svg: None,
        };

        let mut map = self
            .handles
            .lock()
            .expect("HandleStore mutex should not be poisoned");
        map.insert(id.clone(), handle);

        (id, name)
    }

    /// Retrieves a clone of the image handle with the specified ID, if it exists.
    pub fn get(&self, id: &str) -> Option<ImageHandle> {
        let map = self
            .handles
            .lock()
            .expect("HandleStore mutex should not be poisoned");
        map.get(id).cloned()
    }

    /// Updates the cached decoded image for a handle.
    pub fn set_image(&self, id: &str, image: Arc<RgbaImage>) -> bool {
        let mut map = self
            .handles
            .lock()
            .expect("HandleStore mutex should not be poisoned");
        if let Some(handle) = map.get_mut(id) {
            handle.image = Some(image);
            true
        } else {
            false
        }
    }

    /// Updates both the cached decoded image and PNG preview bytes for a handle.
    pub fn set_image_and_preview(
        &self,
        id: &str,
        image: Arc<RgbaImage>,
        preview_png: Vec<u8>,
    ) -> bool {
        let mut map = self
            .handles
            .lock()
            .expect("HandleStore mutex should not be poisoned");
        if let Some(handle) = map.get_mut(id) {
            handle.image = Some(image);
            handle.preview_png = Some(preview_png);
            true
        } else {
            false
        }
    }

    /// Updates the most recent SVG output string for a handle.
    pub fn set_last_svg(&self, id: &str, svg: String) -> bool {
        let mut map = self
            .handles
            .lock()
            .expect("HandleStore mutex should not be poisoned");
        if let Some(handle) = map.get_mut(id) {
            handle.last_svg = Some(svg);
            true
        } else {
            false
        }
    }

    /// Clears all stored handles (for tests).
    #[cfg(test)]
    pub fn clear(&self) {
        let mut map = self
            .handles
            .lock()
            .expect("HandleStore mutex should not be poisoned");
        map.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_register_and_get() {
        let store = HandleStore::new();
        let path = PathBuf::from("/test/path/my_logo.png");
        let (id, name) = store.register(path.clone());

        assert_eq!(name, "my_logo.png");
        assert!(id.starts_with("handle-"));

        let handle = store.get(&id).expect("handle should exist");
        assert_eq!(handle.id, id);
        assert_eq!(handle.path, path);
        assert_eq!(handle.name, "my_logo.png");
        assert!(handle.image.is_none());
        assert!(handle.preview_png.is_none());
        assert!(handle.last_svg.is_none());
    }

    #[test]
    fn test_unknown_handle_returns_none() {
        let store = HandleStore::new();
        assert!(store.get("non-existent").is_none());
    }

    #[test]
    fn test_set_last_svg() {
        let store = HandleStore::new();
        let (id, _) = store.register(PathBuf::from("/test/img.png"));

        let svg_data = "<svg>test</svg>".to_string();
        assert!(store.set_last_svg(&id, svg_data.clone()));

        let handle = store.get(&id).expect("handle exists");
        assert_eq!(handle.last_svg, Some(svg_data));

        assert!(!store.set_last_svg("unknown-id", "<svg></svg>".into()));
    }
}

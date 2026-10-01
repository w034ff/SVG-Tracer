//! Image tracing and vector conversion logic.

pub mod decode;
pub mod error;

pub use decode::{MAX_PIXELS, SUPPORTED_EXTENSIONS, load_image};
pub use error::TraceError;

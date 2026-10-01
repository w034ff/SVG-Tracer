//! Error types for tracer operations.

use std::fmt;

/// Errors that can occur during image loading and decoding.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TraceError {
    /// The image format is not supported.
    UnsupportedFormat,
    /// Failed to decode the image.
    DecodeFailed,
    /// Image pixel count exceeds the maximum limit.
    TooLarge,
    /// Failed to read the image file.
    ReadFailed,
}

impl fmt::Display for TraceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnsupportedFormat => write!(f, "Unsupported image format"),
            Self::DecodeFailed => write!(f, "Failed to decode image"),
            Self::TooLarge => write!(f, "Image pixel count exceeds maximum limit"),
            Self::ReadFailed => write!(f, "Failed to read image file"),
        }
    }
}

impl std::error::Error for TraceError {}

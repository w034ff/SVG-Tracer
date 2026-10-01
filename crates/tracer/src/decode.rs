//! Image decoding and format detection logic.

use std::fs::File;
use std::io::BufReader;
use std::path::Path;

use image::{DynamicImage, ImageDecoder, ImageError, ImageFormat, ImageReader, Limits, RgbaImage};

use crate::error::TraceError;

/// Supported file extensions (lowercase, without leading dot).
pub const SUPPORTED_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "bmp", "gif"];

/// Maximum allowed pixel count (width * height). Equivalent to 4096 * 4096.
pub const MAX_PIXELS: u64 = 16_777_216;

/// Maximum dimension (width or height) allowed by the image decoder limits.
const MAX_DIMENSION: u32 = MAX_PIXELS as u32;

/// Maximum memory allocation (bytes) allowed during decoding as a decompression bomb defense.
/// 16_777_216 pixels * 4 bytes/pixel (RGBA8) = 64 MiB; 256 MiB provides sufficient headroom.
const MAX_ALLOC_BYTES: u64 = 256 * 1024 * 1024;

/// Loads an image from the specified path, verifies format and dimensions,
/// and returns an RGBA image.
///
/// Format detection is performed by inspecting file content (magic bytes) rather than
/// relying on file extensions. For animated images (e.g., GIF), the first frame is returned.
/// Dimensions are checked against `MAX_PIXELS` before full decoding to prevent large memory
/// allocations.
///
/// # Errors
///
/// Returns:
/// - [`TraceError::ReadFailed`] if the file cannot be opened or the initial format detection read fails.
/// - [`TraceError::UnsupportedFormat`] if the file content format cannot be determined
///   or is not among the supported formats.
/// - [`TraceError::TooLarge`] if the image pixel count exceeds [`MAX_PIXELS`] or decoding
///   limits are exceeded.
/// - [`TraceError::DecodeFailed`] if image decoding fails, dimensions are invalid, or data is truncated/corrupt.
pub fn load_image(path: &Path) -> Result<RgbaImage, TraceError> {
    let file = File::open(path).map_err(|e| TraceError::ReadFailed(e.to_string()))?;
    let buffered = BufReader::new(file);

    // Initialize reader without inferring format from path extension,
    // ensuring content-based detection.
    let reader = ImageReader::new(buffered);
    let mut reader = reader
        .with_guessed_format()
        .map_err(|e| TraceError::ReadFailed(e.to_string()))?;

    let format = reader.format().ok_or(TraceError::UnsupportedFormat)?;

    match format {
        ImageFormat::Png
        | ImageFormat::Jpeg
        | ImageFormat::WebP
        | ImageFormat::Bmp
        | ImageFormat::Gif => {}
        _ => return Err(TraceError::UnsupportedFormat),
    }

    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_DIMENSION);
    limits.max_image_height = Some(MAX_DIMENSION);
    limits.max_alloc = Some(MAX_ALLOC_BYTES);
    reader.limits(limits);

    let decoder = reader.into_decoder().map_err(map_image_error)?;

    let (width, height) = decoder.dimensions();
    if width == 0 || height == 0 {
        return Err(TraceError::DecodeFailed);
    }

    let pixels = (width as u64).saturating_mul(height as u64);
    if pixels > MAX_PIXELS {
        return Err(TraceError::TooLarge);
    }

    let dynamic_image = DynamicImage::from_decoder(decoder).map_err(map_image_error)?;

    Ok(dynamic_image.to_rgba8())
}

/// Maps an `image::ImageError` encountered during decoding to the corresponding `TraceError`.
///
/// I/O errors occurring during decoding (e.g. truncated files) represent corrupt image data
/// and are classified as `DecodeFailed`.
fn map_image_error(err: ImageError) -> TraceError {
    match err {
        ImageError::Limits(_) => TraceError::TooLarge,
        ImageError::Unsupported(_) => TraceError::UnsupportedFormat,
        _ => TraceError::DecodeFailed,
    }
}

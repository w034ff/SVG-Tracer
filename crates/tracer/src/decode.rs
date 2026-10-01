//! Image decoding and format detection logic.

use std::fs::File;
use std::io::{BufRead, BufReader};
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
/// - [`TraceError::ReadFailed`] if the file cannot be opened or read.
/// - [`TraceError::UnsupportedFormat`] if the file content format cannot be determined
///   or is not among the supported formats.
/// - [`TraceError::TooLarge`] if the image pixel count exceeds [`MAX_PIXELS`] or decoding
///   limits are exceeded.
/// - [`TraceError::DecodeFailed`] if image decoding fails or dimensions are invalid.
pub fn load_image(path: &Path) -> Result<RgbaImage, TraceError> {
    let file = File::open(path).map_err(|_| TraceError::ReadFailed)?;
    let mut buffered = BufReader::new(file);

    // Early dimension check for PNG from the header without requiring full image chunks.
    // This detects excessive dimensions before any decoding allocation occurs.
    let peek_buf = buffered.fill_buf().map_err(|_| TraceError::ReadFailed)?;
    if let Some((width, height)) = peek_png_dimensions(peek_buf) {
        let pixels = (width as u64).saturating_mul(height as u64);
        if pixels > MAX_PIXELS {
            return Err(TraceError::TooLarge);
        }
    }

    // Initialize reader without inferring format from path extension,
    // ensuring content-based detection.
    let reader = ImageReader::new(buffered);
    let mut reader = reader
        .with_guessed_format()
        .map_err(|_| TraceError::ReadFailed)?;

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

/// Peeks image dimensions from a PNG header if available in the buffer.
///
/// Returns `Some((width, height))` if the buffer contains a valid PNG signature
/// and IHDR chunk header with non-zero dimensions.
fn peek_png_dimensions(buffer: &[u8]) -> Option<(u32, u32)> {
    const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
    if buffer.len() >= 24 && &buffer[..8] == PNG_SIGNATURE && &buffer[12..16] == b"IHDR" {
        let width = u32::from_be_bytes(buffer[16..20].try_into().ok()?);
        let height = u32::from_be_bytes(buffer[20..24].try_into().ok()?);
        if width > 0 && height > 0 {
            return Some((width, height));
        }
    }
    None
}

/// Maps an `image::ImageError` to the corresponding `TraceError`.
fn map_image_error(err: ImageError) -> TraceError {
    match err {
        ImageError::Limits(_) => TraceError::TooLarge,
        ImageError::Unsupported(_) => TraceError::UnsupportedFormat,
        ImageError::IoError(_) => TraceError::ReadFailed,
        _ => TraceError::DecodeFailed,
    }
}

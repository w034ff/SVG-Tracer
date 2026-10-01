use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use tracer::{MAX_PIXELS, SUPPORTED_EXTENSIONS, TraceError, load_image};

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
}

/// Helper struct that removes a temporary file upon drop.
struct TempFileGuard(PathBuf);

impl Drop for TempFileGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

/// Computes the standard CRC-32 checksum used by PNG.
fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for &byte in data {
        crc ^= u32::from(byte);
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
        }
    }
    !crc
}

/// Generates a valid header-only PNG file (PNG signature + IHDR chunk + empty IDAT chunk + IEND chunk)
/// without any decompressed image data. The total size is around 45 bytes.
fn create_header_only_png(width: u32, height: u32) -> (TempFileGuard, PathBuf) {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let id = COUNTER.fetch_add(1, Ordering::Relaxed);
    let filename = format!("test_header_only_{}_{}.png", std::process::id(), id);
    let path = std::env::temp_dir().join(filename);

    let mut bytes = Vec::with_capacity(64);
    // 1. PNG Signature (8 bytes)
    bytes.extend_from_slice(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

    // 2. IHDR Chunk (Length: 13 bytes, Type: "IHDR", Data: 13 bytes, CRC: 4 bytes)
    let mut ihdr_data = Vec::with_capacity(13);
    ihdr_data.extend_from_slice(&width.to_be_bytes());
    ihdr_data.extend_from_slice(&height.to_be_bytes());
    ihdr_data.push(8); // Bit depth: 8
    ihdr_data.push(6); // Color type: 6 (RGBA)
    ihdr_data.push(0); // Compression method: deflate
    ihdr_data.push(0); // Filter method: standard
    ihdr_data.push(0); // Interlace method: none

    let ihdr_length = 13u32;
    bytes.extend_from_slice(&ihdr_length.to_be_bytes());
    let mut ihdr_type_and_data = Vec::with_capacity(17);
    ihdr_type_and_data.extend_from_slice(b"IHDR");
    ihdr_type_and_data.extend_from_slice(&ihdr_data);
    let ihdr_crc = crc32(&ihdr_type_and_data);
    bytes.extend_from_slice(&ihdr_type_and_data);
    bytes.extend_from_slice(&ihdr_crc.to_be_bytes());

    // 3. IDAT Chunk with length 0 (Length: 0, Type: "IDAT", CRC: 4 bytes)
    bytes.extend_from_slice(&0u32.to_be_bytes());
    bytes.extend_from_slice(b"IDAT");
    let idat_crc = crc32(b"IDAT");
    bytes.extend_from_slice(&idat_crc.to_be_bytes());

    // 4. IEND Chunk (Length: 0, Type: "IEND", CRC: 4 bytes)
    bytes.extend_from_slice(&0u32.to_be_bytes());
    bytes.extend_from_slice(b"IEND");
    let iend_crc = crc32(b"IEND");
    bytes.extend_from_slice(&iend_crc.to_be_bytes());

    std::fs::write(&path, &bytes).expect("Failed to write temporary test PNG file");

    (TempFileGuard(path.clone()), path)
}

#[test]
fn test_supported_extensions_and_max_pixels() {
    assert_eq!(MAX_PIXELS, 16_777_216);
    assert_eq!(
        SUPPORTED_EXTENSIONS,
        &["png", "jpg", "jpeg", "webp", "bmp", "gif"]
    );
}

#[test]
fn test_load_all_supported_format_fixtures() {
    let dir = fixtures_dir();

    // Verify 5 primary formats with 1024x1024 dimensions
    let cases = [
        ("logo_color.png", 1024, 1024),
        ("logo_color.jpg", 1024, 1024),
        ("logo_color.webp", 1024, 1024),
        ("logo_color.bmp", 1024, 1024),
        ("logo_color.gif", 1024, 1024),
        ("logo_small_transparency.png", 512, 512),
        ("icon_mono.png", 256, 256),
        ("icon_mono_transparent.png", 256, 256),
    ];

    for (file_name, expected_w, expected_h) in cases {
        let path = dir.join(file_name);
        let img = load_image(&path)
            .unwrap_or_else(|e| panic!("Failed to load fixture {file_name}: {e:?}"));
        assert_eq!(
            img.width(),
            expected_w,
            "Width mismatch for fixture {file_name}"
        );
        assert_eq!(
            img.height(),
            expected_h,
            "Height mismatch for fixture {file_name}"
        );
    }
}

#[test]
fn test_load_animated_gif_uses_first_frame() {
    let path = fixtures_dir().join("anim.gif");
    let img = load_image(&path).expect("Failed to load anim.gif");

    assert_eq!(img.width(), 128);
    assert_eq!(img.height(), 128);

    // In anim.gif:
    // Frame 1 has a Red circle ([229, 57, 53]) on Blue background ([30, 136, 229]).
    // Frame 2 has a Yellow circle ([255, 238, 88]) on Green background ([67, 160, 71]).
    // Center pixel (64, 64) must be predominantly Red.
    let center = img.get_pixel(64, 64);
    assert!(
        center[0] > 200 && center[1] < 100 && center[2] < 100,
        "Center pixel in anim.gif must be Frame 1 Red, got: {:?}",
        center
    );

    // Corner pixel (0, 0) must be predominantly Blue.
    let corner = img.get_pixel(0, 0);
    assert!(
        corner[0] < 50 && corner[1] > 100 && corner[2] > 200,
        "Corner pixel in anim.gif must be Frame 1 Blue, got: {:?}",
        corner
    );
}

#[test]
fn test_corrupt_file_returns_decode_failed() {
    let path = fixtures_dir().join("corrupt.png");
    let result = load_image(&path);
    assert_eq!(result, Err(TraceError::DecodeFailed));
}

#[test]
fn test_not_image_returns_unsupported_format() {
    let path = fixtures_dir().join("not_image.png");
    let result = load_image(&path);
    assert_eq!(result, Err(TraceError::UnsupportedFormat));
}

#[test]
fn test_nonexistent_file_returns_read_failed_with_detail() {
    let nonexistent_path = Path::new("tests/fixtures/does_not_exist_12345.png");
    let result = load_image(nonexistent_path);
    match result {
        Err(TraceError::ReadFailed(detail)) => {
            assert!(
                !detail.is_empty(),
                "ReadFailed should contain OS error message detail"
            );
        }
        other => panic!("Expected Err(TraceError::ReadFailed(_)), got: {other:?}"),
    }
}

#[test]
fn test_truncated_files_return_decode_failed() {
    let dir = fixtures_dir();

    // Truncated PNG: first 100 bytes of logo_color.png (valid signature & IHDR, cut mid-data)
    let png_bytes =
        std::fs::read(dir.join("logo_color.png")).expect("Failed to read logo_color.png");
    let truncated_png_path =
        std::env::temp_dir().join(format!("test_trunc_{}.png", std::process::id()));
    std::fs::write(&truncated_png_path, &png_bytes[..100]).expect("Failed to write truncated PNG");
    let _png_guard = TempFileGuard(truncated_png_path.clone());

    let png_result = load_image(&truncated_png_path);
    assert_eq!(png_result, Err(TraceError::DecodeFailed));

    // Truncated BMP: first 100 bytes of logo_color.bmp
    let bmp_bytes =
        std::fs::read(dir.join("logo_color.bmp")).expect("Failed to read logo_color.bmp");
    let truncated_bmp_path =
        std::env::temp_dir().join(format!("test_trunc_{}.bmp", std::process::id()));
    std::fs::write(&truncated_bmp_path, &bmp_bytes[..100]).expect("Failed to write truncated BMP");
    let _bmp_guard = TempFileGuard(truncated_bmp_path.clone());

    let bmp_result = load_image(&truncated_bmp_path);
    assert_eq!(bmp_result, Err(TraceError::DecodeFailed));
}

#[test]
fn test_too_large_detected_before_decode_without_large_allocation() {
    // 5000 x 5000 = 25,000,000 pixels > MAX_PIXELS (16_777_216).
    // The test file contains only the PNG signature, IHDR, empty IDAT, and IEND chunks (~45 bytes).
    // There are NO decompressed image data chunks.
    // If full decoding were attempted, it would fail or allocate large buffers.
    // The dimension check before DynamicImage::from_decoder detects TooLarge.
    let (_guard, path) = create_header_only_png(5000, 5000);

    let metadata = std::fs::metadata(&path).expect("Failed to get temp file metadata");
    assert!(
        metadata.len() < 100,
        "Test file must be small (header-only), was {} bytes",
        metadata.len()
    );

    let result = load_image(&path);
    assert_eq!(result, Err(TraceError::TooLarge));
}

#[test]
fn test_max_pixels_boundary_check() {
    // 4096 * 4096 = 16_777_216 (exactly MAX_PIXELS).
    // Not exceeding MAX_PIXELS, so it proceeds to decoding, and fails with DecodeFailed
    // because there is no decompressed pixel data.
    let (_guard_exact, path_exact) = create_header_only_png(4096, 4096);
    let result_exact = load_image(&path_exact);
    assert_eq!(result_exact, Err(TraceError::DecodeFailed));

    // 4097 * 4096 = 16_781_312 (> MAX_PIXELS).
    // Exceeds MAX_PIXELS, so it is rejected early with TooLarge before decoding.
    let (_guard_over, path_over) = create_header_only_png(4097, 4096);
    let result_over = load_image(&path_over);
    assert_eq!(result_over, Err(TraceError::TooLarge));
}

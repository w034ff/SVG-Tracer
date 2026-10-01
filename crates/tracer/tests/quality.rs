//! Quality tests for vectorization per design §9.2 and work-plan T03.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use image::RgbaImage;
use resvg::tiny_skia::{Color, Pixmap, Transform};
use resvg::usvg::{Options, Tree};
use tracer::{ALPHA_THRESHOLD, ColorMode, Preset, apply_p1, apply_p3, trace};

/// Color distance tolerance per design §9.2.
const COLOR_TOLERANCE: i16 = 32;

/// Maximum allowed mismatch ratio (2%) per design §9.2.
const MAX_MISMATCH_RATIO: f64 = 0.02;

/// Helper to load a fixture from crates/tracer/tests/fixtures/.
fn load_fixture(name: &str) -> RgbaImage {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let fixture_path = manifest_dir.join("tests").join("fixtures").join(name);
    image::open(&fixture_path)
        .unwrap_or_else(|e| panic!("Failed to open fixture {}: {e}", fixture_path.display()))
        .to_rgba8()
}

/// Rasterizes an SVG string onto a pixmap using resvg per design §9.2.
///
/// If `bg_color` is provided (e.g. `Color::WHITE` for binary mode), the canvas
/// is filled before rendering. Otherwise, it remains transparent.
fn rasterize_svg(
    svg: &str,
    width: u32,
    height: u32,
    bg_color: Option<Color>,
) -> Result<RgbaImage, String> {
    let opt = Options::default();
    let tree = Tree::from_str(svg, &opt).map_err(|e| format!("SVG parse error: {e:?}"))?;
    let mut pixmap =
        Pixmap::new(width, height).ok_or_else(|| "Failed to allocate pixmap".to_string())?;

    if let Some(color) = bg_color {
        pixmap.fill(color);
    }

    resvg::render(&tree, Transform::default(), &mut pixmap.as_mut());

    // Convert premultiplied RGBA from tiny_skia to unpremultiplied RgbaImage
    let mut img = RgbaImage::new(width, height);
    let data = pixmap.data();
    for y in 0..height {
        for x in 0..width {
            let idx = ((y * width + x) * 4) as usize;
            let a = data[idx + 3];
            let (r, g, b) = if a == 0 {
                (0, 0, 0)
            } else if a == 255 {
                (data[idx], data[idx + 1], data[idx + 2])
            } else {
                let alpha_f = f32::from(a) / 255.0;
                (
                    (f32::from(data[idx]) / alpha_f).round().clamp(0.0, 255.0) as u8,
                    (f32::from(data[idx + 1]) / alpha_f)
                        .round()
                        .clamp(0.0, 255.0) as u8,
                    (f32::from(data[idx + 2]) / alpha_f)
                        .round()
                        .clamp(0.0, 255.0) as u8,
                )
            };
            img.put_pixel(x, y, image::Rgba([r, g, b, a]));
        }
    }
    Ok(img)
}

/// Computes pixel mismatch count and ratio between reference image and rendered SVG per design §9.2.
fn compute_mismatch(reference: &RgbaImage, rendered: &RgbaImage) -> (usize, f64) {
    let width = reference.width();
    let height = reference.height();
    let total = (width * height) as usize;
    let mut mismatches = 0;

    for y in 0..height {
        for x in 0..width {
            let ref_p = reference.get_pixel(x, y);
            let ren_p = rendered.get_pixel(x, y);

            let ref_trans = ref_p[3] < ALPHA_THRESHOLD;
            let ren_trans = ren_p[3] < ALPHA_THRESHOLD;

            if ref_trans != ren_trans {
                mismatches += 1;
            } else if !ref_trans {
                let diff_r = (i16::from(ref_p[0]) - i16::from(ren_p[0])).abs();
                let diff_g = (i16::from(ref_p[1]) - i16::from(ren_p[1])).abs();
                let diff_b = (i16::from(ref_p[2]) - i16::from(ren_p[2])).abs();
                if diff_r > COLOR_TOLERANCE || diff_g > COLOR_TOLERANCE || diff_b > COLOR_TOLERANCE
                {
                    mismatches += 1;
                }
            }
        }
    }

    let ratio = mismatches as f64 / total as f64;
    (mismatches, ratio)
}

/// Verifies that the SVG output meets structural and XML validity requirements per design §4.4.
fn verify_svg_structure(svg: &str, width: u32, height: u32, has_p2_margin: bool) {
    // 1. Must not contain <image> elements (NFR-03)
    assert!(!svg.contains("<image"), "SVG must not contain <image> tags");

    // 2. Must be valid XML
    let opt = Options::default();
    assert!(
        Tree::from_str(svg, &opt).is_ok(),
        "SVG must be valid XML and parseable by usvg"
    );

    // 3. Must match dimensions and viewBox per §4.4
    let expected_x = if has_p2_margin { 1 } else { 0 };
    let expected_y = if has_p2_margin { 1 } else { 0 };
    let expected_root = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="{expected_x} {expected_y} {width} {height}">"#
    );
    assert!(
        svg.contains(&expected_root),
        "SVG root element mismatch. Expected to contain: {expected_root}"
    );
}

/// Runs quality verification for a single fixture and preset combination per design §9.2.
fn run_quality_check(fixture_name: &str, preset: Preset) {
    let img = load_fixture(fixture_name);
    let params = preset.params();
    let output =
        trace(&img, &params).unwrap_or_else(|e| panic!("Trace failed for {fixture_name}: {e}"));

    // Determine if P2 margin was expected
    let has_p2_margin =
        matches!(params.color_mode, ColorMode::Color) && apply_p1(&img).pixels().any(|p| p[3] == 0);

    verify_svg_structure(&output.svg, img.width(), img.height(), has_p2_margin);

    let (reference, bg_color) = match params.color_mode {
        ColorMode::Color => {
            // Color mode: rasterize onto transparent canvas and compare with P1-applied original
            let ref_img = apply_p1(&img);
            (ref_img, None)
        }
        ColorMode::Binary => {
            // Binary mode: rasterize onto white canvas and compare with P1+P3 applied original
            let ref_img = apply_p3(&apply_p1(&img));
            (ref_img, Some(Color::WHITE))
        }
    };

    let rendered = rasterize_svg(&output.svg, img.width(), img.height(), bg_color)
        .unwrap_or_else(|e| panic!("Rasterize failed for {fixture_name}: {e}"));

    let (mismatches, ratio) = compute_mismatch(&reference, &rendered);

    assert!(
        ratio <= MAX_MISMATCH_RATIO,
        "Fixture {fixture_name} with preset {preset:?} exceeded MAX_MISMATCH_RATIO: \
         {ratio:.4} ({mismatches} pixels) > {MAX_MISMATCH_RATIO:.4}"
    );
}

// =========================================================================
// Quality tests for all 14 fixture x preset combinations per design §9.2
// =========================================================================

#[test]
fn test_quality_logo_color_png_color_logo() {
    run_quality_check("logo_color.png", Preset::ColorLogo);
}

#[test]
fn test_quality_logo_color_png_color_icon() {
    run_quality_check("logo_color.png", Preset::ColorIcon);
}

#[test]
fn test_quality_logo_color_jpg_color_logo() {
    run_quality_check("logo_color.jpg", Preset::ColorLogo);
}

#[test]
fn test_quality_logo_color_jpg_color_icon() {
    run_quality_check("logo_color.jpg", Preset::ColorIcon);
}

#[test]
fn test_quality_logo_color_webp_color_logo() {
    run_quality_check("logo_color.webp", Preset::ColorLogo);
}

#[test]
fn test_quality_logo_color_webp_color_icon() {
    run_quality_check("logo_color.webp", Preset::ColorIcon);
}

#[test]
fn test_quality_logo_color_bmp_color_logo() {
    run_quality_check("logo_color.bmp", Preset::ColorLogo);
}

#[test]
fn test_quality_logo_color_bmp_color_icon() {
    run_quality_check("logo_color.bmp", Preset::ColorIcon);
}

#[test]
fn test_quality_logo_color_gif_color_logo() {
    run_quality_check("logo_color.gif", Preset::ColorLogo);
}

#[test]
fn test_quality_logo_color_gif_color_icon() {
    run_quality_check("logo_color.gif", Preset::ColorIcon);
}

#[test]
fn test_quality_logo_small_transparency_color_logo() {
    run_quality_check("logo_small_transparency.png", Preset::ColorLogo);
}

#[test]
fn test_quality_logo_small_transparency_color_icon() {
    run_quality_check("logo_small_transparency.png", Preset::ColorIcon);
}

#[test]
fn test_quality_icon_mono_binary() {
    run_quality_check("icon_mono.png", Preset::Binary);
}

#[test]
fn test_quality_icon_mono_transparent_binary() {
    run_quality_check("icon_mono_transparent.png", Preset::Binary);
}

// =========================================================================
// Specific regression test for transparent region integrity
// =========================================================================

#[test]
fn test_logo_small_transparency_preserves_transparent_pixels() {
    let img = load_fixture("logo_small_transparency.png");
    let params = Preset::ColorLogo.params();
    let output = trace(&img, &params).expect("Trace should succeed");

    let rendered = rasterize_svg(&output.svg, img.width(), img.height(), None)
        .expect("Rasterize should succeed");

    let p1 = apply_p1(&img);
    let mut total_transparent_pixels = 0;
    let mut converted_to_opaque = 0;

    for y in 0..img.height() {
        for x in 0..img.width() {
            let ref_p = p1.get_pixel(x, y);
            if ref_p[3] < ALPHA_THRESHOLD {
                total_transparent_pixels += 1;
                let ren_p = rendered.get_pixel(x, y);
                if ren_p[3] >= ALPHA_THRESHOLD {
                    converted_to_opaque += 1;
                }
            }
        }
    }

    assert!(
        total_transparent_pixels > 0,
        "Image must contain transparent pixels to test"
    );
    assert_eq!(
        converted_to_opaque, 0,
        "Transparent region in logo_small_transparency.png must have 0 opaque pixels in output"
    );
}

// =========================================================================
// Conversion time performance test (1024x1024) per work-plan T03
// =========================================================================

#[test]
fn test_1024x1024_conversion_time() {
    let img = load_fixture("logo_color.png");
    assert_eq!(img.width(), 1024);
    assert_eq!(img.height(), 1024);

    let params = Preset::ColorLogo.params();

    let start = Instant::now();
    let output = trace(&img, &params).expect("Trace should succeed");
    let elapsed = start.elapsed();

    assert!(output.path_count > 0);

    if cfg!(not(debug_assertions)) {
        // Enforce 6.0s limit in release mode as required by work-plan T03
        assert!(
            elapsed <= Duration::from_secs(6),
            "Conversion time in release mode ({elapsed:?}) exceeded 6s limit"
        );
    } else {
        // In debug mode, compilation is unoptimized. We allow a relaxed 30s threshold
        // to avoid false failures on slow or busy CI runners while still guarding against hangs.
        assert!(
            elapsed <= Duration::from_secs(30),
            "Conversion time in debug mode ({elapsed:?}) exceeded 30s limit"
        );
    }
}

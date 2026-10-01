use std::path::PathBuf;
use std::time::Instant;

use image::{Rgba, RgbaImage};
use resvg::tiny_skia::{Pixmap, Transform};
use resvg::usvg::{Options, Tree};
use visioncortex::PathSimplifyMode;
use vtracer::{ColorImage, ColorMode, Config, Hierarchical};

const ALPHA_THRESHOLD: u8 = 128;
const COLOR_TOLERANCE: i16 = 32;

struct PresetConfig {
    name: &'static str,
    config: Config,
}

fn get_presets() -> [PresetConfig; 3] {
    [
        PresetConfig {
            name: "ロゴ（カラー）",
            config: Config {
                color_mode: ColorMode::Color,
                hierarchical: Hierarchical::Stacked,
                filter_speckle: 4,
                color_precision: 6,
                layer_difference: 16,
                mode: PathSimplifyMode::Spline,
                corner_threshold: 60,
                length_threshold: 4.0,
                max_iterations: 10,
                splice_threshold: 45,
                path_precision: Some(2),
            },
        },
        PresetConfig {
            name: "アイコン（少色）",
            config: Config {
                color_mode: ColorMode::Color,
                hierarchical: Hierarchical::Stacked,
                filter_speckle: 8,
                color_precision: 4,
                layer_difference: 32,
                mode: PathSimplifyMode::Spline,
                corner_threshold: 60,
                length_threshold: 4.0,
                max_iterations: 10,
                splice_threshold: 45,
                path_precision: Some(2),
            },
        },
        PresetConfig {
            name: "白黒",
            config: Config {
                color_mode: ColorMode::Binary,
                hierarchical: Hierarchical::Stacked,
                filter_speckle: 4,
                color_precision: 6,
                layer_difference: 16,
                mode: PathSimplifyMode::Spline,
                corner_threshold: 60,
                length_threshold: 4.0,
                max_iterations: 10,
                splice_threshold: 45,
                path_precision: Some(2),
            },
        },
    ]
}

// P1: Alpha binarization
fn apply_p1(img: &RgbaImage) -> RgbaImage {
    let mut out = img.clone();
    for pixel in out.pixels_mut() {
        if pixel[3] < ALPHA_THRESHOLD {
            pixel[3] = 0;
        } else {
            pixel[3] = 255;
        }
    }
    out
}

// P2: 1px transparent margin
fn apply_p2(img: &RgbaImage) -> (RgbaImage, bool) {
    let has_transparency = img.pixels().any(|p| p[3] == 0);
    if !has_transparency {
        return (img.clone(), false);
    }

    let w = img.width();
    let h = img.height();
    let mut out = RgbaImage::new(w + 2, h + 2); // Initialized to (0, 0, 0, 0)
    for y in 0..h {
        for x in 0..w {
            out.put_pixel(x + 1, y + 1, *img.get_pixel(x, y));
        }
    }
    (out, true)
}

// P3: Grayscale and composite onto white
fn apply_p3(img: &RgbaImage) -> RgbaImage {
    let mut out = RgbaImage::new(img.width(), img.height());
    for (x, y, pixel) in img.enumerate_pixels() {
        if pixel[3] < ALPHA_THRESHOLD {
            out.put_pixel(x, y, Rgba([255, 255, 255, 255]));
        } else {
            // Rec.709: Y = 0.2126 R + 0.7152 G + 0.0722 B
            let y_val =
                (0.2126 * pixel[0] as f64 + 0.7152 * pixel[1] as f64 + 0.0722 * pixel[2] as f64)
                    .round() as u8;
            out.put_pixel(x, y, Rgba([y_val, y_val, y_val, 255]));
        }
    }
    out
}

// SVG root replacement per §4.4
fn replace_svg_root(svg: &str, orig_w: u32, orig_h: u32, has_p2_margin: bool) -> String {
    let view_x = if has_p2_margin { 1 } else { 0 };
    let view_y = if has_p2_margin { 1 } else { 0 };
    let new_svg_tag = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{orig_w}" height="{orig_h}" viewBox="{view_x} {view_y} {orig_w} {orig_h}">"#
    );

    // Locate the <svg ...> tag in VTracer output
    let start = svg.find("<svg");
    let end = start.and_then(|s| svg[s..].find('>'));
    if let (Some(start), Some(end)) = (start, end) {
        let mut result = String::with_capacity(svg.len() + 32);
        result.push_str(&svg[..start]);
        result.push_str(&new_svg_tag);
        result.push_str(&svg[start + end + 1..]);
        return result;
    }
    svg.to_string()
}

fn count_paths(svg: &str) -> usize {
    let mut count = 0;
    let mut pos = 0;
    while let Some(idx) = svg[pos..].find("<path") {
        count += 1;
        pos += idx + 5;
    }
    count
}

fn rasterize_svg(
    svg: &str,
    width: u32,
    height: u32,
    bg_color: Option<resvg::tiny_skia::Color>,
) -> Result<RgbaImage, String> {
    let opt = Options::default();
    let tree = Tree::from_str(svg, &opt).map_err(|e| format!("usvg error: {e:?}"))?;
    let mut pixmap =
        Pixmap::new(width, height).ok_or_else(|| "Failed to allocate pixmap".to_string())?;

    if let Some(color) = bg_color {
        pixmap.fill(color);
    }

    resvg::render(&tree, Transform::default(), &mut pixmap.as_mut());

    // Convert tiny-skia pixmap (premultiplied RGBA) to image::RgbaImage (un-premultiplied RGBA)
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
                let alpha_f = a as f32 / 255.0;
                (
                    (data[idx] as f32 / alpha_f).round().clamp(0.0, 255.0) as u8,
                    (data[idx + 1] as f32 / alpha_f).round().clamp(0.0, 255.0) as u8,
                    (data[idx + 2] as f32 / alpha_f).round().clamp(0.0, 255.0) as u8,
                )
            };
            img.put_pixel(x, y, Rgba([r, g, b, a]));
        }
    }
    Ok(img)
}

fn compare_images(original: &RgbaImage, rendered: &RgbaImage) -> (usize, f64) {
    let width = original.width();
    let height = original.height();
    let total = (width * height) as usize;
    let mut mismatches = 0;

    for y in 0..height {
        for x in 0..width {
            let o = original.get_pixel(x, y);
            let r = rendered.get_pixel(x, y);

            let o_trans = o[3] < ALPHA_THRESHOLD;
            let r_trans = r[3] < ALPHA_THRESHOLD;

            if o_trans != r_trans {
                mismatches += 1;
            } else if !o_trans {
                let diff_r = (o[0] as i16 - r[0] as i16).abs();
                let diff_g = (o[1] as i16 - r[1] as i16).abs();
                let diff_b = (o[2] as i16 - r[2] as i16).abs();
                if diff_r > COLOR_TOLERANCE || diff_g > COLOR_TOLERANCE || diff_b > COLOR_TOLERANCE
                {
                    mismatches += 1;
                }
            }
        }
    }

    let ratio = (mismatches as f64 / total as f64) * 100.0;
    (mismatches, ratio)
}

fn run_trace(
    input_img: &RgbaImage,
    config: &Config,
    enable_p2: bool,
    enable_p3: bool,
    bg_color: Option<resvg::tiny_skia::Color>,
) -> Result<(String, RgbaImage), String> {
    let orig_w = input_img.width();
    let orig_h = input_img.height();

    // Step 1: P1
    let mut processed = apply_p1(input_img);

    // Step 2: P3 if binary mode and enabled
    if matches!(config.color_mode, ColorMode::Binary) && enable_p3 {
        processed = apply_p3(&processed);
    }

    // Step 3: P2 if color mode and enabled
    let (to_trace, has_margin) = if matches!(config.color_mode, ColorMode::Color) && enable_p2 {
        apply_p2(&processed)
    } else {
        (processed.clone(), false)
    };

    // Convert to visioncortex ColorImage
    let color_img = ColorImage {
        pixels: to_trace.as_raw().clone(),
        width: to_trace.width() as usize,
        height: to_trace.height() as usize,
    };

    let svg_file = vtracer::convert(color_img, config.clone())?;
    let raw_svg = svg_file.to_string();

    let final_svg = replace_svg_root(&raw_svg, orig_w, orig_h, has_margin);
    let rendered = rasterize_svg(&final_svg, orig_w, orig_h, bg_color)?;

    Ok((final_svg, rendered))
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let fixtures_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures");

    println!("=======================================================");
    println!("        SVG-Tracer Spike Verification (Design §10)     ");
    println!("=======================================================\n");

    // =========================================================================
    // Spike 1: §4.3 P2 (1px transparent margin) & Keying
    // =========================================================================
    println!("--- Verification 1: §4.3 P2 (1px margin keying) ---");
    let logo_small_trans_path = fixtures_dir.join("logo_small_transparency.png");
    let logo_small_trans = image::open(&logo_small_trans_path)?.to_rgba8();
    let presets = get_presets();
    let color_preset = &presets[0].config;

    // 1a: Without P2
    println!("Testing logo_small_transparency.png WITHOUT P2...");
    let (svg_no_p2, rendered_no_p2) =
        run_trace(&logo_small_trans, color_preset, false, false, None)?;
    let p1_ref = apply_p1(&logo_small_trans);
    let (_mismatches_no_p2, ratio_no_p2) = compare_images(&p1_ref, &rendered_no_p2);
    let paths_no_p2 = count_paths(&svg_no_p2);
    // Count transparent pixels that became opaque in rendered_no_p2
    let mut trans_became_opaque = 0;
    for (x, y, p) in p1_ref.enumerate_pixels() {
        if p[3] < ALPHA_THRESHOLD && rendered_no_p2.get_pixel(x, y)[3] >= ALPHA_THRESHOLD {
            trans_became_opaque += 1;
        }
    }
    println!(
        "  Without P2: paths = {paths_no_p2}, mismatch = {ratio_no_p2:.2}%, transparent pixels converted to opaque = {trans_became_opaque}"
    );

    // 1b: With P2
    println!("Testing logo_small_transparency.png WITH P2...");
    let (svg_with_p2, rendered_with_p2) =
        run_trace(&logo_small_trans, color_preset, true, false, None)?;
    let (_mismatches_with_p2, ratio_with_p2) = compare_images(&p1_ref, &rendered_with_p2);
    let paths_with_p2 = count_paths(&svg_with_p2);
    let mut trans_became_opaque_p2 = 0;
    for (x, y, p) in p1_ref.enumerate_pixels() {
        if p[3] < ALPHA_THRESHOLD && rendered_with_p2.get_pixel(x, y)[3] >= ALPHA_THRESHOLD {
            trans_became_opaque_p2 += 1;
        }
    }
    println!(
        "  With P2: paths = {paths_with_p2}, mismatch = {ratio_with_p2:.2}%, transparent pixels converted to opaque = {trans_became_opaque_p2}"
    );
    let spike1_success = trans_became_opaque > 0 && trans_became_opaque_p2 == 0;
    println!(
        "  Result: {}",
        if spike1_success {
            "SUCCESS (P2 successfully activates keying)"
        } else {
            "FAILED"
        }
    );
    println!();

    // =========================================================================
    // Spike 2: §4.3 P3 (Binary mode transparency & grayscale)
    // =========================================================================
    println!("--- Verification 2: §4.3 P3 (Binary mode transparency) ---");
    let icon_mono_trans_path = fixtures_dir.join("icon_mono_transparent.png");
    let icon_mono_trans = image::open(&icon_mono_trans_path)?.to_rgba8();
    let icon_mono_white_path = fixtures_dir.join("icon_mono.png");
    let icon_mono_white = image::open(&icon_mono_white_path)?.to_rgba8();
    let mono_preset = &presets[2].config;

    // Decided comparison method: SVG rendered on white canvas, reference is P3(P1(image))
    let ref_mono_trans = apply_p3(&apply_p1(&icon_mono_trans));
    let ref_mono_white = apply_p3(&apply_p1(&icon_mono_white));

    // 2a: Without P3 (transparent input)
    println!("Testing icon_mono_transparent.png WITHOUT P3...");
    let (svg_no_p3, rendered_no_p3) = run_trace(
        &icon_mono_trans,
        mono_preset,
        false,
        false,
        Some(resvg::tiny_skia::Color::WHITE),
    )?;
    let (_mismatches_no_p3, ratio_no_p3) = compare_images(&ref_mono_trans, &rendered_no_p3);
    let black_pixels_no_p3 = rendered_no_p3
        .pixels()
        .filter(|p| p[0] < 128 && p[3] >= 128)
        .count();
    let total_pixels_icon = (icon_mono_trans.width() * icon_mono_trans.height()) as usize;
    println!(
        "  Without P3: paths = {}, mismatch = {ratio_no_p3:.2}%, black pixels = {black_pixels_no_p3}/{total_pixels_icon}",
        count_paths(&svg_no_p3)
    );

    // 2b: With P3 (transparent input)
    println!("Testing icon_mono_transparent.png WITH P3...");
    let (svg_with_p3_trans, rendered_with_p3_trans) = run_trace(
        &icon_mono_trans,
        mono_preset,
        false,
        true,
        Some(resvg::tiny_skia::Color::WHITE),
    )?;
    let (_mismatches_with_p3_trans, ratio_with_p3_trans) =
        compare_images(&ref_mono_trans, &rendered_with_p3_trans);
    let black_pixels_with_p3_trans = rendered_with_p3_trans
        .pixels()
        .filter(|p| p[0] < 128 && p[3] >= 128)
        .count();
    println!(
        "  With P3 (trans): paths = {}, mismatch = {ratio_with_p3_trans:.2}%, black pixels = {black_pixels_with_p3_trans}/{total_pixels_icon}",
        count_paths(&svg_with_p3_trans)
    );

    // 2c: With P3 (white background input)
    println!("Testing icon_mono.png WITH P3...");
    let (svg_with_p3_white, rendered_with_p3_white) = run_trace(
        &icon_mono_white,
        mono_preset,
        false,
        true,
        Some(resvg::tiny_skia::Color::WHITE),
    )?;
    let (_mismatches_with_p3_white, ratio_with_p3_white) =
        compare_images(&ref_mono_white, &rendered_with_p3_white);
    println!(
        "  With P3 (white): paths = {}, mismatch = {ratio_with_p3_white:.2}%",
        count_paths(&svg_with_p3_white)
    );

    let spike2_success =
        ratio_no_p3 > 50.0 && ratio_with_p3_trans < 3.0 && ratio_with_p3_white < 3.0;
    println!(
        "  Result: {}",
        if spike2_success {
            "SUCCESS (P3 correctly preserves shape and prevents full black; white canvas evaluation matches)"
        } else {
            "FAILED"
        }
    );
    println!();

    // =========================================================================
    // Spike 3: §4.4 Root element replacement
    // =========================================================================
    println!("--- Verification 3: §4.4 SVG root replacement & viewBox ---");
    let test_img = &logo_small_trans;
    let (p2_img, has_margin) = apply_p2(&apply_p1(test_img));
    assert!(has_margin);
    let color_img = ColorImage {
        pixels: p2_img.as_raw().clone(),
        width: p2_img.width() as usize,
        height: p2_img.height() as usize,
    };
    let raw_svg_file = vtracer::convert(color_img, color_preset.clone())?;
    let raw_svg = raw_svg_file.to_string();
    assert!(raw_svg.contains(&format!(
        r#"width="{}" height="{}""#,
        test_img.width() + 2,
        test_img.height() + 2
    )));

    let replaced_svg = replace_svg_root(&raw_svg, test_img.width(), test_img.height(), true);
    let expected_tag = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{}" height="{}" viewBox="1 1 {} {}">"#,
        test_img.width(),
        test_img.height(),
        test_img.width(),
        test_img.height()
    );
    let has_expected_tag = replaced_svg.contains(&expected_tag);
    let has_no_image = !replaced_svg.contains("<image");
    let opt = Options::default();
    let parsed_tree = Tree::from_str(&replaced_svg, &opt);
    let xml_valid = parsed_tree.is_ok();
    let rendered_w_h = if let Ok(ref tree) = parsed_tree {
        let size = tree.size();
        (size.width(), size.height())
    } else {
        (0.0, 0.0)
    };
    println!("  Has expected root tag: {has_expected_tag}");
    println!("  Contains no <image>: {has_no_image}");
    println!("  XML is valid: {xml_valid}");
    println!("  Tree size: {} x {}", rendered_w_h.0, rendered_w_h.1);
    let spike3_success = has_expected_tag
        && has_no_image
        && xml_valid
        && (rendered_w_h.0 == test_img.width() as f32)
        && (rendered_w_h.1 == test_img.height() as f32);
    println!(
        "  Result: {}",
        if spike3_success {
            "SUCCESS (SVG root replaced properly, exact dimension rendered)"
        } else {
            "FAILED"
        }
    );
    println!();

    // =========================================================================
    // Spike 4: Mismatch ratio across fixtures & presets
    // =========================================================================
    println!("--- Verification 4: Preset x Fixture Mismatch Rates ---");

    struct TestCase {
        fixture_name: &'static str,
        image_path: PathBuf,
        preset_idx: usize,
        is_binary: bool,
    }

    let test_cases = [
        // logo_color.png (1024x1024)
        TestCase {
            fixture_name: "logo_color.png",
            image_path: fixtures_dir.join("logo_color.png"),
            preset_idx: 0, // ロゴ（カラー）
            is_binary: false,
        },
        TestCase {
            fixture_name: "logo_color.png",
            image_path: fixtures_dir.join("logo_color.png"),
            preset_idx: 1, // アイコン（少色）
            is_binary: false,
        },
        // logo_color.jpg (1024x1024)
        TestCase {
            fixture_name: "logo_color.jpg",
            image_path: fixtures_dir.join("logo_color.jpg"),
            preset_idx: 0, // ロゴ（カラー）
            is_binary: false,
        },
        TestCase {
            fixture_name: "logo_color.jpg",
            image_path: fixtures_dir.join("logo_color.jpg"),
            preset_idx: 1, // アイコン（少色）
            is_binary: false,
        },
        // logo_color.webp (1024x1024)
        TestCase {
            fixture_name: "logo_color.webp",
            image_path: fixtures_dir.join("logo_color.webp"),
            preset_idx: 0, // ロゴ（カラー）
            is_binary: false,
        },
        TestCase {
            fixture_name: "logo_color.webp",
            image_path: fixtures_dir.join("logo_color.webp"),
            preset_idx: 1, // アイコン（少色）
            is_binary: false,
        },
        // logo_color.bmp (1024x1024)
        TestCase {
            fixture_name: "logo_color.bmp",
            image_path: fixtures_dir.join("logo_color.bmp"),
            preset_idx: 0, // ロゴ（カラー）
            is_binary: false,
        },
        TestCase {
            fixture_name: "logo_color.bmp",
            image_path: fixtures_dir.join("logo_color.bmp"),
            preset_idx: 1, // アイコン（少色）
            is_binary: false,
        },
        // logo_color.gif (1024x1024)
        TestCase {
            fixture_name: "logo_color.gif",
            image_path: fixtures_dir.join("logo_color.gif"),
            preset_idx: 0, // ロゴ（カラー）
            is_binary: false,
        },
        TestCase {
            fixture_name: "logo_color.gif",
            image_path: fixtures_dir.join("logo_color.gif"),
            preset_idx: 1, // アイコン（少色）
            is_binary: false,
        },
        // logo_small_transparency.png (512x512)
        TestCase {
            fixture_name: "logo_small_transparency.png",
            image_path: fixtures_dir.join("logo_small_transparency.png"),
            preset_idx: 0, // ロゴ（カラー）
            is_binary: false,
        },
        TestCase {
            fixture_name: "logo_small_transparency.png",
            image_path: fixtures_dir.join("logo_small_transparency.png"),
            preset_idx: 1, // アイコン（少色）
            is_binary: false,
        },
        // icon_mono.png (256x256)
        TestCase {
            fixture_name: "icon_mono.png",
            image_path: fixtures_dir.join("icon_mono.png"),
            preset_idx: 2, // 白黒
            is_binary: true,
        },
        // icon_mono_transparent.png (256x256)
        TestCase {
            fixture_name: "icon_mono_transparent.png",
            image_path: fixtures_dir.join("icon_mono_transparent.png"),
            preset_idx: 2, // 白黒
            is_binary: true,
        },
    ];

    println!(
        "{:<32} | {:<16} | {:>7} | {:>10} | {:>12} | {:>10}",
        "Fixture", "Preset", "Paths", "Mismatches", "Mismatch (%)", "Time (ms)"
    );
    println!(
        "{:-<32}-+-{:-<16}-+-{:-<7}-+-{:-<10}-+-{:-<12}-+-{:-<10}",
        "", "", "", "", "", ""
    );

    let mut max_observed_mismatch = 0.0_f64;

    for tc in &test_cases {
        let raw_img = image::open(&tc.image_path)?.to_rgba8();
        let preset = &presets[tc.preset_idx];

        let start = Instant::now();
        let bg_color = if tc.is_binary {
            Some(resvg::tiny_skia::Color::WHITE)
        } else {
            None
        };
        let (svg, rendered) = run_trace(&raw_img, &preset.config, true, tc.is_binary, bg_color)?;
        let elapsed = start.elapsed().as_millis();

        let ref_img = if tc.is_binary {
            apply_p3(&apply_p1(&raw_img))
        } else {
            apply_p1(&raw_img)
        };

        let (mismatches, ratio) = compare_images(&ref_img, &rendered);
        let path_cnt = count_paths(&svg);

        if ratio > max_observed_mismatch {
            max_observed_mismatch = ratio;
        }

        println!(
            "{:<32} | {:<16} | {:>7} | {:>10} | {:>11.2}% | {:>8}ms",
            tc.fixture_name, preset.name, path_cnt, mismatches, ratio, elapsed
        );
    }

    println!("\nMax Observed Mismatch: {:.2}%", max_observed_mismatch);
    println!(
        "Evaluation against MAX_MISMATCH_RATIO = 3.0%: {}",
        if max_observed_mismatch <= 3.0 {
            "All test cases pass"
        } else {
            "Mismatch exceeds 3.0%"
        }
    );

    Ok(())
}

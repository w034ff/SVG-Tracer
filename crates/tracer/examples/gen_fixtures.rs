use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use image::codecs::bmp::BmpEncoder;
use image::codecs::gif::{GifEncoder, Repeat};
use image::codecs::jpeg::JpegEncoder;
use image::codecs::webp::WebPEncoder;
use image::{Delay, ExtendedColorType, Frame, RgbImage, Rgba, RgbaImage};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let fixtures_dir = manifest_dir.join("tests").join("fixtures");
    fs::create_dir_all(&fixtures_dir)?;

    println!("Generating fixtures in {}...", fixtures_dir.display());

    // 1. logo_color.png (1024x1024, transparent background, 4 colors: circle, rounded rect, triangle, accent)
    let logo_color = generate_logo_color(1024, 1024);
    logo_color.save(fixtures_dir.join("logo_color.png"))?;
    println!("  Generated logo_color.png");

    // 2. logo_small_transparency.png (512x512, transparent area < 20%)
    let logo_small_trans = generate_logo_small_transparency(512, 512);
    logo_small_trans.save(fixtures_dir.join("logo_small_transparency.png"))?;
    println!("  Generated logo_small_transparency.png");

    // 3. icon_mono.png (256x256, white background, black shape)
    let icon_mono = generate_icon_mono(256, 256, false);
    icon_mono.save(fixtures_dir.join("icon_mono.png"))?;
    println!("  Generated icon_mono.png");

    // 4. icon_mono_transparent.png (256x256, transparent background, black shape)
    let icon_mono_trans = generate_icon_mono(256, 256, true);
    icon_mono_trans.save(fixtures_dir.join("icon_mono_transparent.png"))?;
    println!("  Generated icon_mono_transparent.png");

    // 5. Derived formats of logo_color:
    // 5a. logo_color.jpg (composite over white background)
    let logo_white_bg = composite_on_white(&logo_color);
    let mut jpg_file = File::create(fixtures_dir.join("logo_color.jpg"))?;
    let mut jpg_encoder = JpegEncoder::new_with_quality(&mut jpg_file, 90);
    jpg_encoder.encode(
        logo_white_bg.as_raw(),
        logo_white_bg.width(),
        logo_white_bg.height(),
        ExtendedColorType::Rgb8,
    )?;
    println!("  Generated logo_color.jpg");

    // 5b. logo_color.bmp (composite over white background)
    let mut bmp_file = File::create(fixtures_dir.join("logo_color.bmp"))?;
    let mut bmp_encoder = BmpEncoder::new(&mut bmp_file);
    bmp_encoder.encode(
        logo_white_bg.as_raw(),
        logo_white_bg.width(),
        logo_white_bg.height(),
        ExtendedColorType::Rgb8,
    )?;
    println!("  Generated logo_color.bmp");

    // 5c. logo_color.webp (lossless RGBA)
    let mut webp_file = File::create(fixtures_dir.join("logo_color.webp"))?;
    let webp_encoder = WebPEncoder::new_lossless(&mut webp_file);
    webp_encoder.encode(
        logo_color.as_raw(),
        logo_color.width(),
        logo_color.height(),
        ExtendedColorType::Rgba8,
    )?;
    println!("  Generated logo_color.webp");

    // 5d. logo_color.gif (single frame GIF with transparency)
    let gif_file = File::create(fixtures_dir.join("logo_color.gif"))?;
    let mut gif_encoder = GifEncoder::new(gif_file);
    gif_encoder.encode(
        logo_color.as_raw(),
        logo_color.width(),
        logo_color.height(),
        ExtendedColorType::Rgba8,
    )?;
    println!("  Generated logo_color.gif");

    // 6. anim.gif (multi-frame GIF, 128x128)
    generate_anim_gif(&fixtures_dir.join("anim.gif"))?;
    println!("  Generated anim.gif");

    // 7. corrupt.png (PNG signature followed by invalid chunk data)
    let mut corrupt_file = File::create(fixtures_dir.join("corrupt.png"))?;
    let png_signature: [u8; 8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    corrupt_file.write_all(&png_signature)?;
    corrupt_file.write_all(b"INVALID_CHUNK_PAYLOAD_NOT_A_VALID_PNG_FILE_DATA")?;
    println!("  Generated corrupt.png");

    // 8. not_image.png (plain text)
    let mut not_image_file = File::create(fixtures_dir.join("not_image.png"))?;
    not_image_file.write_all(b"This is a plain text file, not a valid image format.\n")?;
    println!("  Generated not_image.png");

    println!("All fixtures successfully generated.");
    Ok(())
}

fn composite_on_white(img: &RgbaImage) -> RgbImage {
    let mut rgb = RgbImage::new(img.width(), img.height());
    for (x, y, pixel) in img.enumerate_pixels() {
        let alpha = pixel[3] as f32 / 255.0;
        let r = ((pixel[0] as f32 * alpha) + 255.0 * (1.0 - alpha)).round() as u8;
        let g = ((pixel[1] as f32 * alpha) + 255.0 * (1.0 - alpha)).round() as u8;
        let b = ((pixel[2] as f32 * alpha) + 255.0 * (1.0 - alpha)).round() as u8;
        rgb.put_pixel(x, y, image::Rgb([r, g, b]));
    }
    rgb
}

fn generate_logo_color(width: u32, height: u32) -> RgbaImage {
    let mut img = RgbaImage::new(width, height);

    // 4 colors:
    let red = Rgba([229, 57, 53, 255]); // #E53935
    let blue = Rgba([30, 136, 229, 255]); // #1E88E5
    let green = Rgba([67, 160, 71, 255]); // #43A047
    let orange = Rgba([251, 140, 0, 255]); // #FB8C00

    // Circle: center (360, 360), radius 180
    let c_x = 360.0_f64;
    let c_y = 360.0_f64;
    let c_r = 180.0_f64;

    // Rounded rectangle: x in [480, 860], y in [160, 540], radius 40
    let r_min_x = 480.0_f64;
    let r_max_x = 860.0_f64;
    let r_min_y = 160.0_f64;
    let r_max_y = 540.0_f64;
    let r_radius = 40.0_f64;

    // Triangle: vertices (220, 880), (512, 540), (804, 880)
    let p1 = (220.0_f64, 880.0_f64);
    let p2 = (512.0_f64, 540.0_f64);
    let p3 = (804.0_f64, 880.0_f64);

    // Orange accent: diamond at (512, 420), radius 60
    let d_cx = 512.0_f64;
    let d_cy = 420.0_f64;
    let d_size = 60.0_f64;

    for y in 0..height {
        let py = y as f64 + 0.5;
        for x in 0..width {
            let px = x as f64 + 0.5;

            // Check diamond accent first (on top)
            if (px - d_cx).abs() + (py - d_cy).abs() <= d_size {
                img.put_pixel(x, y, orange);
                continue;
            }

            // Check circle
            let dist_sq = (px - c_x) * (px - c_x) + (py - c_y) * (py - c_y);
            if dist_sq <= c_r * c_r {
                img.put_pixel(x, y, red);
                continue;
            }

            // Check rounded rectangle
            if px >= r_min_x && px <= r_max_x && py >= r_min_y && py <= r_max_y {
                let dx = if px < r_min_x + r_radius {
                    (r_min_x + r_radius) - px
                } else if px > r_max_x - r_radius {
                    px - (r_max_x - r_radius)
                } else {
                    0.0
                };
                let dy = if py < r_min_y + r_radius {
                    (r_min_y + r_radius) - py
                } else if py > r_max_y - r_radius {
                    py - (r_max_y - r_radius)
                } else {
                    0.0
                };
                if dx * dx + dy * dy <= r_radius * r_radius {
                    img.put_pixel(x, y, blue);
                    continue;
                }
            }

            // Check triangle using barycentric coordinates
            if point_in_triangle(px, py, p1, p2, p3) {
                img.put_pixel(x, y, green);
                continue;
            }
        }
    }

    img
}

fn point_in_triangle(px: f64, py: f64, p1: (f64, f64), p2: (f64, f64), p3: (f64, f64)) -> bool {
    let d1 = (px - p2.0) * (p1.1 - p2.1) - (p1.0 - p2.0) * (py - p2.1);
    let d2 = (px - p3.0) * (p2.1 - p3.1) - (p2.0 - p3.0) * (py - p3.1);
    let d3 = (px - p1.0) * (p3.1 - p1.1) - (p3.0 - p1.0) * (py - p1.1);

    let has_neg = (d1 < 0.0) || (d2 < 0.0) || (d3 < 0.0);
    let has_pos = (d1 > 0.0) || (d2 > 0.0) || (d3 > 0.0);

    !(has_neg && has_pos)
}

fn generate_logo_small_transparency(width: u32, height: u32) -> RgbaImage {
    let mut img = RgbaImage::new(width, height);

    let navy = Rgba([26, 35, 126, 255]); // #1A237E
    let gold = Rgba([255, 179, 0, 255]); // #FFB300
    let transparent = Rgba([0, 0, 0, 0]);

    // Solid background
    for pixel in img.pixels_mut() {
        *pixel = navy;
    }

    // Outer decorative gold shield / rounded badge
    let pad = 40.0_f64;
    for y in 0..height {
        let py = y as f64 + 0.5;
        for x in 0..width {
            let px = x as f64 + 0.5;
            if px >= pad && px <= width as f64 - pad && py >= pad && py <= height as f64 - pad {
                img.put_pixel(x, y, gold);
            }
        }
    }

    // Transparent cutout circle in center: radius 75 (area = pi*75^2 ≈ 17,671 px, ~6.7% of image)
    // Center at (256, 256).
    // Note: scanlines checked by VTracer are y = [0, 128, 256, 384, 511].
    // At y=0, 128, 384, 511: transparent pixels = 0.
    // At y=256: transparent pixels = 2 * 75 = 150.
    // Total transparent on the 5 scanlines = 150 < 0.4 * 512 = 204.8.
    // So VTracer will NOT key this image unless 1px transparent margin is added!
    let cx = width as f64 / 2.0;
    let cy = height as f64 / 2.0;
    let r = 75.0_f64;

    for y in 0..height {
        let py = y as f64 + 0.5;
        for x in 0..width {
            let px = x as f64 + 0.5;
            let dist_sq = (px - cx) * (px - cx) + (py - cy) * (py - cy);
            if dist_sq <= r * r {
                img.put_pixel(x, y, transparent);
            }
        }
    }

    img
}

fn generate_icon_mono(width: u32, height: u32, transparent_bg: bool) -> RgbaImage {
    let mut img = RgbaImage::new(width, height);
    let bg = if transparent_bg {
        Rgba([0, 0, 0, 0])
    } else {
        Rgba([255, 255, 255, 255])
    };
    let fg = Rgba([0, 0, 0, 255]);

    for pixel in img.pixels_mut() {
        *pixel = bg;
    }

    // Magnifying glass icon:
    // Lens ring at (105, 105), outer radius 60, inner radius 40
    let cx = 105.0_f64;
    let cy = 105.0_f64;
    let r_out = 60.0_f64;
    let r_in = 40.0_f64;

    // Handle from (145, 145) to (205, 205), width 20
    let h_start = (145.0_f64, 145.0_f64);
    let h_end = (205.0_f64, 205.0_f64);
    let h_width = 20.0_f64;

    for y in 0..height {
        let py = y as f64 + 0.5;
        for x in 0..width {
            let px = x as f64 + 0.5;

            // Lens ring
            let d_sq = (px - cx) * (px - cx) + (py - cy) * (py - cy);
            if d_sq <= r_out * r_out && d_sq >= r_in * r_in {
                img.put_pixel(x, y, fg);
                continue;
            }

            // Handle: distance from segment (h_start -> h_end)
            let dist_seg = dist_to_segment((px, py), h_start, h_end);
            if dist_seg <= h_width / 2.0 {
                img.put_pixel(x, y, fg);
                continue;
            }
        }
    }

    img
}

fn dist_to_segment(p: (f64, f64), a: (f64, f64), b: (f64, f64)) -> f64 {
    let l2 = (b.0 - a.0) * (b.0 - a.0) + (b.1 - a.1) * (b.1 - a.1);
    if l2 == 0.0 {
        return ((p.0 - a.0) * (p.0 - a.0) + (p.1 - a.1) * (p.1 - a.1)).sqrt();
    }
    let t = (((p.0 - a.0) * (b.0 - a.0) + (p.1 - a.1) * (b.1 - a.1)) / l2).clamp(0.0, 1.0);
    let proj = (a.0 + t * (b.0 - a.0), a.1 + t * (b.1 - a.1));
    ((p.0 - proj.0) * (p.0 - proj.0) + (p.1 - proj.1) * (p.1 - proj.1)).sqrt()
}

fn generate_anim_gif(path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let width = 128;
    let height = 128;

    // Frame 1: Red circle on Blue background
    let mut frame1_img = RgbaImage::new(width, height);
    let blue = Rgba([30, 136, 229, 255]);
    let red = Rgba([229, 57, 53, 255]);
    for (x, y, p) in frame1_img.enumerate_pixels_mut() {
        let dx = x as f64 - 64.0;
        let dy = y as f64 - 64.0;
        if dx * dx + dy * dy <= 40.0 * 40.0 {
            *p = red;
        } else {
            *p = blue;
        }
    }

    // Frame 2: Yellow circle on Green background
    let mut frame2_img = RgbaImage::new(width, height);
    let green = Rgba([67, 160, 71, 255]);
    let yellow = Rgba([255, 238, 88, 255]);
    for (x, y, p) in frame2_img.enumerate_pixels_mut() {
        let dx = x as f64 - 64.0;
        let dy = y as f64 - 64.0;
        if dx * dx + dy * dy <= 40.0 * 40.0 {
            *p = yellow;
        } else {
            *p = green;
        }
    }

    let file = File::create(path)?;
    let mut encoder = GifEncoder::new(file);
    encoder.set_repeat(Repeat::Infinite)?;

    let frame1 = Frame::from_parts(frame1_img, 0, 0, Delay::from_numer_denom_ms(500, 1));
    let frame2 = Frame::from_parts(frame2_img, 0, 0, Delay::from_numer_denom_ms(500, 1));

    encoder.encode_frame(frame1)?;
    encoder.encode_frame(frame2)?;

    Ok(())
}

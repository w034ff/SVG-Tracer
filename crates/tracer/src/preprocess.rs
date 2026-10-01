//! Image preprocessing pipeline per design §4.3 (P1, P2, P3).

use image::{Rgba, RgbaImage};

use crate::params::ColorMode;

/// Threshold for alpha binarization per design §4.3 P1.
pub const ALPHA_THRESHOLD: u8 = 128;

/// Rec. 709 luminance coefficients for grayscale conversion per design §4.3 P3.
pub const REC709_R_COEFF: f64 = 0.2126;
pub const REC709_G_COEFF: f64 = 0.7152;
pub const REC709_B_COEFF: f64 = 0.0722;

/// P1: Alpha binarization.
///
/// Sets alpha < [`ALPHA_THRESHOLD`] to 0 (fully transparent), and all other alpha values
/// to 255 (fully opaque). Color channels (RGB) are preserved.
pub fn apply_p1(img: &RgbaImage) -> RgbaImage {
    let mut out = img.clone();
    for pixel in out.pixels_mut() {
        pixel[3] = if pixel[3] < ALPHA_THRESHOLD { 0 } else { 255 };
    }
    out
}

/// P2: Transparent 1px margin.
///
/// If the image contains one or more fully transparent pixels (`alpha == 0`),
/// adds a 1px transparent margin to all four sides, returning a new image of size
/// `(width + 2, height + 2)` and `true`. If no transparent pixels exist, returns
/// the original image clone and `false`.
pub fn apply_p2(img: &RgbaImage) -> (RgbaImage, bool) {
    let has_transparency = img.pixels().any(|p| p[3] == 0);
    if !has_transparency {
        return (img.clone(), false);
    }

    let w = img.width();
    let h = img.height();
    // Default pixel for RgbaImage is [0, 0, 0, 0] (fully transparent).
    let mut out = RgbaImage::new(w + 2, h + 2);
    for y in 0..h {
        for x in 0..w {
            out.put_pixel(x + 1, y + 1, *img.get_pixel(x, y));
        }
    }
    (out, true)
}

/// P3: Grayscale and composite onto white for binary mode.
///
/// Transparent pixels (`alpha < ALPHA_THRESHOLD`) are composited onto white (`[255, 255, 255, 255]`).
/// Opaque pixels have their RGB channels replaced by luminance calculated using Rec. 709:
/// `Y = round(0.2126 * R + 0.7152 * G + 0.0722 * B)`.
/// The resulting image is fully opaque.
pub fn apply_p3(img: &RgbaImage) -> RgbaImage {
    let w = img.width();
    let h = img.height();
    let mut out = RgbaImage::new(w, h);

    for y in 0..h {
        for x in 0..w {
            let pixel = img.get_pixel(x, y);
            if pixel[3] < ALPHA_THRESHOLD {
                out.put_pixel(x, y, Rgba([255, 255, 255, 255]));
            } else {
                let y_val = (REC709_R_COEFF * f64::from(pixel[0])
                    + REC709_G_COEFF * f64::from(pixel[1])
                    + REC709_B_COEFF * f64::from(pixel[2]))
                .round()
                .clamp(0.0, 255.0) as u8;
                out.put_pixel(x, y, Rgba([y_val, y_val, y_val, 255]));
            }
        }
    }
    out
}

/// Applies the complete preprocessing pipeline for tracing based on the specified color mode.
///
/// Returns the preprocessed image and whether a 1px transparent margin was added by P2.
pub fn preprocess_for_trace(img: &RgbaImage, color_mode: ColorMode) -> (RgbaImage, bool) {
    let p1 = apply_p1(img);
    match color_mode {
        ColorMode::Color => apply_p2(&p1),
        ColorMode::Binary => (apply_p3(&p1), false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_apply_p1_pixel_comparison() {
        let mut img = RgbaImage::new(4, 1);
        // alpha = 0 -> 0
        img.put_pixel(0, 0, Rgba([10, 20, 30, 0]));
        // alpha = 127 (< 128) -> 0
        img.put_pixel(1, 0, Rgba([40, 50, 60, 127]));
        // alpha = 128 (>= 128) -> 255
        img.put_pixel(2, 0, Rgba([70, 80, 90, 128]));
        // alpha = 255 -> 255
        img.put_pixel(3, 0, Rgba([100, 110, 120, 255]));

        let out = apply_p1(&img);

        assert_eq!(*out.get_pixel(0, 0), Rgba([10, 20, 30, 0]));
        assert_eq!(*out.get_pixel(1, 0), Rgba([40, 50, 60, 0]));
        assert_eq!(*out.get_pixel(2, 0), Rgba([70, 80, 90, 255]));
        assert_eq!(*out.get_pixel(3, 0), Rgba([100, 110, 120, 255]));
    }

    #[test]
    fn test_apply_p2_without_transparency() {
        let mut img = RgbaImage::new(2, 2);
        for pixel in img.pixels_mut() {
            *pixel = Rgba([100, 150, 200, 255]);
        }

        let (out, has_margin) = apply_p2(&img);
        assert!(!has_margin);
        assert_eq!(out.width(), 2);
        assert_eq!(out.height(), 2);
        assert_eq!(out, img);
    }

    #[test]
    fn test_apply_p2_with_transparency_pixel_comparison() {
        let mut img = RgbaImage::new(2, 2);
        img.put_pixel(0, 0, Rgba([10, 20, 30, 255]));
        img.put_pixel(1, 0, Rgba([40, 50, 60, 0])); // transparent pixel
        img.put_pixel(0, 1, Rgba([70, 80, 90, 255]));
        img.put_pixel(1, 1, Rgba([100, 110, 120, 255]));

        let (out, has_margin) = apply_p2(&img);
        assert!(has_margin);
        assert_eq!(out.width(), 4);
        assert_eq!(out.height(), 4);

        // Check outer 1px border is all [0, 0, 0, 0]
        let transparent = Rgba([0, 0, 0, 0]);
        for x in 0..4 {
            assert_eq!(*out.get_pixel(x, 0), transparent);
            assert_eq!(*out.get_pixel(x, 3), transparent);
        }
        for y in 0..4 {
            assert_eq!(*out.get_pixel(0, y), transparent);
            assert_eq!(*out.get_pixel(3, y), transparent);
        }

        // Check inner pixels match original offset by (1, 1)
        assert_eq!(*out.get_pixel(1, 1), Rgba([10, 20, 30, 255]));
        assert_eq!(*out.get_pixel(2, 1), Rgba([40, 50, 60, 0]));
        assert_eq!(*out.get_pixel(1, 2), Rgba([70, 80, 90, 255]));
        assert_eq!(*out.get_pixel(2, 2), Rgba([100, 110, 120, 255]));
    }

    #[test]
    fn test_apply_p3_pixel_comparison() {
        let mut img = RgbaImage::new(6, 1);
        // Semi-transparent pixel -> pure white [255, 255, 255, 255]
        img.put_pixel(0, 0, Rgba([0, 0, 0, 50]));
        // Pure red: Y = round(0.2126 * 255) = round(54.213) = 54
        img.put_pixel(1, 0, Rgba([255, 0, 0, 255]));
        // Pure green: Y = round(0.7152 * 255) = round(182.376) = 182
        img.put_pixel(2, 0, Rgba([0, 255, 0, 255]));
        // Pure blue: Y = round(0.0722 * 255) = round(18.411) = 18
        img.put_pixel(3, 0, Rgba([0, 0, 255, 255]));
        // Pure white: Y = 255
        img.put_pixel(4, 0, Rgba([255, 255, 255, 255]));
        // Pure black: Y = 0
        img.put_pixel(5, 0, Rgba([0, 0, 0, 255]));

        let out = apply_p3(&img);

        assert_eq!(*out.get_pixel(0, 0), Rgba([255, 255, 255, 255]));
        assert_eq!(*out.get_pixel(1, 0), Rgba([54, 54, 54, 255]));
        assert_eq!(*out.get_pixel(2, 0), Rgba([182, 182, 182, 255]));
        assert_eq!(*out.get_pixel(3, 0), Rgba([18, 18, 18, 255]));
        assert_eq!(*out.get_pixel(4, 0), Rgba([255, 255, 255, 255]));
        assert_eq!(*out.get_pixel(5, 0), Rgba([0, 0, 0, 255]));
    }
}

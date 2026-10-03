//! Generates an oversized PNG image exceeding the `MAX_PIXELS` limit
//! for manual testing.

use std::env;
use std::fs::File;
use std::io::BufWriter;
use std::path::PathBuf;

use image::codecs::png::PngEncoder;
use image::{ExtendedColorType, ImageEncoder};

/// Calculates the side length of a square image such that the total pixel count
/// exceeds `tracer::MAX_PIXELS`.
///
/// Computes the ceiling of the square root of `MAX_PIXELS`, and adds 1 if `MAX_PIXELS`
/// is an exact square.
fn calculate_oversized_side() -> u32 {
    let root = (tracer::MAX_PIXELS as f64).sqrt().ceil() as u32;
    if (root as u64) * (root as u64) == tracer::MAX_PIXELS {
        root + 1
    } else {
        root
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    let output_path = if args.len() > 1 {
        PathBuf::from(&args[1])
    } else {
        PathBuf::from("oversized.png")
    };

    let side = calculate_oversized_side();
    let width = side;
    let height = side;
    let total_pixels = (width as u64) * (height as u64);

    println!(
        "Generating oversized PNG ({width}x{height} = {total_pixels} pixels > {}) at: {}",
        tracer::MAX_PIXELS,
        output_path.display()
    );

    if let Some(parent) = output_path.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent)?;
    }

    let file = File::create(&output_path)?;
    let writer = BufWriter::new(file);
    let encoder = PngEncoder::new(writer);

    // A single-channel 8-bit buffer compresses extremely well with DEFLATE while
    // setting dimensions that exceed MAX_PIXELS.
    let raw_data = vec![0u8; (width as usize) * (height as usize)];
    encoder.write_image(&raw_data, width, height, ExtendedColorType::L8)?;

    println!(
        "Successfully wrote oversized PNG: {}",
        output_path.display()
    );
    Ok(())
}

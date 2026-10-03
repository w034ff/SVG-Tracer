//! Generates an oversized PNG image exceeding the MAX_PIXELS limit (16,777,216 pixels)
//! for manual testing.

use std::env;
use std::fs::File;
use std::io::BufWriter;
use std::path::PathBuf;

use image::codecs::png::PngEncoder;
use image::{ExtendedColorType, ImageEncoder};

/// Width exceeding the 16,777,216 pixel limit when multiplied by height (4097 * 4097 = 16,785,409).
const OVERSIZED_WIDTH: u32 = 4097;
/// Height exceeding the 16,777,216 pixel limit when multiplied by width (4097 * 4097 = 16,785,409).
const OVERSIZED_HEIGHT: u32 = 4097;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    let output_path = if args.len() > 1 {
        PathBuf::from(&args[1])
    } else {
        PathBuf::from("oversized.png")
    };

    println!(
        "Generating oversized PNG ({}x{} = {} pixels > 16,777,216) at: {}",
        OVERSIZED_WIDTH,
        OVERSIZED_HEIGHT,
        (OVERSIZED_WIDTH as u64) * (OVERSIZED_HEIGHT as u64),
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
    let raw_data = vec![0u8; (OVERSIZED_WIDTH as usize) * (OVERSIZED_HEIGHT as usize)];
    encoder.write_image(
        &raw_data,
        OVERSIZED_WIDTH,
        OVERSIZED_HEIGHT,
        ExtendedColorType::L8,
    )?;

    println!(
        "Successfully wrote oversized PNG: {}",
        output_path.display()
    );
    Ok(())
}

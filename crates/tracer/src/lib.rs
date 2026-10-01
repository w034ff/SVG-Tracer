//! Image tracing and vector conversion logic.

pub mod decode;
pub mod error;
pub mod params;
pub mod preprocess;
pub mod trace;

pub use decode::{MAX_PIXELS, SUPPORTED_EXTENSIONS, encode_png, load_image};
pub use error::TraceError;
pub use image::RgbaImage;
pub use params::{
    COLOR_PRECISION_MAX, COLOR_PRECISION_MIN, CORNER_THRESHOLD_MAX, CORNER_THRESHOLD_MIN,
    ColorMode, CurveMode, FILTER_SPECKLE_MAX, FILTER_SPECKLE_MIN, Hierarchical,
    LAYER_DIFFERENCE_MAX, LAYER_DIFFERENCE_MIN, LENGTH_THRESHOLD_MAX, LENGTH_THRESHOLD_MIN,
    MAX_ITERATIONS, PATH_PRECISION_MAX, PATH_PRECISION_MIN, Preset, SPLICE_THRESHOLD_MAX,
    SPLICE_THRESHOLD_MIN, TraceParams,
};
pub use preprocess::{
    ALPHA_THRESHOLD, REC709_B_COEFF, REC709_G_COEFF, REC709_R_COEFF, apply_p1, apply_p2, apply_p3,
    preprocess_for_trace,
};
pub use trace::{TraceOutput, count_paths, replace_svg_root, trace};

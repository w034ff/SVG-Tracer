//! Trace parameters, limits, and preset configurations per design §4.5.

use visioncortex::PathSimplifyMode as VtPathSimplifyMode;
use vtracer::{ColorMode as VtColorMode, Config as VtConfig, Hierarchical as VtHierarchical};

/// Parameter limits and default constants per design §4.5.
pub const COLOR_PRECISION_MIN: i32 = 1;
pub const COLOR_PRECISION_MAX: i32 = 8;
pub const FILTER_SPECKLE_MIN: usize = 0;
pub const FILTER_SPECKLE_MAX: usize = 16;
pub const CORNER_THRESHOLD_MIN: i32 = 0;
pub const CORNER_THRESHOLD_MAX: i32 = 180;
pub const LAYER_DIFFERENCE_MIN: i32 = 0;
pub const LAYER_DIFFERENCE_MAX: i32 = 128;
pub const LENGTH_THRESHOLD_MIN: f64 = 3.5;
pub const LENGTH_THRESHOLD_MAX: f64 = 10.0;
pub const SPLICE_THRESHOLD_MIN: i32 = 0;
pub const SPLICE_THRESHOLD_MAX: i32 = 180;
pub const PATH_PRECISION_MIN: u32 = 0;
pub const PATH_PRECISION_MAX: u32 = 8;

/// Fixed iteration limit per design §4.5 (not exposed to UI).
pub const MAX_ITERATIONS: usize = 10;

/// Color tracing mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ColorMode {
    Color,
    Binary,
}

/// Curve fitting mode for path simplification.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CurveMode {
    Spline,
    Polygon,
}

/// Layering mode for color shapes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Hierarchical {
    Stacked,
    Cutout,
}

/// Available parameter presets per design §4.5.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Preset {
    /// Preset for colored logos (default).
    ColorLogo,
    /// Preset for icons with fewer colors.
    ColorIcon,
    /// Preset for binary black-and-white images.
    Binary,
}

/// Parameters controlling VTracer vectorization.
#[derive(Debug, Clone, PartialEq)]
pub struct TraceParams {
    pub color_mode: ColorMode,
    pub color_precision: i32,
    pub filter_speckle: usize,
    pub corner_threshold: i32,
    pub curve_mode: CurveMode,
    pub layer_difference: i32,
    pub hierarchical: Hierarchical,
    pub length_threshold: f64,
    pub splice_threshold: i32,
    pub path_precision: u32,
}

impl Default for TraceParams {
    /// Returns default parameters corresponding to the "ColorLogo" preset per design §4.5.
    fn default() -> Self {
        Preset::ColorLogo.params()
    }
}

impl Preset {
    /// Returns all available presets.
    pub fn all() -> [Self; 3] {
        [Self::ColorLogo, Self::ColorIcon, Self::Binary]
    }

    /// Returns the trace parameters for this preset per design §4.5.
    pub fn params(self) -> TraceParams {
        match self {
            Self::ColorLogo => TraceParams {
                color_mode: ColorMode::Color,
                color_precision: 6,
                filter_speckle: 4,
                corner_threshold: 60,
                curve_mode: CurveMode::Spline,
                layer_difference: 16,
                hierarchical: Hierarchical::Stacked,
                length_threshold: 4.0,
                splice_threshold: 45,
                path_precision: 2,
            },
            Self::ColorIcon => TraceParams {
                color_mode: ColorMode::Color,
                color_precision: 4,
                filter_speckle: 8,
                corner_threshold: 60,
                curve_mode: CurveMode::Spline,
                layer_difference: 32,
                hierarchical: Hierarchical::Stacked,
                length_threshold: 4.0,
                splice_threshold: 45,
                path_precision: 2,
            },
            Self::Binary => TraceParams {
                color_mode: ColorMode::Binary,
                // Color-specific fields retain safe defaults even though VTracer ignores them in binary mode.
                color_precision: 6,
                filter_speckle: 4,
                corner_threshold: 60,
                curve_mode: CurveMode::Spline,
                layer_difference: 16,
                hierarchical: Hierarchical::Stacked,
                length_threshold: 4.0,
                splice_threshold: 45,
                path_precision: 2,
            },
        }
    }
}

impl TraceParams {
    /// Converts these parameters to a VTracer [`Config`].
    pub fn to_vtracer_config(&self) -> VtConfig {
        VtConfig {
            color_mode: match self.color_mode {
                ColorMode::Color => VtColorMode::Color,
                ColorMode::Binary => VtColorMode::Binary,
            },
            hierarchical: match self.hierarchical {
                Hierarchical::Stacked => VtHierarchical::Stacked,
                Hierarchical::Cutout => VtHierarchical::Cutout,
            },
            filter_speckle: self.filter_speckle,
            color_precision: self.color_precision,
            layer_difference: self.layer_difference,
            mode: match self.curve_mode {
                CurveMode::Spline => VtPathSimplifyMode::Spline,
                CurveMode::Polygon => VtPathSimplifyMode::Polygon,
            },
            corner_threshold: self.corner_threshold,
            length_threshold: self.length_threshold,
            max_iterations: MAX_ITERATIONS,
            splice_threshold: self.splice_threshold,
            path_precision: Some(self.path_precision),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_preset_matches_color_logo() {
        assert_eq!(TraceParams::default(), Preset::ColorLogo.params());
    }

    #[test]
    fn test_presets_within_valid_ranges() {
        for preset in Preset::all() {
            let p = preset.params();
            assert!(
                p.color_precision >= COLOR_PRECISION_MIN
                    && p.color_precision <= COLOR_PRECISION_MAX
            );
            assert!(p.filter_speckle <= FILTER_SPECKLE_MAX);
            assert!(
                p.corner_threshold >= CORNER_THRESHOLD_MIN
                    && p.corner_threshold <= CORNER_THRESHOLD_MAX
            );
            assert!(
                p.layer_difference >= LAYER_DIFFERENCE_MIN
                    && p.layer_difference <= LAYER_DIFFERENCE_MAX
            );
            assert!(
                p.length_threshold >= LENGTH_THRESHOLD_MIN
                    && p.length_threshold <= LENGTH_THRESHOLD_MAX
            );
            assert!(
                p.splice_threshold >= SPLICE_THRESHOLD_MIN
                    && p.splice_threshold <= SPLICE_THRESHOLD_MAX
            );
            assert!(p.path_precision <= PATH_PRECISION_MAX);
        }
    }

    #[test]
    fn test_to_vtracer_config_conversion() {
        let params = Preset::ColorLogo.params();
        let config = params.to_vtracer_config();

        assert!(matches!(config.color_mode, VtColorMode::Color));
        assert!(matches!(config.hierarchical, VtHierarchical::Stacked));
        assert_eq!(config.filter_speckle, 4);
        assert_eq!(config.color_precision, 6);
        assert_eq!(config.layer_difference, 16);
        assert!(matches!(config.mode, VtPathSimplifyMode::Spline));
        assert_eq!(config.corner_threshold, 60);
        assert_eq!(config.length_threshold, 4.0);
        assert_eq!(config.max_iterations, 10);
        assert_eq!(config.splice_threshold, 45);
        assert_eq!(config.path_precision, Some(2));
    }
}

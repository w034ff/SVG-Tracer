//! VTracer invocation and SVG post-processing per design §4.1 and §4.4.

use image::RgbaImage;
use visioncortex::ColorImage;

use crate::error::TraceError;
use crate::params::TraceParams;
use crate::preprocess::preprocess_for_trace;

/// The output of a tracing operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TraceOutput {
    /// Formatted SVG XML string.
    pub svg: String,
    /// Total number of `<path` elements contained in the SVG.
    pub path_count: usize,
}

/// Replaces the root `<svg ...>` tag of a raw SVG string with a standardized tag per design §4.4.
///
/// Preserves any preceding XML declarations or comments.
/// - Dimensions `W` and `H` are set to `orig_w` and `orig_h`.
/// - `viewBox` origin `(X, Y)` is `(1, 1)` if `has_p2_margin` is true, otherwise `(0, 0)`.
pub fn replace_svg_root(
    raw_svg: &str,
    orig_w: u32,
    orig_h: u32,
    has_p2_margin: bool,
) -> Result<String, TraceError> {
    let view_x = if has_p2_margin { 1 } else { 0 };
    let view_y = if has_p2_margin { 1 } else { 0 };
    let new_svg_tag = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{orig_w}" height="{orig_h}" viewBox="{view_x} {view_y} {orig_w} {orig_h}">"#
    );

    let start = raw_svg.find("<svg").ok_or_else(|| {
        TraceError::TraceFailed("Missing <svg> root element in tracer output".to_string())
    })?;

    let tag_slice = &raw_svg[start..];
    let end_offset = tag_slice.find('>').ok_or_else(|| {
        TraceError::TraceFailed("Unclosed <svg> tag in tracer output".to_string())
    })?;

    let end = start + end_offset;

    let mut result = String::with_capacity(raw_svg.len() + 32);
    result.push_str(&raw_svg[..start]);
    result.push_str(&new_svg_tag);
    result.push_str(&raw_svg[end + 1..]);

    Ok(result)
}

/// Counts the number of `<path` elements in an SVG string.
pub fn count_paths(svg: &str) -> usize {
    svg.matches("<path").count()
}

/// Traces an [`RgbaImage`] into SVG according to the given [`TraceParams`].
///
/// Executes preprocessing (P1/P2/P3), invokes VTracer, formats the root `<svg>` tag,
/// and returns the resulting SVG string along with path count.
pub fn trace(image: &RgbaImage, params: &TraceParams) -> Result<TraceOutput, TraceError> {
    let orig_w = image.width();
    let orig_h = image.height();

    let (processed, has_p2_margin) = preprocess_for_trace(image, params.color_mode);

    let width = processed.width() as usize;
    let height = processed.height() as usize;
    let color_img = ColorImage {
        pixels: processed.into_raw(),
        width,
        height,
    };

    let config = params.to_vtracer_config();
    let svg_file = vtracer::convert(color_img, config).map_err(TraceError::TraceFailed)?;
    let raw_svg = svg_file.to_string();

    let svg = replace_svg_root(&raw_svg, orig_w, orig_h, has_p2_margin)?;
    let path_count = count_paths(&svg);

    Ok(TraceOutput { svg, path_count })
}

#[cfg(test)]
mod tests {
    use super::*;
    use resvg::usvg::{Options, Tree};

    #[test]
    fn test_replace_svg_root_without_margin() {
        let raw = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!-- Generator: test -->\n<svg version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"80\">\n<path d=\"M0 0 L10 10\"/>\n</svg>";
        let formatted = replace_svg_root(raw, 100, 80, false).expect("Replacement should succeed");

        assert!(formatted.starts_with("<?xml version=\"1.0\" encoding=\"UTF-8\"?>"));
        assert!(formatted.contains("<!-- Generator: test -->"));
        assert!(formatted.contains("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"80\" viewBox=\"0 0 100 80\">"));
        assert!(!formatted.contains("<image"));

        // Validate XML syntax with usvg
        let tree = Tree::from_str(&formatted, &Options::default());
        assert!(tree.is_ok(), "Formatted SVG should be valid XML/SVG");
    }

    #[test]
    fn test_replace_svg_root_with_margin() {
        let raw =
            "<svg version=\"1.1\" width=\"102\" height=\"82\">\n<path d=\"M1 1 L11 11\"/>\n</svg>";
        let formatted = replace_svg_root(raw, 100, 80, true).expect("Replacement should succeed");

        assert_eq!(
            formatted,
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"80\" viewBox=\"1 1 100 80\">\n<path d=\"M1 1 L11 11\"/>\n</svg>"
        );
        assert!(!formatted.contains("<image"));

        let tree = Tree::from_str(&formatted, &Options::default());
        assert!(tree.is_ok(), "Formatted SVG should be valid XML/SVG");
    }

    #[test]
    fn test_replace_svg_root_missing_svg_tag() {
        let invalid = "<div>Hello</div>";
        let err = replace_svg_root(invalid, 10, 10, false);
        assert!(err.is_err());
    }

    #[test]
    fn test_count_paths() {
        let svg = "<svg><path d=\"...\"/><path d=\"...\"/><g><path d=\"...\"/></g></svg>";
        assert_eq!(count_paths(svg), 3);
        assert_eq!(count_paths("<svg></svg>"), 0);
    }
}

//! Image tracing and vector conversion logic.

/// Returns the tracer version.
#[must_use]
pub fn tracer_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tracer_version() {
        assert_eq!(tracer_version(), "0.1.0");
    }
}

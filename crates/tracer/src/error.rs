//! Error types for tracer operations.

use std::fmt;

/// Errors that can occur during image tracing and vector conversion.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TraceError {
    /// VTracer conversion or SVG formatting failed.
    TraceFailed(String),
}

impl fmt::Display for TraceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TraceFailed(detail) => write!(f, "Trace failed: {detail}"),
        }
    }
}

impl std::error::Error for TraceError {}

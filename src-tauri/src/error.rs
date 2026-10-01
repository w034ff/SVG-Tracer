//! Error types and IPC serialization per design §5.5.

use serde::{Deserialize, Serialize};
use tracer::TraceError;
use ts_rs::TS;

/// Error codes returned across IPC per design §5.5.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub enum ErrorCode {
    UnsupportedFormat,
    DecodeFailed,
    TooLarge,
    ReadFailed,
    WriteFailed,
    TraceFailed,
    Superseded,
    BatchRunning,
    UnknownHandle,
    InvalidParams,
}

/// Unified error payload returned across IPC per design §5.5.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct IpcError {
    pub code: ErrorCode,
    pub detail: Option<String>,
}

impl IpcError {
    /// Creates a new error with an optional detail string.
    pub fn new(code: ErrorCode, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: Some(detail.into()),
        }
    }

    /// Creates an error with no detail.
    pub fn from_code(code: ErrorCode) -> Self {
        Self { code, detail: None }
    }
}

impl From<TraceError> for IpcError {
    fn from(err: TraceError) -> Self {
        match err {
            TraceError::UnsupportedFormat => Self::from_code(ErrorCode::UnsupportedFormat),
            TraceError::DecodeFailed => Self::from_code(ErrorCode::DecodeFailed),
            TraceError::TooLarge => Self::from_code(ErrorCode::TooLarge),
            TraceError::ReadFailed(msg) => Self::new(ErrorCode::ReadFailed, msg),
            TraceError::TraceFailed(msg) => Self::new(ErrorCode::TraceFailed, msg),
            TraceError::InvalidParams => Self::from_code(ErrorCode::InvalidParams),
        }
    }
}

impl std::fmt::Display for IpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if let Some(detail) = &self.detail {
            write!(f, "{:?}: {}", self.code, detail)
        } else {
            write!(f, "{:?}", self.code)
        }
    }
}

impl std::error::Error for IpcError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ipc_error_serialization_without_detail() {
        let err = IpcError::from_code(ErrorCode::InvalidParams);
        let json = serde_json::to_string(&err).expect("serialization should succeed");
        assert_eq!(json, r#"{"code":"InvalidParams","detail":null}"#);
    }

    #[test]
    fn test_ipc_error_serialization_with_detail() {
        let err = IpcError::new(ErrorCode::ReadFailed, "file not found");
        let json = serde_json::to_string(&err).expect("serialization should succeed");
        assert_eq!(json, r#"{"code":"ReadFailed","detail":"file not found"}"#);
    }

    #[test]
    fn test_from_trace_error() {
        assert_eq!(
            IpcError::from(TraceError::UnsupportedFormat),
            IpcError::from_code(ErrorCode::UnsupportedFormat)
        );
        assert_eq!(
            IpcError::from(TraceError::DecodeFailed),
            IpcError::from_code(ErrorCode::DecodeFailed)
        );
        assert_eq!(
            IpcError::from(TraceError::TooLarge),
            IpcError::from_code(ErrorCode::TooLarge)
        );
        assert_eq!(
            IpcError::from(TraceError::ReadFailed("disk error".into())),
            IpcError::new(ErrorCode::ReadFailed, "disk error")
        );
        assert_eq!(
            IpcError::from(TraceError::TraceFailed("vtracer error".into())),
            IpcError::new(ErrorCode::TraceFailed, "vtracer error")
        );
        assert_eq!(
            IpcError::from(TraceError::InvalidParams),
            IpcError::from_code(ErrorCode::InvalidParams)
        );
    }
}

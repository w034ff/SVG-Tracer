use std::path::PathBuf;
use std::sync::atomic::Ordering;

use svg_tracer_lib::AppState;
use svg_tracer_lib::commands::{convert_internal, get_param_spec, load_preview_internal};
use svg_tracer_lib::error::ErrorCode;
use tracer::{Preset, TraceParams};

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../crates/tracer/tests/fixtures")
}

#[test]
fn test_convert_superseded_older_sequence_rejected_before_trace() {
    tauri::async_runtime::block_on(async {
        let state = AppState::default();
        let fixture = fixtures_dir().join("logo_color.png");
        let (id, _) = state.handles.register(fixture);

        // Simulate that state has already seen request with seq = 10
        state.latest_seq.store(10, Ordering::SeqCst);

        // Request with older seq = 5 must be rejected with Superseded before conversion
        let err = convert_internal(id, TraceParams::default(), 5, &state)
            .await
            .expect_err("older sequence number should be superseded");

        assert_eq!(err.code, ErrorCode::Superseded);
        assert_eq!(err.detail, None);
    });
}

#[test]
fn test_convert_superseded_mid_flight() {
    tauri::async_runtime::block_on(async {
        let state = AppState::default();
        let fixture = fixtures_dir().join("logo_color.png");
        let (id, _) = state.handles.register(fixture);

        // Initial seq = 1
        state.latest_seq.store(1, Ordering::SeqCst);

        // Now update seq to 2 before running convert with seq = 1
        state.latest_seq.store(2, Ordering::SeqCst);

        let err = convert_internal(id, TraceParams::default(), 1, &state)
            .await
            .expect_err("superseded sequence should fail");

        assert_eq!(err.code, ErrorCode::Superseded);
    });
}

#[test]
fn test_convert_success_with_latest_seq() {
    tauri::async_runtime::block_on(async {
        let state = AppState::default();
        let fixture = fixtures_dir().join("logo_color.png");
        let (id, name) = state.handles.register(fixture);
        assert_eq!(name, "logo_color.png");

        let result = convert_internal(id.clone(), TraceParams::default(), 1, &state)
            .await
            .expect("conversion with latest seq should succeed");

        assert!(result.svg.contains("<svg"));
        assert!(result.svg.contains("viewBox=\"1 1"));
        assert!(result.path_count > 0);
        assert_eq!(result.bytes, result.svg.len());

        // Verify last_svg was recorded in the handle store
        let handle = state.handles.get(&id).expect("handle should exist");
        assert_eq!(handle.last_svg, Some(result.svg));
    });
}

#[test]
fn test_convert_unknown_handle() {
    tauri::async_runtime::block_on(async {
        let state = AppState::default();
        let err = convert_internal(
            "non-existent-id".to_string(),
            TraceParams::default(),
            1,
            &state,
        )
        .await
        .expect_err("unknown handle must return error");

        assert_eq!(err.code, ErrorCode::UnknownHandle);
    });
}

#[test]
fn test_convert_invalid_params() {
    tauri::async_runtime::block_on(async {
        let state = AppState::default();
        let fixture = fixtures_dir().join("logo_color.png");
        let (id, _) = state.handles.register(fixture);

        let invalid_params = TraceParams {
            color_precision: 999,
            ..TraceParams::default()
        };

        let err = convert_internal(id, invalid_params, 1, &state)
            .await
            .expect_err("out of range params must fail");

        assert_eq!(err.code, ErrorCode::InvalidParams);
    });
}

#[test]
fn test_load_preview_success() {
    tauri::async_runtime::block_on(async {
        let state = AppState::default();
        let fixture = fixtures_dir().join("logo_color.png");
        let (id, _) = state.handles.register(fixture);

        let bytes = load_preview_internal(&id, &state)
            .await
            .expect("load_preview should succeed");

        // Must be valid PNG (PNG magic bytes: 0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n')
        assert!(bytes.len() > 8);
        assert_eq!(
            &bytes[0..8],
            &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]
        );

        // Subsequent call must return cached bytes
        let cached_bytes = load_preview_internal(&id, &state)
            .await
            .expect("cached load_preview should succeed");
        assert_eq!(bytes, cached_bytes);
    });
}

#[test]
fn test_load_preview_unknown_handle() {
    tauri::async_runtime::block_on(async {
        let state = AppState::default();
        let err = load_preview_internal("non-existent", &state)
            .await
            .expect_err("unknown handle should fail");
        assert_eq!(err.code, ErrorCode::UnknownHandle);
    });
}

#[test]
fn test_load_preview_corrupt_file() {
    tauri::async_runtime::block_on(async {
        let state = AppState::default();
        let fixture = fixtures_dir().join("corrupt.png");
        let (id, _) = state.handles.register(fixture);

        let err = load_preview_internal(&id, &state)
            .await
            .expect_err("corrupt image should fail decode");
        assert_eq!(err.code, ErrorCode::DecodeFailed);
    });
}

#[test]
fn test_load_preview_unsupported_format() {
    tauri::async_runtime::block_on(async {
        let state = AppState::default();
        let fixture = fixtures_dir().join("not_image.png");
        let (id, _) = state.handles.register(fixture);

        let err = load_preview_internal(&id, &state)
            .await
            .expect_err("non-image file should return unsupported format");
        assert_eq!(err.code, ErrorCode::UnsupportedFormat);
    });
}

#[test]
fn test_get_param_spec_presets_and_ranges() {
    let spec = get_param_spec();
    assert_eq!(spec.default_preset, Preset::ColorLogo);
    assert_eq!(spec.presets.len(), 3);

    // Verify ranges correspond to design §4.5
    assert_eq!(spec.ranges.color_precision.min, 1);
    assert_eq!(spec.ranges.color_precision.max, 8);
    assert_eq!(spec.ranges.filter_speckle.min, 0);
    assert_eq!(spec.ranges.filter_speckle.max, 16);
    assert_eq!(spec.ranges.corner_threshold.min, 0);
    assert_eq!(spec.ranges.corner_threshold.max, 180);
    assert_eq!(spec.ranges.layer_difference.min, 0);
    assert_eq!(spec.ranges.layer_difference.max, 128);
    assert_eq!(spec.ranges.length_threshold.min, 3.5);
    assert_eq!(spec.ranges.length_threshold.max, 10.0);
    assert_eq!(spec.ranges.splice_threshold.min, 0);
    assert_eq!(spec.ranges.splice_threshold.max, 180);
    assert_eq!(spec.ranges.path_precision.min, 0);
    assert_eq!(spec.ranges.path_precision.max, 8);
}

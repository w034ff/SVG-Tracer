use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use svg_tracer_lib::batch::{
    BatchCallbacks, BatchFinishedPayload, BatchItemPayload, BatchItemStatus, BatchProgressPayload,
    BatchState, enumerate_targets, run_batch, save_svg_atomic, select_batch_input_internal,
    select_batch_output_internal, start_batch_internal,
};
use svg_tracer_lib::error::ErrorCode;
use tracer::TraceParams;

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../crates/tracer/tests/fixtures")
}

#[test]
fn test_batch_success_and_failure_mixed() {
    let input_dir = tempfile::tempdir().expect("failed to create temp input dir");
    let output_dir = tempfile::tempdir().expect("failed to create temp output dir");

    // Copy one valid fixture and one corrupt fixture
    let valid_src = fixtures_dir().join("logo_color.png");
    let corrupt_src = fixtures_dir().join("corrupt.png");

    fs::copy(&valid_src, input_dir.path().join("logo_color.png"))
        .expect("copy valid fixture failed");
    fs::copy(&corrupt_src, input_dir.path().join("corrupt.png"))
        .expect("copy corrupt fixture failed");

    let items = Arc::new(Mutex::new(Vec::<BatchItemPayload>::new()));
    let items_clone = Arc::clone(&items);
    let on_item = move |payload: BatchItemPayload| {
        items_clone
            .lock()
            .expect("mutex should not be poisoned")
            .push(payload);
    };

    let finished = Arc::new(Mutex::new(None::<BatchFinishedPayload>));
    let finished_clone = Arc::clone(&finished);
    let on_finished = move |payload: BatchFinishedPayload| {
        *finished_clone.lock().expect("mutex should not be poisoned") = Some(payload);
    };

    let on_progress = |_payload: BatchProgressPayload| {};

    let cancel_flag = Arc::new(AtomicBool::new(false));
    let is_running = Arc::new(AtomicBool::new(true));

    let callbacks = BatchCallbacks {
        on_progress,
        on_item,
        on_finished,
    };

    run_batch(
        input_dir.path().to_path_buf(),
        output_dir.path().to_path_buf(),
        TraceParams::default(),
        cancel_flag,
        is_running,
        callbacks,
    )
    .expect("run_batch must succeed");

    // Check saved file
    let saved_svg_path = output_dir.path().join("logo_color.svg");
    assert!(saved_svg_path.exists(), "logo_color.svg should be saved");
    let svg_content = fs::read_to_string(&saved_svg_path).expect("read svg failed");
    assert!(svg_content.contains("<svg"));

    // Verify corrupt file was not saved as svg
    assert!(
        !output_dir.path().join("corrupt.svg").exists(),
        "corrupt.svg should not exist"
    );

    // Check item notifications
    let recorded_items = items.lock().expect("mutex should not be poisoned").clone();
    assert_eq!(recorded_items.len(), 2);

    let valid_item = recorded_items
        .iter()
        .find(|item| item.name == "logo_color.png")
        .expect("valid item event must exist");
    assert_eq!(valid_item.status, BatchItemStatus::Ok);
    assert_eq!(valid_item.output_name.as_deref(), Some("logo_color.svg"));
    assert!(valid_item.error.is_none());

    let corrupt_item = recorded_items
        .iter()
        .find(|item| item.name == "corrupt.png")
        .expect("corrupt item event must exist");
    assert_eq!(corrupt_item.status, BatchItemStatus::Failed);
    assert_eq!(corrupt_item.output_name, None);
    let err = corrupt_item.error.as_ref().expect("error must be recorded");
    assert_eq!(err.code, ErrorCode::DecodeFailed);

    // Check finished notification
    let final_summary = finished
        .lock()
        .expect("mutex should not be poisoned")
        .clone()
        .expect("batch-finished must be called");
    assert_eq!(final_summary.succeeded, 1);
    assert_eq!(final_summary.failed, 1);
    assert_eq!(final_summary.skipped, 0);
    assert!(!final_summary.cancelled);
}

#[test]
fn test_batch_ignored_items_enumeration() {
    let input_dir = tempfile::tempdir().expect("failed to create temp dir");
    let dir = input_dir.path();

    // 1. Regular supported file
    fs::write(dir.join("photo.png"), b"dummy").expect("write failed");

    // 2. Hidden file (. prefix)
    fs::write(dir.join(".hidden.png"), b"dummy").expect("write failed");

    // 3. Subdirectory
    let sub = dir.join("subfolder");
    fs::create_dir(&sub).expect("create_dir failed");
    fs::write(sub.join("nested.png"), b"dummy").expect("write nested failed");

    // 4. Unsupported extension
    fs::write(dir.join("notes.txt"), b"dummy").expect("write failed");

    // 5. Symlink (Unix only)
    #[cfg(unix)]
    let expected_ignored = 4;
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(dir.join("photo.png"), dir.join("symlink.png"))
            .expect("symlink failed");
    }

    #[cfg(not(unix))]
    let expected_ignored = 3;

    let (targets, ignored_count) =
        enumerate_targets(dir).expect("enumerate_targets should succeed");

    assert_eq!(targets, vec!["photo.png"]);
    assert_eq!(ignored_count, expected_ignored);
}

#[test]
fn test_batch_output_name_collision_resolution() {
    let input_dir = tempfile::tempdir().expect("failed to create temp input dir");
    let output_dir = tempfile::tempdir().expect("failed to create temp output dir");

    let valid_src = fixtures_dir().join("logo_color.png");

    // Inputs colliding with each other: logo.png and logo.jpg
    fs::copy(&valid_src, input_dir.path().join("logo.png")).expect("copy failed");
    fs::copy(&valid_src, input_dir.path().join("logo.jpg")).expect("copy failed");

    // Pre-existing file in output directory: logo.svg
    let pre_existing_path = output_dir.path().join("logo.svg");
    fs::write(&pre_existing_path, "pre-existing logo svg").expect("write failed");

    let cancel_flag = Arc::new(AtomicBool::new(false));
    let is_running = Arc::new(AtomicBool::new(true));

    let callbacks = BatchCallbacks {
        on_progress: |_| {},
        on_item: |_| {},
        on_finished: |_| {},
    };

    run_batch(
        input_dir.path().to_path_buf(),
        output_dir.path().to_path_buf(),
        TraceParams::default(),
        cancel_flag,
        is_running,
        callbacks,
    )
    .expect("run_batch should succeed");

    // Pre-existing file must NOT be overwritten
    let existing_content = fs::read_to_string(&pre_existing_path).expect("read failed");
    assert_eq!(existing_content, "pre-existing logo svg");

    // Outputs should be numbered per design §5.3
    let output_1 = output_dir.path().join("logo (1).svg");
    let output_2 = output_dir.path().join("logo (2).svg");

    assert!(output_1.exists(), "logo (1).svg must exist");
    assert!(output_2.exists(), "logo (2).svg must exist");

    let content_1 = fs::read_to_string(&output_1).expect("read failed");
    let content_2 = fs::read_to_string(&output_2).expect("read failed");
    assert!(content_1.contains("<svg"));
    assert!(content_2.contains("<svg"));
}

#[test]
fn test_batch_cancellation_stops_new_files_and_cleans_temp() {
    let input_dir = tempfile::tempdir().expect("failed to create temp input dir");
    let output_dir = tempfile::tempdir().expect("failed to create temp output dir");

    let valid_src = fixtures_dir().join("logo_color.png");

    // Create 30 input files to exceed thread pool capacity and guarantee skipped items
    const TOTAL_FILES: usize = 30;
    for i in 0..TOTAL_FILES {
        fs::copy(&valid_src, input_dir.path().join(format!("img_{i:02}.png")))
            .expect("copy failed");
    }

    let cancel_flag = Arc::new(AtomicBool::new(false));
    let is_running = Arc::new(AtomicBool::new(true));

    let cancel_flag_clone = Arc::clone(&cancel_flag);
    let items_count = Arc::new(Mutex::new(0usize));
    let items_count_clone = Arc::clone(&items_count);

    let on_item = move |_item: BatchItemPayload| {
        let mut count = items_count_clone
            .lock()
            .expect("mutex should not be poisoned");
        *count += 1;
        // Signal cancellation immediately after the first file completes
        if *count >= 1 {
            cancel_flag_clone.store(true, Ordering::SeqCst);
        }
    };

    let finished = Arc::new(Mutex::new(None::<BatchFinishedPayload>));
    let finished_clone = Arc::clone(&finished);
    let on_finished = move |payload: BatchFinishedPayload| {
        *finished_clone.lock().expect("mutex should not be poisoned") = Some(payload);
    };

    let callbacks = BatchCallbacks {
        on_progress: |_| {},
        on_item,
        on_finished,
    };

    run_batch(
        input_dir.path().to_path_buf(),
        output_dir.path().to_path_buf(),
        TraceParams::default(),
        cancel_flag,
        is_running,
        callbacks,
    )
    .expect("run_batch should succeed");

    let summary = finished
        .lock()
        .expect("mutex should not be poisoned")
        .clone()
        .expect("finished summary must exist");

    assert!(summary.cancelled, "cancelled must be true");
    assert!(
        summary.skipped > 0,
        "at least some files should have been skipped"
    );
    assert_eq!(
        summary.succeeded + summary.failed + summary.skipped,
        TOTAL_FILES
    );

    // Output directory must contain ONLY the successfully saved files; no temp files
    let mut actual_files = Vec::new();
    for entry in fs::read_dir(output_dir.path()).expect("read_dir failed") {
        let entry = entry.expect("valid entry");
        actual_files.push(entry.file_name().to_string_lossy().to_string());
    }

    assert_eq!(actual_files.len(), summary.succeeded);
    for name in &actual_files {
        assert!(
            name.ends_with(".svg"),
            "file must be clean SVG, not a temporary file: {name}"
        );
        assert!(
            !name.contains(".tmp"),
            "temporary files must not remain in output directory: {name}"
        );
    }
}

#[test]
fn test_save_svg_atomic_does_not_overwrite_if_created_before_save() {
    let output_dir = tempfile::tempdir().expect("failed to create temp output dir");
    let used_names_lower = Mutex::new(HashSet::new());

    let target_name = "icon.svg";
    let pre_existing_path = output_dir.path().join(target_name);
    let original_content = "pre-existing-content-that-must-remain";
    fs::write(&pre_existing_path, original_content).expect("write failed");

    // Call atomic save directly per user specification
    let saved_name = save_svg_atomic(
        output_dir.path(),
        "icon",
        target_name,
        "<svg>new-vector-data</svg>",
        &used_names_lower,
    )
    .expect("save_svg_atomic should succeed");

    assert_eq!(saved_name, "icon (1).svg");

    // Verify original file was unchanged
    let existing_now = fs::read_to_string(&pre_existing_path).expect("read failed");
    assert_eq!(existing_now, original_content);

    // Verify new file exists with new content
    let new_path = output_dir.path().join("icon (1).svg");
    assert!(new_path.exists());
    let new_content = fs::read_to_string(&new_path).expect("read failed");
    assert_eq!(new_content, "<svg>new-vector-data</svg>");

    // Now simulate icon (1).svg was also created in used/disk, next should be icon (2).svg
    let second_saved = save_svg_atomic(
        output_dir.path(),
        "icon",
        target_name,
        "<svg>another-one</svg>",
        &used_names_lower,
    )
    .expect("save_svg_atomic should succeed again");

    assert_eq!(second_saved, "icon (2).svg");
    let second_path = output_dir.path().join("icon (2).svg");
    assert!(second_path.exists());
}

#[test]
fn test_start_batch_rejected_when_running_or_invalid() {
    let state = BatchState::new();

    let dummy_callbacks = || BatchCallbacks {
        on_progress: |_| {},
        on_item: |_| {},
        on_finished: |_| {},
    };

    // 1. Rejects with UnknownHandle if input or output folder is missing
    let err = start_batch_internal(TraceParams::default(), &state, dummy_callbacks())
        .expect_err("should fail when input/output not selected");
    assert_eq!(err.code, ErrorCode::UnknownHandle);

    let input_dir = tempfile::tempdir().expect("failed temp dir");
    let output_dir = tempfile::tempdir().expect("failed temp dir");

    select_batch_input_internal(input_dir.path().to_path_buf(), &state)
        .expect("select input must succeed");

    // Output is still missing
    let err = start_batch_internal(TraceParams::default(), &state, dummy_callbacks())
        .expect_err("should fail when output not selected");
    assert_eq!(err.code, ErrorCode::UnknownHandle);

    select_batch_output_internal(output_dir.path().to_path_buf(), &state);

    // 2. Rejects with InvalidParams if parameters are out of range
    let invalid_params = TraceParams {
        color_precision: 999,
        ..TraceParams::default()
    };
    let err = start_batch_internal(invalid_params, &state, dummy_callbacks())
        .expect_err("should fail when parameters are invalid");
    assert_eq!(err.code, ErrorCode::InvalidParams);

    // 3. Rejects with BatchRunning if already running
    state.is_running.store(true, Ordering::SeqCst);
    let err = start_batch_internal(TraceParams::default(), &state, dummy_callbacks())
        .expect_err("should fail when already running");
    assert_eq!(err.code, ErrorCode::BatchRunning);
}

#[test]
fn test_start_batch_rejected_when_input_dir_deleted() {
    let state = BatchState::new();

    let input_dir = tempfile::tempdir().expect("failed temp dir");
    let output_dir = tempfile::tempdir().expect("failed temp dir");

    let input_path = input_dir.path().to_path_buf();
    let output_path = output_dir.path().to_path_buf();

    select_batch_input_internal(input_path.clone(), &state).expect("select input must succeed");
    select_batch_output_internal(output_path, &state);

    // Delete the input directory after selection
    drop(input_dir);

    let dummy_callbacks = || BatchCallbacks {
        on_progress: |_| {},
        on_item: |_| {},
        on_finished: |_| {},
    };

    let err = start_batch_internal(TraceParams::default(), &state, dummy_callbacks())
        .expect_err("start_batch_internal should fail synchronously on deleted input dir");

    assert_eq!(err.code, ErrorCode::ReadFailed);
    assert!(
        !state.is_running.load(Ordering::SeqCst),
        "is_running must be reset to false when start_batch preparation fails"
    );
}

#[test]
fn test_save_svg_atomic_avoids_assigned_names_in_same_batch() {
    let output_dir = tempfile::tempdir().expect("failed to create temp output dir");

    // Pre-create only icon.svg on disk
    let target_name = "icon.svg";
    let pre_existing_path = output_dir.path().join(target_name);
    fs::write(&pre_existing_path, "pre-existing-disk-content").expect("write failed");

    // icon (1).svg is not on disk, but was already assigned to another input in this batch
    let mut used_set = HashSet::new();
    used_set.insert("icon (1).svg".to_string());
    let used_names_lower = Mutex::new(used_set);

    let saved_name = save_svg_atomic(
        output_dir.path(),
        "icon",
        target_name,
        "<svg>new-content</svg>",
        &used_names_lower,
    )
    .expect("save_svg_atomic should succeed");

    // Must jump to icon (2).svg avoiding both disk-existing icon.svg and assigned icon (1).svg
    assert_eq!(saved_name, "icon (2).svg");

    // Verify icon.svg remains unchanged
    assert_eq!(
        fs::read_to_string(&pre_existing_path).expect("read failed"),
        "pre-existing-disk-content"
    );

    // Verify icon (1).svg was never created
    assert!(!output_dir.path().join("icon (1).svg").exists());

    // Verify icon (2).svg was created with new content
    let created_path = output_dir.path().join("icon (2).svg");
    assert!(created_path.exists());
    assert_eq!(
        fs::read_to_string(&created_path).expect("read failed"),
        "<svg>new-content</svg>"
    );
}

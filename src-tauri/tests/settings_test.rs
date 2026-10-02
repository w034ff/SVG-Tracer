use std::fs;
use std::path::PathBuf;

use svg_tracer_lib::AppState;
use svg_tracer_lib::commands::{
    get_about_internal, get_settings_internal, pick_batch_input_internal,
    pick_batch_output_internal, save_settings_internal,
};
use svg_tracer_lib::error::ErrorCode;
use svg_tracer_lib::settings::{
    Language, SCHEMA_VERSION, SETTINGS_FILE_NAME, SettingsFile, load_settings, save_settings_to_dir,
};
use tempfile::tempdir;
use tracer::Preset;

#[test]
fn test_roundtrip_save_and_load_matches_original() {
    let config_dir = tempdir().expect("tempdir creation should succeed");
    let input_dir = tempdir().expect("tempdir creation should succeed");
    let output_dir = tempdir().expect("tempdir creation should succeed");

    let initial = SettingsFile {
        schema_version: SCHEMA_VERSION,
        language: Some(Language::En),
        preset: Some(Preset::ColorIcon),
        params: Preset::ColorIcon.params(),
        batch_input_dir: Some(input_dir.path().to_path_buf()),
        batch_output_dir: Some(output_dir.path().to_path_buf()),
    };

    save_settings_to_dir(config_dir.path(), &initial).expect("save_settings_to_dir should succeed");
    let loaded = load_settings(config_dir.path());

    assert_eq!(loaded.schema_version, SCHEMA_VERSION);
    assert_eq!(loaded.language, Some(Language::En));
    assert_eq!(loaded.preset, Some(Preset::ColorIcon));
    assert_eq!(loaded.params, Preset::ColorIcon.params());
    assert_eq!(loaded.batch_input_dir, Some(input_dir.path().to_path_buf()));
    assert_eq!(
        loaded.batch_output_dir,
        Some(output_dir.path().to_path_buf())
    );
}

#[test]
fn test_roundtrip_custom_preset_retains_null_preset_and_custom_params() {
    let config_dir = tempdir().expect("tempdir creation should succeed");

    let mut custom_params = Preset::ColorLogo.params();
    custom_params.corner_threshold = 120;
    custom_params.filter_speckle = 10;

    let initial = SettingsFile {
        schema_version: SCHEMA_VERSION,
        language: Some(Language::Ja),
        preset: None,
        params: custom_params.clone(),
        batch_input_dir: None,
        batch_output_dir: None,
    };

    save_settings_to_dir(config_dir.path(), &initial).expect("save_settings_to_dir should succeed");
    let loaded = load_settings(config_dir.path());

    assert_eq!(loaded.preset, None);
    assert_eq!(loaded.params, custom_params);
    assert_eq!(loaded.language, Some(Language::Ja));
}

#[test]
fn test_load_corrupted_json_returns_defaults() {
    let config_dir = tempdir().expect("tempdir creation should succeed");
    let file_path = config_dir.path().join(SETTINGS_FILE_NAME);

    // Malformed JSON syntax
    fs::write(&file_path, "{ broken json content").expect("writing file should succeed");
    let loaded = load_settings(config_dir.path());
    assert_eq!(loaded, SettingsFile::default());

    // Valid JSON but non-object type (array)
    let array_json =
        serde_json::to_string(&serde_json::json!([1, 2, 3])).expect("serialization should succeed");
    fs::write(&file_path, array_json).expect("writing file should succeed");
    let loaded = load_settings(config_dir.path());
    assert_eq!(loaded, SettingsFile::default());
}

#[test]
fn test_load_unknown_schema_version_returns_defaults() {
    let config_dir = tempdir().expect("tempdir creation should succeed");
    let file_path = config_dir.path().join(SETTINGS_FILE_NAME);

    // Future/unknown schema version (99)
    let json_future = serde_json::json!({
        "schemaVersion": 99,
        "language": "ja",
        "preset": "colorIcon",
        "params": Preset::ColorIcon.params(),
        "batchInputDir": null,
        "batchOutputDir": null
    });
    fs::write(
        &file_path,
        serde_json::to_string(&json_future).expect("serialization should succeed"),
    )
    .expect("writing file should succeed");
    let loaded = load_settings(config_dir.path());
    assert_eq!(loaded, SettingsFile::default());

    // Missing schemaVersion
    let json_missing_version = serde_json::json!({
        "language": "ja",
        "preset": "colorIcon"
    });
    fs::write(
        &file_path,
        serde_json::to_string(&json_missing_version).expect("serialization should succeed"),
    )
    .expect("writing file should succeed");
    let loaded = load_settings(config_dir.path());
    assert_eq!(loaded, SettingsFile::default());
}

#[test]
fn test_load_nonexistent_directories_resets_folders_to_unselected() {
    let config_dir = tempdir().expect("tempdir creation should succeed");
    let file_path = config_dir.path().join(SETTINGS_FILE_NAME);

    let json = serde_json::json!({
        "schemaVersion": 1,
        "language": null,
        "preset": "colorLogo",
        "params": Preset::ColorLogo.params(),
        "batchInputDir": "/nonexistent/directory/input/path",
        "batchOutputDir": "/nonexistent/directory/output/path"
    });

    fs::write(
        &file_path,
        serde_json::to_string(&json).expect("serialization should succeed"),
    )
    .expect("writing file should succeed");
    let loaded = load_settings(config_dir.path());

    assert_eq!(loaded.batch_input_dir, None);
    assert_eq!(loaded.batch_output_dir, None);
    assert_eq!(loaded, SettingsFile::default());
}

#[test]
fn test_load_unknown_preset_resets_preset_and_params_preserving_language_and_folders() {
    let config_dir = tempdir().expect("tempdir creation should succeed");
    let input_dir = tempdir().expect("tempdir creation should succeed");
    let output_dir = tempdir().expect("tempdir creation should succeed");
    let file_path = config_dir.path().join(SETTINGS_FILE_NAME);

    let json = serde_json::json!({
        "schemaVersion": 1,
        "language": "ja",
        "preset": "nonExistentPresetName",
        "params": Preset::ColorIcon.params(),
        "batchInputDir": input_dir.path(),
        "batchOutputDir": output_dir.path()
    });

    fs::write(
        &file_path,
        serde_json::to_string(&json).expect("serialization should succeed"),
    )
    .expect("writing file should succeed");
    let loaded = load_settings(config_dir.path());

    // Both preset and params must be reset to ColorLogo defaults
    assert_eq!(loaded.preset, Some(Preset::ColorLogo));
    assert_eq!(loaded.params, Preset::ColorLogo.params());

    // Language and directories must be preserved
    assert_eq!(loaded.language, Some(Language::Ja));
    assert_eq!(loaded.batch_input_dir, Some(input_dir.path().to_path_buf()));
    assert_eq!(
        loaded.batch_output_dir,
        Some(output_dir.path().to_path_buf())
    );
}

#[test]
fn test_load_out_of_bounds_params_resets_preset_and_params_preserving_language_and_folders() {
    let config_dir = tempdir().expect("tempdir creation should succeed");
    let input_dir = tempdir().expect("tempdir creation should succeed");
    let output_dir = tempdir().expect("tempdir creation should succeed");
    let file_path = config_dir.path().join(SETTINGS_FILE_NAME);

    let mut invalid_params = Preset::ColorIcon.params();
    invalid_params.color_precision = 99;

    let json = serde_json::json!({
        "schemaVersion": 1,
        "language": "en",
        "preset": "colorIcon",
        "params": invalid_params,
        "batchInputDir": input_dir.path(),
        "batchOutputDir": output_dir.path()
    });

    fs::write(
        &file_path,
        serde_json::to_string(&json).expect("serialization should succeed"),
    )
    .expect("writing file should succeed");
    let loaded = load_settings(config_dir.path());

    // Both preset and params must be reset to defaults
    assert_eq!(loaded.preset, Some(Preset::ColorLogo));
    assert_eq!(loaded.params, Preset::ColorLogo.params());

    // Language and directories must be preserved
    assert_eq!(loaded.language, Some(Language::En));
    assert_eq!(loaded.batch_input_dir, Some(input_dir.path().to_path_buf()));
    assert_eq!(
        loaded.batch_output_dir,
        Some(output_dir.path().to_path_buf())
    );
}

#[test]
fn test_load_invalid_language_falls_back_to_none_preserving_other_fields() {
    let config_dir = tempdir().expect("tempdir creation should succeed");
    let file_path = config_dir.path().join(SETTINGS_FILE_NAME);

    // Unknown language string "french"
    let json = serde_json::json!({
        "schemaVersion": 1,
        "language": "french",
        "preset": "colorIcon",
        "params": Preset::ColorIcon.params(),
        "batchInputDir": null,
        "batchOutputDir": null
    });

    fs::write(
        &file_path,
        serde_json::to_string(&json).expect("serialization should succeed"),
    )
    .expect("writing file should succeed");
    let loaded = load_settings(config_dir.path());

    assert_eq!(loaded.language, None);
    assert_eq!(loaded.preset, Some(Preset::ColorIcon));
    assert_eq!(loaded.params, Preset::ColorIcon.params());

    // Ensure deserializing invalid language fails at serde level
    assert!(serde_json::from_str::<Language>(r#""french""#).is_err());
}

#[test]
fn test_save_settings_with_invalid_params_returns_invalid_params_and_does_not_save() {
    let config_dir = tempdir().expect("tempdir creation should succeed");
    let file_path = config_dir.path().join(SETTINGS_FILE_NAME);

    let state = AppState::default();
    state.init_settings(config_dir.path().to_path_buf());

    // Save initial valid settings
    let valid_params = Preset::ColorLogo.params();
    save_settings_internal(
        Some(Language::Ja),
        Some(Preset::ColorLogo),
        valid_params.clone(),
        &state,
    )
    .expect("initial valid save should succeed");

    assert!(file_path.exists());
    let saved_before = fs::read_to_string(&file_path).expect("reading file should succeed");

    // Attempt to save invalid params (colorPrecision = 99)
    let mut invalid_params = valid_params.clone();
    invalid_params.color_precision = 99;

    let result = save_settings_internal(
        Some(Language::En),
        Some(Preset::ColorIcon),
        invalid_params,
        &state,
    );

    match result {
        Err(err) => assert_eq!(err.code, ErrorCode::InvalidParams),
        Ok(_) => panic!("Expected save_settings to fail with InvalidParams"),
    }

    // In-memory state must remain unchanged
    let in_memory = state
        .settings
        .file
        .lock()
        .expect("mutex should not be poisoned")
        .clone();
    assert_eq!(in_memory.language, Some(Language::Ja));
    assert_eq!(in_memory.preset, Some(Preset::ColorLogo));
    assert_eq!(in_memory.params, valid_params);

    // On-disk file must remain unchanged
    let saved_after = fs::read_to_string(&file_path).expect("reading file should succeed");
    assert_eq!(saved_before, saved_after);
}

#[test]
fn test_save_settings_preserves_in_memory_folders() {
    let config_dir = tempdir().expect("tempdir creation should succeed");
    let input_dir = tempdir().expect("tempdir creation should succeed");
    let output_dir = tempdir().expect("tempdir creation should succeed");

    let state = AppState::default();
    state.init_settings(config_dir.path().to_path_buf());

    // Record directories
    state
        .settings
        .record_batch_input(input_dir.path().to_path_buf());
    state
        .settings
        .record_batch_output(output_dir.path().to_path_buf());

    // Save new settings without specifying directories
    save_settings_internal(
        Some(Language::En),
        Some(Preset::Binary),
        Preset::Binary.params(),
        &state,
    )
    .expect("save_settings should succeed");

    let loaded = load_settings(config_dir.path());
    assert_eq!(loaded.language, Some(Language::En));
    assert_eq!(loaded.preset, Some(Preset::Binary));
    assert_eq!(loaded.batch_input_dir, Some(input_dir.path().to_path_buf()));
    assert_eq!(
        loaded.batch_output_dir,
        Some(output_dir.path().to_path_buf())
    );
}

#[test]
fn test_get_settings_without_folders_returns_null_batch_dirs() {
    let state = AppState::default();
    let settings = get_settings_internal(&state);

    assert_eq!(settings.language, None);
    assert_eq!(settings.preset, Some(Preset::ColorLogo));
    assert_eq!(settings.params, Preset::ColorLogo.params());
    assert_eq!(settings.batch_input, None);
    assert_eq!(settings.batch_output, None);
}

#[test]
fn test_get_settings_with_active_folders_enumerates_targets_and_returns_labels() {
    let input_dir = tempdir().expect("tempdir creation should succeed");
    let output_dir = tempdir().expect("tempdir creation should succeed");

    // Populate input folder with candidate files and ignored files
    fs::write(input_dir.path().join("logo1.png"), b"").expect("write file");
    fs::write(input_dir.path().join("logo2.jpg"), b"").expect("write file");
    fs::write(input_dir.path().join("readme.txt"), b"").expect("write file");
    fs::write(input_dir.path().join(".hidden.png"), b"").expect("write file");

    let state = AppState::default();
    *state
        .batch
        .input_dir
        .lock()
        .expect("input_dir mutex not poisoned") = Some(input_dir.path().to_path_buf());
    *state
        .batch
        .output_dir
        .lock()
        .expect("output_dir mutex not poisoned") = Some(output_dir.path().to_path_buf());

    let settings = get_settings_internal(&state);

    let batch_input = settings.batch_input.expect("batch_input should be Some");
    assert_eq!(batch_input.targets, vec!["logo1.png", "logo2.jpg"]);
    assert_eq!(batch_input.ignored_count, 2); // readme.txt and .hidden.png
    assert_eq!(
        batch_input.dir_label,
        svg_tracer_lib::batch::extract_dir_label(input_dir.path())
    );

    let batch_output = settings.batch_output.expect("batch_output should be Some");
    assert_eq!(
        batch_output.dir_label,
        svg_tracer_lib::batch::extract_dir_label(output_dir.path())
    );
}

#[test]
fn test_folder_recording_via_pick_batch_input_and_output() {
    let config_dir = tempdir().expect("tempdir creation should succeed");
    let input_dir = tempdir().expect("tempdir creation should succeed");
    let output_dir = tempdir().expect("tempdir creation should succeed");

    fs::write(input_dir.path().join("image.png"), b"").expect("write file");

    let state = AppState::default();
    state.init_settings(config_dir.path().to_path_buf());

    let pick_input = pick_batch_input_internal(input_dir.path().to_path_buf(), &state)
        .expect("pick input must succeed");
    assert_eq!(pick_input.targets, vec!["image.png"]);

    let pick_output = pick_batch_output_internal(output_dir.path().to_path_buf(), &state);
    assert_eq!(
        pick_output.dir_label,
        svg_tracer_lib::batch::extract_dir_label(output_dir.path())
    );

    // Verify settings.json on disk was automatically updated
    let loaded = load_settings(config_dir.path());
    assert_eq!(loaded.batch_input_dir, Some(input_dir.path().to_path_buf()));
    assert_eq!(
        loaded.batch_output_dir,
        Some(output_dir.path().to_path_buf())
    );
}

#[test]
fn test_folder_recording_tolerates_disk_save_failure() {
    let input_dir = tempdir().expect("tempdir creation should succeed");
    let output_dir = tempdir().expect("tempdir creation should succeed");

    let state = AppState::default();
    // Configure invalid non-writable config dir (pointing to an existing regular file as directory)
    let invalid_config_dir = input_dir.path().join("not_a_directory");
    fs::write(&invalid_config_dir, b"dummy").expect("write file");
    *state
        .settings
        .config_dir
        .lock()
        .expect("mutex should not be poisoned") = Some(invalid_config_dir);

    // Folder selection should still succeed despite disk save failure per design §5.6
    let input_res = pick_batch_input_internal(input_dir.path().to_path_buf(), &state);
    assert!(input_res.is_ok());
    assert_eq!(
        *state
            .batch
            .input_dir
            .lock()
            .expect("mutex should not be poisoned"),
        Some(input_dir.path().to_path_buf())
    );

    let output_res = pick_batch_output_internal(output_dir.path().to_path_buf(), &state);
    assert!(!output_res.dir_label.is_empty());
    assert_eq!(
        *state
            .batch
            .output_dir
            .lock()
            .expect("mutex should not be poisoned"),
        Some(output_dir.path().to_path_buf())
    );
}

#[test]
fn test_init_settings_restores_existing_folder_and_discards_missing_folder() {
    let config_dir = tempdir().expect("tempdir creation should succeed");
    let existing_input = tempdir().expect("tempdir creation should succeed");
    let missing_output = PathBuf::from("/nonexistent/output/path/here");

    let initial = SettingsFile {
        schema_version: SCHEMA_VERSION,
        language: Some(Language::Ja),
        preset: Some(Preset::ColorLogo),
        params: Preset::ColorLogo.params(),
        batch_input_dir: Some(existing_input.path().to_path_buf()),
        batch_output_dir: Some(missing_output),
    };
    save_settings_to_dir(config_dir.path(), &initial).expect("save settings should succeed");

    let state = AppState::default();
    state.init_settings(config_dir.path().to_path_buf());

    assert_eq!(
        *state
            .batch
            .input_dir
            .lock()
            .expect("input_dir mutex should not be poisoned"),
        Some(existing_input.path().to_path_buf())
    );
    assert_eq!(
        *state
            .batch
            .output_dir
            .lock()
            .expect("output_dir mutex should not be poisoned"),
        None
    );
}

#[test]
fn test_get_about_returns_version_string() {
    let about = get_about_internal("0.1.0".to_string());
    assert_eq!(about.version, "0.1.0");
}

use std::path::Path;

use svg_tracer_lib::commands::{
    ConvertResult, ImageDroppedPayload, ParamSpec, PickedImage, SaveSvgResult,
};
use svg_tracer_lib::error::{ErrorCode, IpcError};
use ts_rs::{Config, TS};

#[test]
fn export_typescript_bindings() {
    let out_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/ipc/generated");
    std::fs::create_dir_all(&out_dir).expect("Failed to create export directory");
    let cfg = Config::new().with_out_dir(&out_dir);

    ErrorCode::export_all(&cfg).expect("Failed to export ErrorCode");
    IpcError::export_all(&cfg).expect("Failed to export IpcError");
    ParamSpec::export_all(&cfg).expect("Failed to export ParamSpec");
    PickedImage::export_all(&cfg).expect("Failed to export PickedImage");
    ConvertResult::export_all(&cfg).expect("Failed to export ConvertResult");
    SaveSvgResult::export_all(&cfg).expect("Failed to export SaveSvgResult");
    ImageDroppedPayload::export_all(&cfg).expect("Failed to export ImageDroppedPayload");
}

//! Batch conversion execution, state management, and atomic file saving per design §5.2, §5.3, §5.4.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use tracer::{SUPPORTED_EXTENSIONS, TraceParams};
use ts_rs::TS;

use crate::error::{ErrorCode, IpcError};

/// Result returned when an input folder is selected via `pick_batch_input`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PickBatchInputResult {
    /// Display name of the folder (not the absolute filesystem path).
    pub dir_label: String,
    /// List of candidate image filenames directly inside the folder.
    pub targets: Vec<String>,
    /// Number of ignored items (subdirectories, hidden files, symlinks, unsupported formats).
    pub ignored_count: usize,
}

/// Result returned when an output folder is selected via `pick_batch_output`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PickBatchOutputResult {
    /// Display name of the folder (not the absolute filesystem path).
    pub dir_label: String,
}

/// Progress update emitted via `batch-progress` event per design §6.2.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BatchProgressPayload {
    /// Number of completed items so far (success + failure).
    pub done: usize,
    /// Total number of target images.
    pub total: usize,
    /// Name of the file currently being processed, or None.
    pub current: Option<String>,
}

/// Status of an individual item in `batch-item`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum BatchItemStatus {
    Ok,
    Failed,
}

/// Item completion notification emitted via `batch-item` event per design §6.2.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BatchItemPayload {
    /// Input file name.
    pub name: String,
    /// Completion status ("ok" or "failed").
    pub status: BatchItemStatus,
    /// Saved SVG filename if conversion and atomic save succeeded.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_name: Option<String>,
    /// Error information if conversion failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<IpcError>,
}

/// Final summary emitted via `batch-finished` event per design §6.2.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BatchFinishedPayload {
    /// Number of successfully converted and saved images.
    pub succeeded: usize,
    /// Number of files that failed during decode, trace, or save.
    pub failed: usize,
    /// Number of unprocessed items when cancelled.
    pub skipped: usize,
    /// Whether the batch conversion was cancelled.
    pub cancelled: bool,
}

/// Thread-safe state for managing batch conversion directories and execution flags.
#[derive(Debug, Default)]
pub struct BatchState {
    /// Absolute path of selected input directory, kept strictly on the Rust side.
    pub input_dir: Mutex<Option<PathBuf>>,
    /// Absolute path of selected output directory, kept strictly on the Rust side.
    pub output_dir: Mutex<Option<PathBuf>>,
    /// Flag indicating whether batch conversion is currently executing.
    pub is_running: Arc<AtomicBool>,
    /// Shared cancellation flag checked before starting each item.
    pub cancel_flag: Arc<AtomicBool>,
}

impl BatchState {
    /// Creates an empty batch state.
    pub fn new() -> Self {
        Self::default()
    }
}

/// Enumerates conversion target files directly under `dir` per design §5.2.
///
/// Returns a sorted list of candidate file names and the count of ignored items.
/// An item is ignored if it is:
/// - A hidden file (name starts with `.`)
/// - A directory / subdirectory
/// - A symlink (evaluated via `symlink_metadata` to avoid resolving targets)
/// - A file with an unsupported extension (case-insensitive check against [`SUPPORTED_EXTENSIONS`])
pub fn enumerate_targets(dir: &Path) -> Result<(Vec<String>, usize), std::io::Error> {
    let mut targets = Vec::new();
    let mut ignored_count = 0usize;

    let entries = std::fs::read_dir(dir)?;
    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => {
                ignored_count += 1;
                continue;
            }
        };

        let file_name = entry.file_name();
        let name_str = file_name.to_string_lossy();

        // 1. Hidden file (name starts with '.')
        if name_str.starts_with('.') {
            ignored_count += 1;
            continue;
        }

        // 2. Symlink or directory or non-regular file
        let meta = match entry.path().symlink_metadata() {
            Ok(m) => m,
            Err(_) => {
                ignored_count += 1;
                continue;
            }
        };

        if meta.file_type().is_symlink() || meta.file_type().is_dir() {
            ignored_count += 1;
            continue;
        }

        // 3. Regular file: check extension
        let path = entry.path();
        let is_supported = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| {
                let lower = ext.to_lowercase();
                SUPPORTED_EXTENSIONS.iter().any(|&s| s == lower)
            })
            .unwrap_or(false);

        if is_supported {
            targets.push(name_str.to_string());
        } else {
            ignored_count += 1;
        }
    }

    // Sort targets by Unicode code point order for deterministic processing.
    targets.sort();

    Ok((targets, ignored_count))
}

/// Lists existing file and directory names directly under `dir` per design §5.2.
pub fn list_existing_files(dir: &Path) -> Result<HashSet<String>, std::io::Error> {
    let mut set = HashSet::new();
    if !dir.exists() {
        return Ok(set);
    }
    for entry in std::fs::read_dir(dir)?.flatten() {
        set.insert(entry.file_name().to_string_lossy().to_string());
    }
    Ok(set)
}

/// Callbacks for receiving batch conversion progress, item results, and completion events.
pub struct BatchCallbacks<FProg, FItem, FFin> {
    pub on_progress: FProg,
    pub on_item: FItem,
    pub on_finished: FFin,
}

/// Saves SVG content atomically into `output_dir` using a temporary file and `persist_noclobber`.
///
/// If a collision occurs (`AlreadyExists`), increments the candidate index until an unoccupied name
/// is found that neither exists on disk nor collides with any name in `used_names_lower`.
/// When saving succeeds, the chosen name (in lowercase) is inserted into `used_names_lower`.
pub fn save_svg_atomic(
    output_dir: &Path,
    stem: &str,
    initial_output_name: &str,
    svg_content: &str,
    used_names_lower: &Mutex<HashSet<String>>,
) -> Result<String, IpcError> {
    use std::io::Write;

    let mut temp = tempfile::NamedTempFile::new_in(output_dir)
        .map_err(|e| IpcError::new(ErrorCode::WriteFailed, e.to_string()))?;

    temp.write_all(svg_content.as_bytes())
        .map_err(|e| IpcError::new(ErrorCode::WriteFailed, e.to_string()))?;
    temp.flush()
        .map_err(|e| IpcError::new(ErrorCode::WriteFailed, e.to_string()))?;

    let mut candidate = initial_output_name.to_string();
    let mut suffix_num = 0usize;

    loop {
        let dest_path = output_dir.join(&candidate);
        match temp.persist_noclobber(&dest_path) {
            Ok(_) => {
                let mut used = used_names_lower
                    .lock()
                    .expect("used_names_lower mutex should not be poisoned");
                used.insert(candidate.to_lowercase());
                return Ok(candidate);
            }
            Err(persist_err) => {
                if persist_err.error.kind() == std::io::ErrorKind::AlreadyExists {
                    temp = persist_err.file;
                    let mut used = used_names_lower
                        .lock()
                        .expect("used_names_lower mutex should not be poisoned");
                    loop {
                        suffix_num += 1;
                        let next_candidate = format!("{stem} ({suffix_num}).svg");
                        let next_lower = next_candidate.to_lowercase();
                        if !used.contains(&next_lower) && !output_dir.join(&next_candidate).exists()
                        {
                            used.insert(next_lower);
                            candidate = next_candidate;
                            break;
                        }
                    }
                } else {
                    return Err(IpcError::new(
                        ErrorCode::WriteFailed,
                        persist_err.error.to_string(),
                    ));
                }
            }
        }
    }
}

/// Prepared batch configuration ready for execution on a background worker thread.
pub struct PreparedBatch {
    pub output_dir: PathBuf,
    pub params: TraceParams,
    pub tasks: Vec<(String, String, PathBuf)>,
    pub used_names_lower: Arc<Mutex<HashSet<String>>>,
    pub pool: rayon::ThreadPool,
}

impl PreparedBatch {
    /// Prepares batch conversion before spawning a background thread.
    ///
    /// Enumerates target files, inspects the output directory, resolves output names,
    /// and initializes the thread pool synchronously so that directory traversal and setup
    /// failures are returned directly from `start_batch` per design §5.2.
    pub fn prepare(
        input_dir: &Path,
        output_dir: &Path,
        params: TraceParams,
    ) -> Result<Self, IpcError> {
        let (targets, _ignored) = enumerate_targets(input_dir)
            .map_err(|e| IpcError::new(ErrorCode::ReadFailed, e.to_string()))?;

        let existing = list_existing_files(output_dir)
            .map_err(|e| IpcError::new(ErrorCode::WriteFailed, e.to_string()))?;

        let output_names = tracer::resolve_output_names(&targets, &existing);

        let mut initial_used: HashSet<String> = existing.iter().map(|s| s.to_lowercase()).collect();
        for name in &output_names {
            initial_used.insert(name.to_lowercase());
        }
        let used_names_lower = Arc::new(Mutex::new(initial_used));

        let tasks: Vec<(String, String, PathBuf)> = targets
            .into_iter()
            .zip(output_names)
            .map(|(target, out_name)| {
                let path = input_dir.join(&target);
                (target, out_name, path)
            })
            .collect();

        let num_cpus = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1);
        let num_threads = num_cpus.saturating_sub(1).max(1);

        let pool = rayon::ThreadPoolBuilder::new()
            .num_threads(num_threads)
            .build()
            .map_err(|e| IpcError::new(ErrorCode::TraceFailed, e.to_string()))?;

        Ok(Self {
            output_dir: output_dir.to_path_buf(),
            params,
            tasks,
            used_names_lower,
            pool,
        })
    }

    /// Executes the prepared batch conversion.
    ///
    /// Runs on a dedicated thread and reports item results and completion via callbacks.
    /// Does not return `Result` because all pre-flight errors are caught during `prepare`.
    pub fn run<FProg, FItem, FFin>(
        self,
        cancel_flag: Arc<AtomicBool>,
        is_running: Arc<AtomicBool>,
        callbacks: BatchCallbacks<FProg, FItem, FFin>,
    ) where
        FProg: Fn(BatchProgressPayload) + Send + Sync + 'static,
        FItem: Fn(BatchItemPayload) + Send + Sync + 'static,
        FFin: FnOnce(BatchFinishedPayload) + Send + Sync + 'static,
    {
        let on_progress = callbacks.on_progress;
        let on_item = callbacks.on_item;
        let on_finished = callbacks.on_finished;

        let total = self.tasks.len();
        let done = Arc::new(AtomicUsize::new(0));
        let succeeded = Arc::new(AtomicUsize::new(0));
        let failed = Arc::new(AtomicUsize::new(0));
        let skipped = Arc::new(AtomicUsize::new(0));

        on_progress(BatchProgressPayload {
            done: 0,
            total,
            current: None,
        });

        if total == 0 {
            is_running.store(false, Ordering::SeqCst);
            on_finished(BatchFinishedPayload {
                succeeded: 0,
                failed: 0,
                skipped: 0,
                cancelled: cancel_flag.load(Ordering::SeqCst),
            });
            return;
        }

        let output_dir = self.output_dir;
        let params = self.params;
        let used_names_lower = self.used_names_lower;

        self.pool.install(|| {
            self.tasks
                .into_par_iter()
                .for_each(|(name, planned_output_name, input_path)| {
                    if cancel_flag.load(Ordering::SeqCst) {
                        skipped.fetch_add(1, Ordering::SeqCst);
                        return;
                    }

                    on_progress(BatchProgressPayload {
                        done: done.load(Ordering::SeqCst),
                        total,
                        current: Some(name.clone()),
                    });

                    let stem = match name.rfind('.') {
                        Some(idx) => &name[..idx],
                        None => &name,
                    };

                    let result = (|| -> Result<String, IpcError> {
                        let image = tracer::load_image(&input_path)?;
                        let trace_out = tracer::trace(&image, &params)?;
                        save_svg_atomic(
                            &output_dir,
                            stem,
                            &planned_output_name,
                            &trace_out.svg,
                            &used_names_lower,
                        )
                    })();

                    match result {
                        Ok(saved_name) => {
                            succeeded.fetch_add(1, Ordering::SeqCst);
                            let current_done = done.fetch_add(1, Ordering::SeqCst) + 1;
                            on_item(BatchItemPayload {
                                name,
                                status: BatchItemStatus::Ok,
                                output_name: Some(saved_name),
                                error: None,
                            });
                            on_progress(BatchProgressPayload {
                                done: current_done,
                                total,
                                current: None,
                            });
                        }
                        Err(err) => {
                            failed.fetch_add(1, Ordering::SeqCst);
                            let current_done = done.fetch_add(1, Ordering::SeqCst) + 1;
                            on_item(BatchItemPayload {
                                name,
                                status: BatchItemStatus::Failed,
                                output_name: None,
                                error: Some(err),
                            });
                            on_progress(BatchProgressPayload {
                                done: current_done,
                                total,
                                current: None,
                            });
                        }
                    }
                });
        });

        let cancelled = cancel_flag.load(Ordering::SeqCst);
        let final_succeeded = succeeded.load(Ordering::SeqCst);
        let final_failed = failed.load(Ordering::SeqCst);
        let final_skipped = skipped.load(Ordering::SeqCst);

        is_running.store(false, Ordering::SeqCst);

        on_finished(BatchFinishedPayload {
            succeeded: final_succeeded,
            failed: final_failed,
            skipped: final_skipped,
            cancelled,
        });
    }
}

/// Convenience function to prepare and execute batch conversion synchronously on the current thread,
/// or used for decoupled unit testing.
pub fn run_batch<FProg, FItem, FFin>(
    input_dir: PathBuf,
    output_dir: PathBuf,
    params: TraceParams,
    cancel_flag: Arc<AtomicBool>,
    is_running: Arc<AtomicBool>,
    callbacks: BatchCallbacks<FProg, FItem, FFin>,
) -> Result<(), IpcError>
where
    FProg: Fn(BatchProgressPayload) + Send + Sync + 'static,
    FItem: Fn(BatchItemPayload) + Send + Sync + 'static,
    FFin: FnOnce(BatchFinishedPayload) + Send + Sync + 'static,
{
    let prepared = match PreparedBatch::prepare(&input_dir, &output_dir, params) {
        Ok(p) => p,
        Err(err) => {
            is_running.store(false, Ordering::SeqCst);
            return Err(err);
        }
    };

    prepared.run(cancel_flag, is_running, callbacks);
    Ok(())
}

/// Helper to handle selection of input directory in tests or IPC.
pub fn select_batch_input_internal(
    path: PathBuf,
    batch_state: &BatchState,
) -> Result<PickBatchInputResult, IpcError> {
    let (targets, ignored_count) = enumerate_targets(&path)
        .map_err(|e| IpcError::new(ErrorCode::ReadFailed, e.to_string()))?;

    let dir_label = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string());

    *batch_state
        .input_dir
        .lock()
        .expect("input_dir mutex should not be poisoned") = Some(path);

    Ok(PickBatchInputResult {
        dir_label,
        targets,
        ignored_count,
    })
}

/// Helper to handle selection of output directory in tests or IPC.
pub fn select_batch_output_internal(
    path: PathBuf,
    batch_state: &BatchState,
) -> PickBatchOutputResult {
    let dir_label = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string());

    *batch_state
        .output_dir
        .lock()
        .expect("output_dir mutex should not be poisoned") = Some(path);

    PickBatchOutputResult { dir_label }
}

/// Starts batch execution given parameters and state, validating inputs and rejecting if already running.
///
/// Prepares target enumeration, directory checks, and thread pool synchronously before spawning
/// a background worker thread. If any setup fails, `is_running` is reset to false and the error
/// is returned directly to the caller per review requirements.
pub fn start_batch_internal<FProg, FItem, FFin>(
    params: TraceParams,
    batch_state: &BatchState,
    callbacks: BatchCallbacks<FProg, FItem, FFin>,
) -> Result<(), IpcError>
where
    FProg: Fn(BatchProgressPayload) + Send + Sync + 'static,
    FItem: Fn(BatchItemPayload) + Send + Sync + 'static,
    FFin: FnOnce(BatchFinishedPayload) + Send + Sync + 'static,
{
    params.validate()?;

    let (input_dir, output_dir) = {
        let in_dir = batch_state
            .input_dir
            .lock()
            .expect("input_dir mutex should not be poisoned")
            .clone();
        let out_dir = batch_state
            .output_dir
            .lock()
            .expect("output_dir mutex should not be poisoned")
            .clone();
        match (in_dir, out_dir) {
            (Some(i), Some(o)) => (i, o),
            _ => return Err(IpcError::from_code(ErrorCode::UnknownHandle)),
        }
    };

    if batch_state
        .is_running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err(IpcError::from_code(ErrorCode::BatchRunning));
    }

    batch_state.cancel_flag.store(false, Ordering::SeqCst);

    let prepared = match PreparedBatch::prepare(&input_dir, &output_dir, params) {
        Ok(prepared) => prepared,
        Err(err) => {
            batch_state.is_running.store(false, Ordering::SeqCst);
            return Err(err);
        }
    };

    let cancel_flag = Arc::clone(&batch_state.cancel_flag);
    let is_running = Arc::clone(&batch_state.is_running);

    std::thread::spawn(move || {
        prepared.run(cancel_flag, is_running, callbacks);
    });

    Ok(())
}

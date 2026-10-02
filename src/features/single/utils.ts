import { BYTES_PER_KB, BYTES_PER_MB, MS_PER_SECOND } from "./constants";

/**
 * Formats a file size into human-readable string (e.g. 12.4 KB).
 */
export function formatFileSize(bytes: number): string {
  if (bytes < BYTES_PER_KB) {
    return `${bytes} B`;
  }
  if (bytes < BYTES_PER_MB) {
    return `${(bytes / BYTES_PER_KB).toFixed(1)} KB`;
  }
  return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
}

/**
 * Formats duration in milliseconds to seconds (e.g. "0.42 秒" or "0.42 s").
 */
export function formatDuration(elapsedMs: number, unitLabel: string): string {
  const seconds = (elapsedMs / MS_PER_SECOND).toFixed(2);
  return `${seconds} ${unitLabel}`;
}

/**
 * Extracts uppercase image format from the file extension (e.g. "PNG").
 */
export function getImageFormatLabel(fileName: string): string {
  const lastDotIndex = fileName.lastIndexOf(".");
  if (lastDotIndex !== -1 && lastDotIndex < fileName.length - 1) {
    const ext = fileName.slice(lastDotIndex + 1);
    return ext.toUpperCase();
  }
  return "PNG";
}

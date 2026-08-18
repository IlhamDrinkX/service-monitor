/**
 * Pure helpers for lab-logger ring download progress labels (UI).
 */

export type LabLoggerDownloadProgressPayload = {
  bytesReceived: number;
  bytesTotal: number;
  percent: number;
  chunkIndex?: number;
  chunkCount?: number;
};

/** Whole mebibytes for progress text (matches «12 / 65 МБ»). */
export function bytesToMebibytesRounded(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return Math.round(bytes / (1024 * 1024));
}

export function labLoggerDownloadPercent(
  bytesReceived: number,
  bytesTotal: number
): number {
  if (
    !Number.isFinite(bytesReceived) ||
    !Number.isFinite(bytesTotal) ||
    bytesTotal <= 0
  ) {
    return 0;
  }
  return Math.min(
    100,
    Math.max(0, Math.round((100 * bytesReceived) / bytesTotal))
  );
}

/** Example: `12 / 65 МБ (18%)`. */
export function formatLabLoggerDownloadProgressLabel(
  bytesReceived: number,
  bytesTotal: number
): string {
  const recvMb = bytesToMebibytesRounded(bytesReceived);
  const totalMb = Math.max(recvMb, bytesToMebibytesRounded(bytesTotal));
  const pct = labLoggerDownloadPercent(bytesReceived, bytesTotal);
  return `${recvMb} / ${totalMb} МБ (${pct}%)`;
}

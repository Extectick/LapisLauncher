export const UPDATE_DISK_RESERVE_BYTES = 512 * 1024 * 1024;
export const UPDATE_DOWNLOAD_MAX_ATTEMPTS = 3;
export const UPDATE_DOWNLOAD_RETRY_BASE_MS = 1_500;
export const UPDATE_DOWNLOAD_RETRY_MAX_MS = 10_000;

export function requiredUpdateDiskBytes(fullPackageBytes: number): bigint {
  const packageSize = BigInt(Math.max(0, Math.ceil(fullPackageBytes)));
  return packageSize * 2n + BigInt(UPDATE_DISK_RESERVE_BYTES);
}

export function updateRetryDelayMs(
  completedAttempts: number,
  jitter = Math.random(),
): number {
  const exponential = Math.min(
    UPDATE_DOWNLOAD_RETRY_BASE_MS *
      2 ** Math.max(0, Math.floor(completedAttempts) - 1),
    UPDATE_DOWNLOAD_RETRY_MAX_MS,
  );
  const normalizedJitter = Math.max(0, Math.min(1, jitter));
  return Math.round(exponential * (0.85 + normalizedJitter * 0.3));
}

export function formatUpdateBytes(bytes: bigint): string {
  const gibibytes = Number(bytes) / 1024 ** 3;
  return `${gibibytes.toFixed(gibibytes >= 10 ? 0 : 1)} ГБ`;
}

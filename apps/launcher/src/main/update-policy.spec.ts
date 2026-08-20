import { describe, expect, it } from "vitest";
import {
  UPDATE_DISK_RESERVE_BYTES,
  UPDATE_DOWNLOAD_RETRY_BASE_MS,
  UPDATE_DOWNLOAD_RETRY_MAX_MS,
  formatUpdateBytes,
  requiredUpdateDiskBytes,
  updateRetryDelayMs,
} from "./update-policy";

describe("update policy", () => {
  it("reserves room for package reconstruction and a safe apply", () => {
    const fullPackage = 150 * 1024 * 1024;
    expect(requiredUpdateDiskBytes(fullPackage)).toBe(
      BigInt(fullPackage * 2 + UPDATE_DISK_RESERVE_BYTES),
    );
  });

  it("uses bounded exponential retry with controlled jitter", () => {
    expect(updateRetryDelayMs(1, 0.5)).toBe(UPDATE_DOWNLOAD_RETRY_BASE_MS);
    expect(updateRetryDelayMs(2, 0.5)).toBe(UPDATE_DOWNLOAD_RETRY_BASE_MS * 2);
    expect(updateRetryDelayMs(99, 0.5)).toBe(UPDATE_DOWNLOAD_RETRY_MAX_MS);
    expect(updateRetryDelayMs(1, -1)).toBeGreaterThan(0);
    expect(updateRetryDelayMs(1, 2)).toBeGreaterThan(
      UPDATE_DOWNLOAD_RETRY_BASE_MS,
    );
  });

  it("formats disk requirements for the user", () => {
    expect(formatUpdateBytes(2n * 1024n ** 3n)).toBe("2.0 ГБ");
    expect(formatUpdateBytes(16n * 1024n ** 3n)).toBe("16 ГБ");
  });
});

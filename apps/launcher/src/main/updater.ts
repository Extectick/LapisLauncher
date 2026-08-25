import { app, BrowserWindow } from "electron";
import log from "electron-log/main";
import { readFile, statfs } from "node:fs/promises";
import { join } from "node:path";
import { UpdateManager, type UpdateInfo, type VelopackAsset } from "velopack";
import { z } from "zod";
import type { AppUpdateStatus, UpdateTrigger } from "../shared/update-types";
import {
  UPDATE_DOWNLOAD_MAX_ATTEMPTS,
  formatUpdateBytes,
  requiredUpdateDiskBytes,
  updateRetryDelayMs,
} from "./update-policy";
import { initializeLauncherLogging } from "./logging";

const DEFAULT_CHECK_INTERVAL_MINUTES = 30;
const MIN_CHECK_INTERVAL_MINUTES = 10;
const MAX_CHECK_INTERVAL_MINUTES = 24 * 60;
const FOCUS_CHECK_MAX_AGE_MS = 10 * 60_000;
const ERROR_RETRY_BASE_MS = 5 * 60_000;

type UpdateInstallGuard = () => Promise<string | null>;
type InitializeUpdaterOptions = { installGuard?: UpdateInstallGuard };
export type UpdateInstallResult = { ok: true } | { ok: false; message: string };

class UpdateDiskSpaceError extends Error {
  constructor(
    readonly available: bigint,
    readonly required: bigint,
  ) {
    super(
      `Insufficient update disk space: ${available.toString()} of ${required.toString()} bytes available`,
    );
  }
}

const updateConfigSchema = z.object({
  url: z
    .string()
    .url()
    .refine((value) => new URL(value).protocol === "https:", {
      message: "Update URL must use HTTPS.",
    }),
  channel: z
    .string()
    .regex(/^[a-z0-9][a-z0-9._-]{0,31}$/i)
    .default("stable"),
  checkIntervalMinutes: z
    .number()
    .int()
    .min(MIN_CHECK_INTERVAL_MINUTES)
    .max(MAX_CHECK_INTERVAL_MINUTES)
    .default(DEFAULT_CHECK_INTERVAL_MINUTES),
});

type UpdateConfig = z.infer<typeof updateConfigSchema>;

let targetWindow: BrowserWindow | null = null;
let manager: UpdateManager | null = null;
let pendingUpdate: UpdateInfo | null = null;
let pendingAsset: VelopackAsset | null = null;
let checkInFlight: Promise<AppUpdateStatus> | null = null;
let downloadInFlight: Promise<AppUpdateStatus> | null = null;
let scheduledCheck: NodeJS.Timeout | null = null;
let scheduledDownloadRetry: NodeJS.Timeout | null = null;
let checkIntervalMs = DEFAULT_CHECK_INTERVAL_MINUTES * 60_000;
let lastCheckedAt = 0;
let consecutiveFailures = 0;
let consecutiveDownloadFailures = 0;
let shuttingDown = false;
let installGuard: UpdateInstallGuard = async () => null;

let status: AppUpdateStatus = {
  currentVersion: app.getVersion(),
  phase: "checking",
  startup: true,
};

const updaterLog = log.scope("updater");

function publishStatus(next: AppUpdateStatus): AppUpdateStatus {
  status = next;
  updaterLog.info(
    `state=${next.phase} trigger=${next.trigger ?? "none"} version=${next.version ?? "none"} progress=${next.progress ?? "none"}`,
  );
  if (targetWindow && !targetWindow.isDestroyed())
    targetWindow.webContents.send("updates:status", status);
  return status;
}

function currentStatus(
  phase: AppUpdateStatus["phase"],
  values: Partial<Omit<AppUpdateStatus, "currentVersion" | "phase">> = {},
): AppUpdateStatus {
  return {
    currentVersion: status.currentVersion,
    phase,
    startup: false,
    ...values,
  };
}

async function readUpdateConfig(): Promise<UpdateConfig | null> {
  const runtimeUrl = process.env.LAPIS_UPDATE_URL;
  const runtimeChannel = process.env.LAPIS_UPDATE_CHANNEL;
  const runtimeInterval = Number(process.env.LAPIS_UPDATE_INTERVAL_MINUTES);
  if (runtimeUrl) {
    const parsed = updateConfigSchema.safeParse({
      url: runtimeUrl,
      channel: runtimeChannel || undefined,
      checkIntervalMinutes: Number.isFinite(runtimeInterval)
        ? runtimeInterval
        : undefined,
    });
    return parsed.success ? parsed.data : null;
  }

  const configPath = join(process.resourcesPath, "update-config.json");
  try {
    return updateConfigSchema.parse(
      JSON.parse(await readFile(configPath, "utf8")),
    );
  } catch (error) {
    updaterLog.error("Invalid update configuration", error);
    return null;
  }
}

function updateMetadata(
  update: UpdateInfo,
): Pick<
  AppUpdateStatus,
  "version" | "downloadSize" | "differential" | "releaseNotes"
> {
  const deltas = update.DeltasToTarget ?? [];
  const differential = deltas.length > 0 && !update.IsDowngrade;
  return {
    version: update.TargetFullRelease.Version,
    downloadSize: differential
      ? deltas.reduce((total, delta) => total + delta.Size, 0)
      : update.TargetFullRelease.Size,
    differential,
    releaseNotes: update.TargetFullRelease.NotesMarkdown?.trim().slice(
      0,
      20_000,
    ),
  };
}

function classifyError(error: unknown): NonNullable<AppUpdateStatus["error"]> {
  if (error instanceof UpdateDiskSpaceError)
    return {
      code: "disk-space",
      message: `Недостаточно места: для обновления требуется ${formatUpdateBytes(error.required)} свободного пространства.`,
      retryable: false,
    };
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (normalized.includes("not installed"))
    return {
      code: "not-installed",
      message:
        "Проверка обновлений доступна только в установленной версии лаунчера.",
      retryable: false,
    };
  if (normalized.includes("checksum") || normalized.includes("hash"))
    return {
      code: "checksum",
      message: "Обновление повреждено и не будет установлено.",
      retryable: true,
    };
  if (normalized.includes("lock") || normalized.includes("another update"))
    return {
      code: "locked",
      message: "Другая операция обновления уже выполняется.",
      retryable: true,
    };
  if (
    normalized.includes("http") ||
    normalized.includes("network") ||
    normalized.includes("connect") ||
    normalized.includes("certificate") ||
    normalized.includes("dns") ||
    normalized.includes("timeout")
  )
    return {
      code: "network",
      message: "Сервер обновлений временно недоступен.",
      retryable: true,
    };
  return {
    code: "unknown",
    message: "Не удалось выполнить обновление лаунчера.",
    retryable: true,
  };
}

function clearSchedule(): void {
  if (scheduledCheck) clearTimeout(scheduledCheck);
  scheduledCheck = null;
}

function clearDownloadRetry(): void {
  if (scheduledDownloadRetry) clearTimeout(scheduledDownloadRetry);
  scheduledDownloadRetry = null;
}

function scheduleDownloadRetry(): void {
  clearDownloadRetry();
  if (!manager || shuttingDown || !pendingUpdate || pendingAsset) return;
  const baseDelay = Math.min(
    ERROR_RETRY_BASE_MS * 2 ** Math.max(consecutiveDownloadFailures - 1, 0),
    checkIntervalMs,
  );
  const jitter = Math.round(baseDelay * (Math.random() * 0.16 - 0.08));
  scheduledDownloadRetry = setTimeout(
    () => {
      scheduledDownloadRetry = null;
      void downloadUpdate();
    },
    Math.max(60_000, baseDelay + jitter),
  );
  scheduledDownloadRetry.unref();
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function ensureUpdateDiskSpace(update: UpdateInfo): Promise<void> {
  const required = requiredUpdateDiskBytes(update.TargetFullRelease.Size);
  try {
    const disk = await statfs(process.execPath, { bigint: true });
    const available = disk.bavail * disk.bsize;
    if (available < required)
      throw new UpdateDiskSpaceError(available, required);
  } catch (error) {
    if (error instanceof UpdateDiskSpaceError) throw error;
    updaterLog.warn("Unable to determine free update disk space", error);
  }
}

function scheduleNextCheck(afterError = false): void {
  clearSchedule();
  if (!manager || shuttingDown || pendingUpdate || pendingAsset) return;
  const baseDelay = afterError
    ? Math.min(
        ERROR_RETRY_BASE_MS * 2 ** Math.max(consecutiveFailures - 1, 0),
        checkIntervalMs,
      )
    : checkIntervalMs;
  const jitter = Math.round(baseDelay * (Math.random() * 0.16 - 0.08));
  scheduledCheck = setTimeout(
    () => {
      scheduledCheck = null;
      void checkForUpdates("scheduled");
    },
    Math.max(60_000, baseDelay + jitter),
  );
  scheduledCheck.unref();
}

export async function initializeUpdater(
  window: BrowserWindow,
  options: InitializeUpdaterOptions = {},
): Promise<void> {
  targetWindow = window;
  installGuard = options.installGuard ?? (async () => null);
  initializeLauncherLogging();

  if (!app.isPackaged) {
    publishStatus(currentStatus("disabled"));
    return;
  }

  const config = await readUpdateConfig();
  if (!config) {
    publishStatus(
      currentStatus("disabled", {
        error: {
          code: "unknown",
          message: "Канал обновлений не настроен.",
          retryable: false,
        },
      }),
    );
    return;
  }

  checkIntervalMs = config.checkIntervalMinutes * 60_000;
  try {
    manager = new UpdateManager(config.url.replace(/\/$/, ""), {
      AllowVersionDowngrade: false,
      ExplicitChannel: config.channel,
      MaximumDeltasBeforeFallback: 10,
    });
    status = {
      currentVersion: manager.getCurrentVersion(),
      phase: "idle",
      startup: true,
    };
    pendingAsset = manager.getUpdatePendingRestart();
    if (pendingAsset) {
      publishStatus(
        currentStatus("downloaded", {
          startup: true,
          version: pendingAsset.Version,
          progress: 100,
          downloadSize: pendingAsset.Size,
        }),
      );
      await installDownloadedUpdate();
      return;
    }
  } catch (error) {
    updaterLog.warn("Velopack is not available for this installation", error);
    publishStatus(
      currentStatus("disabled", {
        error: classifyError(error),
      }),
    );
    return;
  }

  const startupResult = await checkForUpdates("startup");
  if (startupResult.phase !== "available") return;
  const downloaded = await downloadUpdate();
  if (downloaded.phase === "downloaded") await installDownloadedUpdate();
}

export function getUpdateStatus(): AppUpdateStatus {
  return status;
}

export function checkForUpdates(
  trigger: UpdateTrigger = "manual",
): Promise<AppUpdateStatus> {
  if (!manager || shuttingDown) return Promise.resolve(status);
  if (checkInFlight) return checkInFlight;
  if (
    status.phase === "downloading" ||
    status.phase === "downloaded" ||
    status.phase === "installing"
  )
    return Promise.resolve(status);

  const startup = trigger === "startup";
  checkInFlight = (async () => {
    publishStatus(currentStatus("checking", { trigger, startup }));
    try {
      const update = await manager!.checkForUpdatesAsync();
      lastCheckedAt = Date.now();
      consecutiveFailures = 0;
      if (!update) {
        pendingUpdate = null;
        const next = publishStatus(
          currentStatus("not-available", {
            trigger,
            startup: false,
            checkedAt: lastCheckedAt,
          }),
        );
        scheduleNextCheck();
        return next;
      }
      pendingUpdate = update;
      clearSchedule();
      return publishStatus(
        currentStatus("available", {
          trigger,
          startup,
          checkedAt: lastCheckedAt,
          ...updateMetadata(update),
        }),
      );
    } catch (error) {
      lastCheckedAt = Date.now();
      consecutiveFailures += 1;
      updaterLog.error("Update check failed", error);
      const next = publishStatus(
        currentStatus("error", {
          trigger,
          startup: false,
          checkedAt: lastCheckedAt,
          error: classifyError(error),
        }),
      );
      scheduleNextCheck(true);
      return next;
    } finally {
      checkInFlight = null;
    }
  })();
  return checkInFlight;
}

export function checkForUpdatesIfStale(): void {
  if (
    manager &&
    !pendingUpdate &&
    !pendingAsset &&
    Date.now() - lastCheckedAt >= FOCUS_CHECK_MAX_AGE_MS
  )
    void checkForUpdates("scheduled");
}

export function downloadUpdate(): Promise<AppUpdateStatus> {
  if (!manager || !pendingUpdate || shuttingDown)
    return Promise.resolve(status);
  if (downloadInFlight) return downloadInFlight;
  if (status.phase === "downloaded" || status.phase === "installing")
    return Promise.resolve(status);

  const update = pendingUpdate;
  const metadata = updateMetadata(update);
  const startup = status.startup;
  clearDownloadRetry();
  downloadInFlight = (async () => {
    publishStatus(
      currentStatus("downloading", {
        trigger: status.trigger,
        startup,
        progress: 0,
        ...metadata,
      }),
    );
    try {
      await ensureUpdateDiskSpace(update);
      let lastError: unknown;
      for (
        let attempt = 1;
        attempt <= UPDATE_DOWNLOAD_MAX_ATTEMPTS;
        attempt++
      ) {
        try {
          await manager!.downloadUpdateAsync(update, (progress) => {
            publishStatus(
              currentStatus("downloading", {
                trigger: status.trigger,
                startup,
                progress: Math.max(0, Math.min(100, Math.round(progress))),
                ...metadata,
              }),
            );
          });
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
          if (shuttingDown || attempt >= UPDATE_DOWNLOAD_MAX_ATTEMPTS) break;
          const delay = updateRetryDelayMs(attempt);
          updaterLog.warn(
            `Update download attempt ${attempt} failed; retrying in ${delay}ms`,
            error,
          );
          await wait(delay);
        }
      }
      if (lastError) throw lastError;
      pendingAsset = manager!.getUpdatePendingRestart();
      if (!pendingAsset)
        throw new Error("Velopack did not stage the downloaded update.");
      consecutiveDownloadFailures = 0;
      clearDownloadRetry();
      return publishStatus(
        currentStatus("downloaded", {
          trigger: status.trigger,
          startup,
          progress: 100,
          ...metadata,
        }),
      );
    } catch (error) {
      updaterLog.error("Update download failed", error);
      consecutiveDownloadFailures += 1;
      const classified = classifyError(error);
      const next = publishStatus(
        currentStatus("error", {
          trigger: status.trigger,
          startup: false,
          version: metadata.version,
          downloadSize: metadata.downloadSize,
          differential: metadata.differential,
          releaseNotes: metadata.releaseNotes,
          error: classified,
        }),
      );
      if (classified.retryable) scheduleDownloadRetry();
      return next;
    } finally {
      downloadInFlight = null;
    }
  })();
  return downloadInFlight;
}

export async function installDownloadedUpdate(): Promise<UpdateInstallResult> {
  if (!manager || shuttingDown)
    return { ok: false, message: "Обновление ещё не готово к установке." };
  const target = pendingUpdate ?? pendingAsset;
  if (!target)
    return { ok: false, message: "Обновление ещё не готово к установке." };
  try {
    const blockedMessage = await installGuard();
    if (blockedMessage) {
      publishStatus({
        ...status,
        phase: "downloaded",
        startup: false,
        error: {
          code: "locked",
          message: blockedMessage,
          retryable: true,
        },
      });
      return { ok: false, message: blockedMessage };
    }
  } catch (error) {
    updaterLog.error("Update install guard failed", error);
    return {
      ok: false,
      message: "Не удалось безопасно подготовить установку обновления.",
    };
  }
  clearSchedule();
  clearDownloadRetry();
  publishStatus(
    currentStatus("installing", {
      trigger: status.trigger,
      startup: status.startup,
      version:
        "TargetFullRelease" in target
          ? target.TargetFullRelease.Version
          : target.Version,
      progress: 100,
    }),
  );
  try {
    manager.waitExitThenApplyUpdate(target, true, true);
    setTimeout(() => app.quit(), 80).unref();
    return { ok: true };
  } catch (error) {
    updaterLog.error("Failed to start the Velopack apply process", error);
    publishStatus(
      currentStatus("error", {
        startup: false,
        version: status.version,
        error: classifyError(error),
      }),
    );
    return {
      ok: false,
      message: "Не удалось запустить установку обновления.",
    };
  }
}

export function shutdownUpdater(): void {
  shuttingDown = true;
  clearSchedule();
  clearDownloadRetry();
  targetWindow = null;
}

import { app, BrowserWindow } from "electron";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { autoUpdater, type ProgressInfo, type UpdateInfo } from "electron-updater";

export type UpdatePhase =
  | "disabled"
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "not-available"
  | "error";

export type AppUpdateStatus = {
  currentVersion: string;
  phase: UpdatePhase;
  version?: string;
  progress?: number;
};

type UpdateConfig = { url?: unknown };

let targetWindow: BrowserWindow | null = null;
let configured = false;
let checkStarted = false;
let status: AppUpdateStatus = {
  currentVersion: app.getVersion(),
  phase: "disabled",
};

function publishStatus(next: Partial<AppUpdateStatus>): void {
  status = { ...status, ...next };
  if (targetWindow && !targetWindow.isDestroyed())
    targetWindow.webContents.send("updates:status", status);
}

async function updateUrl(): Promise<string | null> {
  const configuredUrl = process.env.LAPIS_UPDATE_URL;
  const source =
    configuredUrl ??
    (await readFile(join(process.resourcesPath, "update-config.json"), "utf8")
      .then((content) => (JSON.parse(content) as UpdateConfig).url)
      .catch(() => undefined));
  if (typeof source !== "string" || !source.trim()) return null;
  try {
    const url = new URL(source);
    return url.protocol === "https:" ? url.toString().replace(/\/$/, "") : null;
  } catch {
    return null;
  }
}

function bindUpdaterEvents(): void {
  if (configured) return;
  configured = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.on("checking-for-update", () => publishStatus({ phase: "checking" }));
  autoUpdater.on("update-available", (info: UpdateInfo) =>
    publishStatus({ phase: "available", version: info.version }),
  );
  autoUpdater.on("update-not-available", () =>
    publishStatus({ phase: "not-available", version: undefined, progress: undefined }),
  );
  autoUpdater.on("download-progress", (progress: ProgressInfo) =>
    publishStatus({ phase: "downloading", progress: Math.round(progress.percent) }),
  );
  autoUpdater.on("update-downloaded", (info: UpdateInfo) =>
    publishStatus({ phase: "downloaded", version: info.version, progress: 100 }),
  );
  autoUpdater.on("error", () =>
    // No intrusive toast for a background network error. The next app launch
    // performs one fresh check.
    publishStatus({ phase: "error", progress: undefined }),
  );
}

export async function initializeUpdater(window: BrowserWindow): Promise<void> {
  targetWindow = window;
  if (!app.isPackaged) {
    publishStatus({ phase: "disabled" });
    return;
  }
  const url = await updateUrl();
  if (!url) {
    publishStatus({ phase: "disabled" });
    return;
  }
  bindUpdaterEvents();
  autoUpdater.setFeedURL({ provider: "generic", url });
  await checkForUpdates();
}

export function getUpdateStatus(): AppUpdateStatus {
  return status;
}

export async function checkForUpdates(): Promise<AppUpdateStatus> {
  if (!configured || checkStarted) return status;
  checkStarted = true;
  try {
    await autoUpdater.checkForUpdates();
  } catch {
    publishStatus({ phase: "error", progress: undefined });
  }
  return status;
}

export async function downloadUpdate(): Promise<AppUpdateStatus> {
  if (!configured || status.phase !== "available") return status;
  publishStatus({ phase: "downloading", progress: 0 });
  try {
    await autoUpdater.downloadUpdate();
  } catch {
    publishStatus({ phase: "error", progress: undefined });
  }
  return status;
}

export function installDownloadedUpdate(): boolean {
  if (!configured || status.phase !== "downloaded") return false;
  autoUpdater.quitAndInstall(false, true);
  return true;
}

import { app } from "electron";
import log from "electron-log/main";
import { join } from "node:path";

let initialized = false;

export function initializeLauncherLogging(): void {
  if (initialized) return;
  initialized = true;
  log.initialize();
  log.transports.file.level = "info";
  log.transports.file.maxSize = 2 * 1024 * 1024;
  log.transports.file.resolvePathFn = () =>
    join(app.getPath("userData"), "logs", "updater.log");
}

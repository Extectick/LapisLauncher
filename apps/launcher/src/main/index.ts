import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  safeStorage,
  shell,
} from "electron";
import { VelopackApp } from "velopack";
import type { OpenDialogOptions } from "electron";
import { is } from "@electron-toolkit/utils";
import { FSWatcher, watch } from "node:fs";
import { createServer, Server as HttpServer } from "node:http";
import { AddressInfo } from "node:net";
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir, totalmem } from "node:os";
import { basename, dirname, join } from "node:path";
import { createHash, randomBytes, timingSafeEqual, verify } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  canonicalInstallManifest,
  gameLaunchContextSchema,
  loginSchema,
  nicknameSchema,
  playerSkinSchema,
  registerSchema,
} from "@lapis/contracts";
import {
  GameInstallManifest,
  GameLaunchContext,
  PlayerSkin,
  ServerCatalogItem,
  signedInstallManifestSchema,
} from "@lapis/contracts";
import { z, ZodError } from "zod";
import {
  ensureJavaRuntime,
  ensureMinecraftRuntime,
  getJavaRuntime,
  getMinecraftBuildStatus,
  launchMinecraftRuntime,
  minecraftInstanceDirectory,
  removeMinecraftRuntime,
} from "@lapis/minecraft-core";
import {
  checkForUpdates,
  checkForUpdatesIfStale,
  downloadUpdate,
  getUpdateStatus,
  initializeUpdater,
  installDownloadedUpdate,
  shutdownUpdater,
} from "./updater";
import type { AppUpdateStatus } from "../shared/update-types";

// Velopack lifecycle hooks must be registered before the rest of the Electron
// application starts. Pending updates are applied explicitly after the
// Minecraft install guard has been restored, never before normal startup.
VelopackApp.build().setAutoApplyOnStartup(false).run();

const API_URL = process.env.LAPIS_API_URL ?? "https://lapis-mc.ru/api";
const SESSION_FILE = "session.bin";
const LAUNCH_SETTINGS_FILE = "launch-settings.json";
const RUNNING_GAME_FILE = "running-game.json";
const WINDOWS_APP_ID = "ru.lapis.launcher";
const WINDOW_ICON_PATH = join(__dirname, "../renderer/logo.ico");
const PRODUCTION_MANIFEST_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAhN02b2cG2J1WYsRD1jzTHPIYgpkeWAwTgxsdGVnklB4=
-----END PUBLIC KEY-----`;
const MANIFEST_PUBLIC_KEY = (
  process.env.LAPIS_MANIFEST_PUBLIC_KEY ?? PRODUCTION_MANIFEST_PUBLIC_KEY
).replace(/\\n/g, "\n");
const execFileAsync = promisify(execFile);

function apiUrl(path: string): string {
  const baseUrl = `${API_URL.replace(/\/+$/, "")}/`;
  return new URL(path.replace(/^\/+/, ""), baseUrl).toString();
}

// Keep the launcher profile next to game instances instead of Electron's roaming default.
app.setPath("userData", join(homedir(), ".lapis", "launcher"));
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

type User = { id: string; nickname: string };
type ApiAuthResponse = {
  user: User;
  accessToken: string;
  refreshToken: string;
};
type RendererAuthResponse = { user: User; accessToken: string };
type StoredSession = { refreshToken: string; user: User | null };
type FieldErrors = Partial<Record<"nickname" | "password", string>>;
type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { message: string; fields?: FieldErrors } };
type RunningGame = {
  pid: number;
  serverId: string;
  nickname: string;
  launchedAt: number;
  logPath: string;
};
type RunningGameStatus = Pick<RunningGame, "pid" | "serverId" | "nickname">;
const runningGameSchema = z.object({
  pid: z.number().int().positive(),
  serverId: z.string().min(1).max(64),
  nickname: z.string().min(1).max(16),
  launchedAt: z.number().int().positive(),
  logPath: z.string().min(1),
});
type LaunchSettings = {
  memoryMb: number;
  recommendedMemoryMb: number;
  maxMemoryMb: number;
  fullscreen: boolean;
};
type StoredLaunchSettings = Record<
  string,
  Pick<LaunchSettings, "memoryMb" | "fullscreen">
>;

let runningGame: RunningGame | null = null;
let restoreSessionRequest: Promise<
  IpcResult<RendererAuthResponse | null>
> | null = null;
let mainWindow: BrowserWindow | null = null;
let gameLogWatcher: FSWatcher | null = null;
let bridgeBootstrapClose: (() => void) | null = null;
let gameProcessMonitor: NodeJS.Timeout | null = null;

class ApiError extends Error {
  constructor(
    readonly messageForUser: string,
    readonly status?: number,
  ) {
    super(messageForUser);
  }
}

function sessionPath(): string {
  return join(app.getPath("userData"), SESSION_FILE);
}

function launchSettingsPath(): string {
  return join(app.getPath("userData"), LAUNCH_SETTINGS_FILE);
}

function memoryLimits(): Pick<
  LaunchSettings,
  "recommendedMemoryMb" | "maxMemoryMb"
> {
  const totalMb = Math.floor(totalmem() / (1024 * 1024));
  const maxMemoryMb = Math.max(1024, Math.floor(totalMb / 512) * 512);
  const baseline =
    totalMb >= 32 * 1024
      ? 8192
      : totalMb >= 16 * 1024
        ? 6144
        : totalMb >= 8 * 1024
          ? 4096
          : 2048;
  return {
    maxMemoryMb,
    recommendedMemoryMb: Math.min(baseline, maxMemoryMb),
  };
}

function defaultLaunchSettings(): LaunchSettings {
  const limits = memoryLimits();
  return { ...limits, memoryMb: limits.recommendedMemoryMb, fullscreen: false };
}

function validServerId(serverId: unknown): serverId is string {
  return typeof serverId === "string" && /^[a-z0-9_-]{1,32}$/i.test(serverId);
}

async function getLaunchSettings(serverId: string): Promise<LaunchSettings> {
  const defaults = defaultLaunchSettings();
  try {
    const saved = JSON.parse(
      await readFile(launchSettingsPath(), "utf8"),
    ) as StoredLaunchSettings;
    const value = saved[serverId];
    if (
      !value ||
      typeof value.fullscreen !== "boolean" ||
      !Number.isInteger(value.memoryMb)
    )
      return defaults;
    return {
      ...defaults,
      memoryMb: Math.min(
        defaults.maxMemoryMb,
        Math.max(1024, Math.floor(value.memoryMb / 512) * 512),
      ),
      fullscreen: value.fullscreen,
    };
  } catch {
    return defaults;
  }
}

async function saveLaunchSettings(
  serverId: string,
  settings: Pick<LaunchSettings, "memoryMb" | "fullscreen">,
): Promise<LaunchSettings> {
  const defaults = defaultLaunchSettings();
  if (
    !Number.isInteger(settings.memoryMb) ||
    settings.memoryMb < 1024 ||
    settings.memoryMb > defaults.maxMemoryMb ||
    settings.memoryMb % 512 !== 0 ||
    typeof settings.fullscreen !== "boolean"
  )
    throw new ApiError("Некорректные настройки запуска.");
  let saved: StoredLaunchSettings = {};
  try {
    saved = JSON.parse(
      await readFile(launchSettingsPath(), "utf8"),
    ) as StoredLaunchSettings;
  } catch {
    // First launch: settings file does not exist yet.
  }
  saved[serverId] = {
    memoryMb: settings.memoryMb,
    fullscreen: settings.fullscreen,
  };
  await mkdir(app.getPath("userData"), { recursive: true });
  const temporary = `${launchSettingsPath()}.tmp`;
  await writeFile(temporary, JSON.stringify(saved), "utf8");
  await rename(temporary, launchSettingsPath());
  return { ...defaults, ...saved[serverId] };
}

async function requestAuth(
  path: string,
  body: unknown,
): Promise<ApiAuthResponse> {
  const response = await net.fetch(apiUrl(path), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "message" in payload &&
      typeof payload.message === "string"
        ? payload.message
        : "Не удалось выполнить запрос. Проверьте подключение к Lapis API.";
    throw new ApiError(message, response.status);
  }
  return payload as ApiAuthResponse;
}

async function requestCatalog(): Promise<ServerCatalogItem[]> {
  try {
    const response = await net.fetch(apiUrl("/v1/servers"));
    if (!response.ok) throw new Error("Catalog request failed");
    return (await response.json()) as ServerCatalogItem[];
  } catch {
    throw new ApiError(
      "Не удалось загрузить каталог серверов. Повторите попытку.",
    );
  }
}

async function requestPlayerSkin(accessToken: string): Promise<PlayerSkin> {
  const response = await net.fetch(apiUrl("/v1/profile/skin"), {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok)
    throw new ApiError("Не удалось загрузить скин игрока.", response.status);
  return playerSkinSchema.parse(await response.json());
}

async function requestSkinUpload(
  accessToken: string,
  pngBase64: string,
): Promise<PlayerSkin> {
  const response = await net.fetch(apiUrl("/v1/profile/skin"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ pngBase64 }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "message" in payload &&
      typeof payload.message === "string"
        ? payload.message
        : "Не удалось загрузить скин.";
    throw new ApiError(message, response.status);
  }
  return playerSkinSchema.parse(payload);
}

async function selectSkinPng(): Promise<string | null> {
  const options: OpenDialogOptions = {
    title: "Выберите скин Minecraft",
    properties: ["openFile"],
    filters: [{ name: "Скин Minecraft", extensions: ["png"] }],
  };
  const selected = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  if (selected.canceled || !selected.filePaths[0]) return null;
  const path = selected.filePaths[0];
  const info = await stat(path);
  if (info.size > 20 * 1024)
    throw new ApiError("Размер скина не должен превышать 20 КБ.");
  const png = await readFile(path);
  const isPng =
    png.length >= 33 &&
    png
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const width = isPng ? png.readUInt32BE(16) : 0;
  const height = isPng ? png.readUInt32BE(20) : 0;
  if (!isPng || width !== 64 || (height !== 64 && height !== 32))
    throw new ApiError("Выберите PNG-скин 64×64 или 64×32.");
  return png.toString("base64");
}

async function requestInstallManifest(
  serverId: string,
): Promise<GameInstallManifest> {
  try {
    const response = await net.fetch(
      apiUrl(`/v1/servers/${encodeURIComponent(serverId)}/install-manifest`),
    );
    if (!response.ok) throw new Error("Install manifest request failed");
    const signed = signedInstallManifestSchema.parse(await response.json());
    const signatureIsValid = verify(
      null,
      Buffer.from(canonicalInstallManifest(signed.payload)),
      MANIFEST_PUBLIC_KEY,
      Buffer.from(signed.signature, "base64url"),
    );
    if (!signatureIsValid)
      throw new Error("Invalid install manifest signature");
    return signed.payload;
  } catch {
    throw new ApiError(
      "Не удалось проверить подпись состава сборки. Повторите попытку.",
    );
  }
}

async function requestGameLaunchContext(
  serverId: string,
  accessToken: string,
): Promise<GameLaunchContext> {
  const response = await net.fetch(
    apiUrl(`/v1/servers/${encodeURIComponent(serverId)}/game-launch-context`),
    {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
    },
  );
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "message" in payload &&
      typeof payload.message === "string"
        ? payload.message
        : "Не удалось подготовить игровой запуск.";
    throw new ApiError(message, response.status);
  }
  return gameLaunchContextSchema.parse(await response.json());
}

async function saveRefreshToken(token: string, user: User): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new ApiError(
      "Защищённое хранилище Windows недоступно. Сессия не будет сохранена.",
    );
  }
  const target = sessionPath();
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.new`;
  await writeFile(
    temporary,
    safeStorage.encryptString(JSON.stringify({ refreshToken: token, user })),
    { mode: 0o600 },
  );
  await rename(temporary, target);
}

async function readStoredSession(): Promise<StoredSession | null> {
  try {
    const decrypted = safeStorage.decryptString(await readFile(sessionPath()));
    try {
      const value: unknown = JSON.parse(decrypted);
      if (
        typeof value === "object" &&
        value !== null &&
        "refreshToken" in value &&
        typeof value.refreshToken === "string"
      ) {
        const savedUser =
          "user" in value &&
          typeof value.user === "object" &&
          value.user !== null &&
          "id" in value.user &&
          "nickname" in value.user &&
          typeof value.user.id === "string" &&
          typeof value.user.nickname === "string"
            ? { id: value.user.id, nickname: value.user.nickname }
            : null;
        return { refreshToken: value.refreshToken, user: savedUser };
      }
    } catch {
      /* compatibility with the legacy token-only format */
    }
    return decrypted ? { refreshToken: decrypted, user: null } : null;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return null;
    await appendFile(
      join(app.getPath("userData"), "auth-restore.log"),
      `${new Date().toISOString()} refresh-token-read-failed: ${error instanceof Error ? error.name : "unknown"}\n`,
    ).catch(() => undefined);
    return null;
  }
}

function toRendererAuth(response: ApiAuthResponse): RendererAuthResponse {
  return { user: response.user, accessToken: response.accessToken };
}

function zodFailure(error: ZodError): IpcResult<never> {
  const flattened = error.flatten();
  const fields: FieldErrors = {};
  for (const field of ["nickname", "password"] as const) {
    const message = flattened.fieldErrors[field]?.at(0);
    if (message) fields[field] = message;
  }
  return {
    ok: false,
    error: {
      message: flattened.formErrors.at(0) ?? "Проверьте заполненные поля.",
      fields,
    },
  };
}

async function performAuth(
  path: string,
  input: unknown,
): Promise<IpcResult<RendererAuthResponse>> {
  try {
    const response = await requestAuth(path, input);
    await saveRefreshToken(response.refreshToken, response.user);
    return { ok: true, data: toRendererAuth(response) };
  } catch (error) {
    const message =
      error instanceof ApiError
        ? error.messageForUser
        : "Не удалось выполнить запрос. Повторите попытку.";
    return { ok: false, error: { message } };
  }
}

async function restoreSession(): Promise<
  IpcResult<RendererAuthResponse | null>
> {
  const stored = await readStoredSession();
  if (!stored) return { ok: true, data: null };
  try {
    const response = await requestAuth("/v1/auth/refresh", {
      refreshToken: stored.refreshToken,
    });
    await saveRefreshToken(response.refreshToken, response.user);
    await appendFile(
      join(app.getPath("userData"), "auth-restore.log"),
      `${new Date().toISOString()} session-restored\n`,
    ).catch(() => undefined);
    return { ok: true, data: toRendererAuth(response) };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      await rm(sessionPath(), { force: true });
      await appendFile(
        join(app.getPath("userData"), "auth-restore.log"),
        `${new Date().toISOString()} session-rejected-401\n`,
      ).catch(() => undefined);
      return { ok: true, data: null };
    }
    const cause =
      error instanceof Error && error.cause instanceof Error
        ? `-${error.cause.name}`
        : "";
    await appendFile(
      join(app.getPath("userData"), "auth-restore.log"),
      `${new Date().toISOString()} session-restore-failed: ${error instanceof Error ? error.name : "unknown"}${cause}${error instanceof ApiError && error.status ? `-${error.status}` : ""}\n`,
    ).catch(() => undefined);
    if (stored.user)
      return { ok: true, data: { user: stored.user, accessToken: "" } };
    const message =
      error instanceof ApiError
        ? error.messageForUser
        : "Не удалось восстановить сессию. Повторите попытку.";
    return { ok: false, error: { message } };
  }
}

async function refreshedLaunchContext(
  serverId: string,
  accessToken: string,
): Promise<GameLaunchContext> {
  try {
    if (accessToken.length >= 20)
      return await requestGameLaunchContext(serverId, accessToken);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) {
      throw new ApiError(
        "Сервер авторизации недоступен. Сессия сохранена — повторите позже.",
      );
    }
  }
  const stored = await readStoredSession();
  if (!stored) throw new ApiError("Сессия не найдена. Войдите снова.");
  try {
    const refreshed = await requestAuth("/v1/auth/refresh", {
      refreshToken: stored.refreshToken,
    });
    await saveRefreshToken(refreshed.refreshToken, refreshed.user);
    return await requestGameLaunchContext(serverId, refreshed.accessToken);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      throw new ApiError("Сессия больше не действительна. Войдите снова.");
    throw new ApiError(
      "Сервер авторизации недоступен. Сессия сохранена — повторите позже.",
    );
  }
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function processMatchesPersistedGame(
  game: RunningGame,
): Promise<boolean> {
  if (!processIsRunning(game.pid)) return false;
  if (process.platform !== "win32") return true;
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-Process -Id ${game.pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`,
      ],
      { windowsHide: true, timeout: 5_000 },
    );
    const processStartedAt = Date.parse(stdout.trim());
    return (
      Number.isFinite(processStartedAt) &&
      Math.abs(processStartedAt - game.launchedAt) < 60_000
    );
  } catch {
    return false;
  }
}

function runningGameStatePath(): string {
  return join(app.getPath("userData"), RUNNING_GAME_FILE);
}

async function persistRunningGame(game: RunningGame): Promise<void> {
  await mkdir(app.getPath("userData"), { recursive: true });
  const path = runningGameStatePath();
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(game), "utf8");
  await rename(temporary, path);
}

async function restoreRunningGame(): Promise<void> {
  const path = runningGameStatePath();
  try {
    const restored = runningGameSchema.parse(
      JSON.parse(await readFile(path, "utf8")),
    );
    if (!(await processMatchesPersistedGame(restored)))
      throw new Error("Persisted Minecraft process identity does not match.");
    runningGame = restored;
    if (await currentRunningGame()) startGameProcessMonitor();
  } catch {
    runningGame = null;
    await rm(path, { force: true }).catch(() => undefined);
  }
}

function clearRunningGame(): void {
  runningGame = null;
  void rm(runningGameStatePath(), { force: true }).catch(() => undefined);
  if (gameProcessMonitor) clearInterval(gameProcessMonitor);
  gameProcessMonitor = null;
  gameLogWatcher?.close();
  gameLogWatcher = null;
  bridgeBootstrapClose?.();
  bridgeBootstrapClose = null;
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send("runtime:game-exited");
}

function startGameProcessMonitor(): void {
  if (gameProcessMonitor) clearInterval(gameProcessMonitor);
  // Child-process events cover normal exits. This small fallback is active
  // only while the game runs and catches a process killed outside the launcher.
  gameProcessMonitor = setInterval(() => void currentRunningGame(), 2_000);
  gameProcessMonitor.unref();
}

function reportInstallProgress(serverId: string, progress: number): void {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send("runtime:install-progress", {
      serverId,
      progress: Math.max(0, Math.min(100, Math.round(progress))),
    });
}

type BridgeBootstrap = { port: number; nonce: string; close: () => void };

function nonceMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const actual = Buffer.from(provided);
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

async function createBridgeBootstrap(
  context: Omit<GameLaunchContext, "expiresAt"> & {
    nickname: string;
    minecraftUuid: string;
  },
): Promise<BridgeBootstrap> {
  const nonce = randomBytes(32).toString("base64url");
  let consumed = false;
  let timeout: NodeJS.Timeout | undefined;
  let server: HttpServer | undefined;
  const close = (): void => {
    if (timeout) clearTimeout(timeout);
    timeout = undefined;
    server?.close();
    server = undefined;
  };
  server = createServer((request, response) => {
    const bootstrapHeader = request.headers["x-lapis-bootstrap"];
    const validRequest =
      request.method === "POST" &&
      request.url === "/v1/launch-context" &&
      nonceMatches(
        typeof bootstrapHeader === "string" ? bootstrapHeader : undefined,
        nonce,
      ) &&
      !consumed;
    if (!validRequest) {
      response.writeHead(404).end();
      return;
    }
    consumed = true;
    const payload = JSON.stringify(context);
    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "content-length": Buffer.byteLength(payload),
    });
    response.end(payload, close);
  });
  await new Promise<void>((resolve, reject) => {
    server?.once("error", reject);
    server?.listen(0, "127.0.0.1", () => resolve());
  });
  timeout = setTimeout(close, 90_000);
  timeout.unref();
  return { port: (server.address() as AddressInfo).port, nonce, close };
}

async function currentRunningGame(): Promise<RunningGameStatus | null> {
  const game = runningGame;
  if (!game) return null;
  if (!processIsRunning(game.pid)) {
    clearRunningGame();
    return null;
  }
  try {
    const logInfo = await stat(game.logPath);
    if (logInfo.mtimeMs >= game.launchedAt) {
      const logTail = (await readFile(game.logPath, "utf8")).slice(-65_536);
      if (/\[.+?\/(?:INFO|WARN)\]: Stopping!\s*$/m.test(logTail)) {
        clearRunningGame();
        return null;
      }
    }
  } catch {
    // The log can be unavailable while Minecraft creates its game directory.
  }
  return { pid: game.pid, serverId: game.serverId, nickname: game.nickname };
}

async function waitForMinecraftWindow(
  game: RunningGame,
  hasExited: () => boolean,
): Promise<void> {
  const deadline = Date.now() + 90_000;
  const readyMarker =
    /\[Render thread\/INFO\]: OpenGL (?:Vendor|Renderer):|\[Render thread\/INFO\]: Sound engine started/;
  while (Date.now() < deadline) {
    if (hasExited() || !processIsRunning(game.pid))
      throw new ApiError("Minecraft завершился до открытия игрового окна.");
    try {
      const logInfo = await stat(game.logPath);
      if (logInfo.mtimeMs >= game.launchedAt) {
        const logTail = (await readFile(game.logPath, "utf8")).slice(-131_072);
        if (readyMarker.test(logTail)) return;
      }
    } catch {
      // Minecraft creates latest.log during its own early startup.
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  // Keep the game usable even if a mod changes its startup log format.
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    resizable: false,
    maximizable: false,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#0b1120",
    icon: WINDOW_ICON_PATH,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    if (mainWindow)
      void initializeUpdater(mainWindow, {
        installGuard: async () =>
          (await currentRunningGame())
            ? "Закройте Minecraft перед обновлением лаунчера."
            : null,
      });
  });
  mainWindow.on("focus", checkForUpdatesIfStale);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:")) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  mainWindow.webContents.session.setPermissionCheckHandler(() => false);
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

if (hasSingleInstanceLock)
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  await restoreRunningGame();
  app.setAppUserModelId(WINDOWS_APP_ID);
  ipcMain.handle(
    "updates:status",
    async () =>
      ({
        ok: true,
        data: getUpdateStatus(),
      }) satisfies IpcResult<AppUpdateStatus>,
  );
  ipcMain.handle(
    "updates:check",
    async () =>
      ({
        ok: true,
        data: await checkForUpdates("manual"),
      }) satisfies IpcResult<AppUpdateStatus>,
  );
  ipcMain.handle(
    "updates:download",
    async () =>
      ({
        ok: true,
        data: await downloadUpdate(),
      }) satisfies IpcResult<AppUpdateStatus>,
  );
  ipcMain.handle("updates:install", async () => {
    const result = await installDownloadedUpdate();
    if (!result.ok)
      return {
        ok: false,
        error: { message: result.message },
      } satisfies IpcResult<null>;
    return { ok: true, data: null } satisfies IpcResult<null>;
  });
  ipcMain.handle("auth:register", async (_event, input: unknown) => {
    const parsed = registerSchema.safeParse(input);
    return parsed.success
      ? performAuth("/v1/auth/register", parsed.data)
      : zodFailure(parsed.error);
  });
  ipcMain.handle("auth:login", async (_event, input: unknown) => {
    const parsed = loginSchema.safeParse(input);
    return parsed.success
      ? performAuth("/v1/auth/login", parsed.data)
      : zodFailure(parsed.error);
  });
  ipcMain.handle("auth:restore", () => {
    restoreSessionRequest ??= restoreSession();
    return restoreSessionRequest;
  });
  ipcMain.handle("auth:logout", async () => {
    const stored = await readStoredSession();
    if (stored) {
      try {
        await requestAuth("/v1/auth/logout", {
          refreshToken: stored.refreshToken,
        });
      } catch {
        /* local removal still ends this device session */
      }
    }
    await rm(sessionPath(), { force: true });
    restoreSessionRequest = null;
    return { ok: true, data: null } satisfies IpcResult<null>;
  });
  ipcMain.handle("catalog:list", async () => {
    try {
      return { ok: true, data: await requestCatalog() } satisfies IpcResult<
        ServerCatalogItem[]
      >;
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.messageForUser
          : "Не удалось загрузить каталог серверов.";
      return { ok: false, error: { message } } satisfies IpcResult<
        ServerCatalogItem[]
      >;
    }
  });
  ipcMain.handle("profile:skin", async (_event, accessToken: unknown) => {
    try {
      if (typeof accessToken !== "string" || accessToken.length < 20)
        throw new ApiError("Сессия недоступна.");
      return {
        ok: true,
        data: await requestPlayerSkin(accessToken),
      } satisfies IpcResult<PlayerSkin>;
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.messageForUser
          : "Не удалось загрузить скин игрока.";
      return { ok: false, error: { message } } satisfies IpcResult<PlayerSkin>;
    }
  });
  ipcMain.handle(
    "profile:upload-skin",
    async (_event, accessToken: unknown) => {
      try {
        if (typeof accessToken !== "string" || accessToken.length < 20)
          throw new ApiError("Сессия недоступна.");
        const pngBase64 = await selectSkinPng();
        if (!pngBase64)
          return {
            ok: true,
            data: null,
          } satisfies IpcResult<PlayerSkin | null>;
        return {
          ok: true,
          data: await requestSkinUpload(accessToken, pngBase64),
        } satisfies IpcResult<PlayerSkin | null>;
      } catch (error) {
        const message =
          error instanceof ApiError
            ? error.messageForUser
            : "Не удалось загрузить скин.";
        return {
          ok: false,
          error: { message },
        } satisfies IpcResult<PlayerSkin | null>;
      }
    },
  );
  ipcMain.handle("runtime:java-status", async () => ({
    ok: true,
    data: await getJavaRuntime(),
  }));
  ipcMain.handle("runtime:ensure-java", async () => {
    try {
      return { ok: true, data: await ensureJavaRuntime() };
    } catch {
      return {
        ok: false,
        error: {
          message:
            "Не удалось подготовить Java. Проверьте подключение и повторите попытку.",
        },
      };
    }
  });
  ipcMain.handle("runtime:ensure-game", async (_event, serverId: unknown) => {
    try {
      if (typeof serverId !== "string" || !/^[a-z0-9_-]{1,32}$/i.test(serverId))
        throw new ApiError("Некорректный сервер.");
      const manifest = await requestInstallManifest(serverId);
      reportInstallProgress(serverId, 1);
      await ensureJavaRuntime();
      return {
        ok: true,
        data: await ensureMinecraftRuntime(manifest, (progress) =>
          reportInstallProgress(serverId, progress),
        ),
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Не удалось установить Minecraft/Fabric. Повторите попытку.";
      return { ok: false, error: { message } };
    }
  });
  ipcMain.handle("runtime:build-status", async (_event, serverId: unknown) => {
    try {
      if (typeof serverId !== "string" || !/^[a-z0-9_-]{1,32}$/i.test(serverId))
        throw new ApiError("Некорректный сервер.");
      return {
        ok: true,
        data: await getMinecraftBuildStatus(
          await requestInstallManifest(serverId),
        ),
      };
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.messageForUser
          : "Не удалось проверить сборку.";
      return { ok: false, error: { message } };
    }
  });
  ipcMain.handle(
    "runtime:launch-settings",
    async (_event, serverId: unknown) => {
      if (!validServerId(serverId))
        return {
          ok: false,
          error: { message: "Некорректный сервер." },
        } satisfies IpcResult<LaunchSettings>;
      return {
        ok: true,
        data: await getLaunchSettings(serverId),
      } satisfies IpcResult<LaunchSettings>;
    },
  );
  ipcMain.handle(
    "runtime:save-launch-settings",
    async (_event, serverId: unknown, settings: unknown) => {
      try {
        if (
          !validServerId(serverId) ||
          typeof settings !== "object" ||
          settings === null
        )
          throw new ApiError("Некорректные настройки запуска.");
        const input = settings as Partial<
          Pick<LaunchSettings, "memoryMb" | "fullscreen">
        >;
        if (
          typeof input.memoryMb !== "number" ||
          typeof input.fullscreen !== "boolean"
        )
          throw new ApiError("Некорректные настройки запуска.");
        return {
          ok: true,
          data: await saveLaunchSettings(
            serverId,
            input as Pick<LaunchSettings, "memoryMb" | "fullscreen">,
          ),
        } satisfies IpcResult<LaunchSettings>;
      } catch (error) {
        return {
          ok: false,
          error: {
            message:
              error instanceof ApiError
                ? error.messageForUser
                : "Не удалось сохранить настройки запуска.",
          },
        } satisfies IpcResult<LaunchSettings>;
      }
    },
  );
  ipcMain.handle("runtime:remove-game", async (_event, serverId: unknown) => {
    try {
      if (typeof serverId !== "string" || !/^[a-z0-9_-]{1,32}$/i.test(serverId))
        throw new ApiError("Некорректный сервер.");
      const manifest = await requestInstallManifest(serverId);
      if (runningGame?.serverId === serverId)
        throw new ApiError("Сначала остановите Minecraft.");
      await removeMinecraftRuntime(manifest.id);
      return { ok: true, data: null } satisfies IpcResult<null>;
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.messageForUser
          : "Не удалось удалить сборку.";
      return { ok: false, error: { message } } satisfies IpcResult<null>;
    }
  });
  ipcMain.handle(
    "runtime:open-game-directory",
    async (_event, serverId: unknown) => {
      try {
        if (
          typeof serverId !== "string" ||
          !/^[a-z0-9_-]{1,32}$/i.test(serverId)
        )
          throw new ApiError("Некорректный сервер.");
        const manifest = await requestInstallManifest(serverId);
        const error = await shell.openPath(
          minecraftInstanceDirectory(manifest.id),
        );
        if (error) throw new Error(error);
        return { ok: true, data: null } satisfies IpcResult<null>;
      } catch (error) {
        const message =
          error instanceof ApiError
            ? error.messageForUser
            : "Не удалось открыть настройки сборки.";
        return { ok: false, error: { message } } satisfies IpcResult<null>;
      }
    },
  );
  ipcMain.handle("runtime:game-status", async () => ({
    ok: true,
    data: await currentRunningGame(),
  }));
  ipcMain.handle("runtime:stop-game", async () => {
    const game = await currentRunningGame();
    if (!game) return { ok: true, data: null } satisfies IpcResult<null>;
    try {
      await execFileAsync(
        "taskkill.exe",
        ["/pid", String(game.pid), "/t", "/f"],
        { windowsHide: true },
      );
      clearRunningGame();
      return { ok: true, data: null } satisfies IpcResult<null>;
    } catch {
      return {
        ok: false,
        error: { message: "Не удалось остановить Minecraft." },
      } satisfies IpcResult<null>;
    }
  });
  ipcMain.handle(
    "runtime:launch-game",
    async (
      _event,
      serverId: unknown,
      nickname: unknown,
      accessToken: unknown,
    ) => {
      try {
        if (await currentRunningGame())
          throw new ApiError("Игра уже запущена.");
        if (
          typeof serverId !== "string" ||
          !/^[a-z0-9_-]{1,32}$/i.test(serverId)
        )
          throw new ApiError("Некорректный сервер.");
        const parsedNickname = nicknameSchema.safeParse(nickname);
        if (!parsedNickname.success)
          throw new ApiError("Некорректный профиль игрока.");
        if (typeof accessToken !== "string")
          throw new ApiError("Некорректная сессия.");
        const manifest = await requestInstallManifest(serverId);
        reportInstallProgress(serverId, 1);
        await ensureJavaRuntime();
        const runtime = await ensureMinecraftRuntime(manifest, (progress) =>
          reportInstallProgress(serverId, progress),
        );
        const launchContext = await refreshedLaunchContext(
          serverId,
          accessToken,
        );
        if (launchContext.buildId !== manifest.id)
          throw new ApiError("Состав сборки изменился. Повторите запуск.");
        const uuid = createHash("md5")
          .update(`OfflinePlayer:${parsedNickname.data}`)
          .digest("hex");
        const bootstrap = await createBridgeBootstrap({
          ...launchContext,
          nickname: parsedNickname.data,
          minecraftUuid: uuid,
        });
        bridgeBootstrapClose?.();
        bridgeBootstrapClose = bootstrap.close;
        const settings = await getLaunchSettings(serverId);
        const launchedAt = Date.now();
        const process = await launchMinecraftRuntime(manifest, runtime, {
          nickname: parsedNickname.data,
          uuid,
          memoryMb: settings.memoryMb,
          fullscreen: settings.fullscreen,
          bridgeBootstrap: bootstrap,
        });
        if (!process.pid) throw new Error("Minecraft process did not start.");
        runningGame = {
          pid: process.pid,
          serverId,
          nickname: parsedNickname.data,
          launchedAt,
          // Use the same validated instance-path helper as install, removal
          // and launch. This keeps monitoring correct if storage layout changes.
          logPath: join(
            minecraftInstanceDirectory(runtime.instanceId),
            "logs",
            "latest.log",
          ),
        };
        let processExited = false;
        process.once("exit", () => {
          processExited = true;
          clearRunningGame();
        });
        process.once("error", () => {
          processExited = true;
          clearRunningGame();
        });
        await persistRunningGame(runningGame);
        if (processExited || !processIsRunning(runningGame.pid)) {
          clearRunningGame();
          throw new Error("Minecraft process exited during startup.");
        }
        gameLogWatcher?.close();
        const activeLogName = basename(runningGame.logPath);
        // A first Minecraft launch creates `logs` lazily. Make the directory
        // ourselves and never let monitoring turn a successful game spawn into
        // a failed IPC response.
        await mkdir(dirname(runningGame.logPath), { recursive: true });
        try {
          // Watch the directory, not latest.log itself: Minecraft may recreate
          // that file during startup/shutdown, which detaches a file watcher.
          gameLogWatcher = watch(
            dirname(runningGame.logPath),
            { persistent: false },
            (_event, fileName) => {
              if (!fileName || fileName.toString() === activeLogName)
                void currentRunningGame();
            },
          );
        } catch {
          // Process exit events still keep the launcher state correct.
          gameLogWatcher = null;
        }
        startGameProcessMonitor();
        await waitForMinecraftWindow(runningGame, () => processExited);
        reportInstallProgress(serverId, 100);
        return {
          ok: true,
          data: {
            pid: runningGame.pid,
            serverId: runningGame.serverId,
            nickname: runningGame.nickname,
          },
        };
      } catch (error) {
        const message =
          error instanceof ApiError
            ? error.messageForUser
            : "Не удалось запустить Minecraft. Проверьте подготовку сборки и повторите попытку.";
        return { ok: false, error: { message } };
      }
    },
  );
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", shutdownUpdater);

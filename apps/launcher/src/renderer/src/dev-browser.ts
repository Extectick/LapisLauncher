import type {
  AdminClientMod,
  AdminClientModDeleteInput,
  AdminClientModDeleteResult,
  AdminServer,
  AdminServerCreateInput,
  AdminServerUpdateInput,
  CurrentUser,
  PlayerSkin,
  ServerCatalogItem,
  ServerMod,
  ServerPlayer,
} from "@lapis/contracts";
import type { AppUpdateStatus } from "../../shared/update-types";

const API_URL = "http://127.0.0.1:3000";
const SESSION_KEY = "lapis:browser-dev-session";

type BrowserSession = {
  accessToken: string;
  refreshToken: string;
  user: { id: string; nickname: string };
};
type IpcResult<T> =
  { ok: true; data: T } | { ok: false; error: { message: string } };

let session: BrowserSession | null = readSession();

function readSession(): BrowserSession | null {
  try {
    const value: unknown = JSON.parse(
      sessionStorage.getItem(SESSION_KEY) ?? "null",
    );
    if (
      value &&
      typeof value === "object" &&
      "accessToken" in value &&
      "refreshToken" in value &&
      "user" in value &&
      typeof value.accessToken === "string" &&
      typeof value.refreshToken === "string" &&
      value.user &&
      typeof value.user === "object" &&
      "id" in value.user &&
      "nickname" in value.user &&
      typeof value.user.id === "string" &&
      typeof value.user.nickname === "string"
    )
      return value as BrowserSession;
  } catch {
    // Invalid dev-only browser state is discarded below.
  }
  sessionStorage.removeItem(SESSION_KEY);
  return null;
}

function saveSession(value: BrowserSession | null): void {
  session = value;
  if (value) sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
  else sessionStorage.removeItem(SESSION_KEY);
}

async function message(response: Response, fallback: string): Promise<string> {
  const payload: unknown = await response.json().catch(() => null);
  return typeof payload === "object" &&
    payload !== null &&
    "message" in payload &&
    typeof payload.message === "string"
    ? payload.message
    : fallback;
}

async function refresh(): Promise<string> {
  if (!session) throw new Error("Сессия не найдена. Войдите снова.");
  const response = await fetch(`${API_URL}/v1/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  });
  if (!response.ok) {
    if (response.status === 401) saveSession(null);
    throw new Error(await message(response, "Не удалось обновить сессию."));
  }
  const payload = (await response.json()) as BrowserSession;
  saveSession(payload);
  return payload.accessToken;
}

async function authorized(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const request = async (accessToken: string): Promise<Response> =>
    fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        authorization: `Bearer ${accessToken}`,
      },
    });
  if (!session) await refresh();
  let response = await request(session!.accessToken);
  if (response.status === 401) response = await request(await refresh());
  return response;
}

async function currentUser(): Promise<CurrentUser> {
  const response = await authorized("/v1/me");
  if (!response.ok)
    throw new Error(await message(response, "Не удалось проверить сессию."));
  return (await response.json()) as CurrentUser;
}

function resultError<T>(error: unknown, fallback: string): IpcResult<T> {
  return {
    ok: false,
    error: { message: error instanceof Error ? error.message : fallback },
  };
}

async function authenticate(
  action: "login" | "register",
  input: { nickname: string; password: string },
): Promise<IpcResult<CurrentUser>> {
  try {
    const response = await fetch(`${API_URL}/v1/auth/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok)
      throw new Error(await message(response, "Не удалось войти."));
    saveSession((await response.json()) as BrowserSession);
    return { ok: true, data: await currentUser() };
  } catch (error) {
    return resultError(error, "Не удалось войти.");
  }
}

async function chooseSkin(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        const value = typeof reader.result === "string" ? reader.result : "";
        resolve(value.replace(/^data:image\/png;base64,/, ""));
      });
      reader.addEventListener("error", () => resolve(null));
      reader.readAsDataURL(file);
    });
    input.click();
  });
}

async function chooseClientMod(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".jar,application/java-archive,application/octet-stream";
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), {
      once: true,
    });
    input.click();
  });
}

const disabledUpdate: AppUpdateStatus = {
  currentVersion: "dev-browser",
  phase: "disabled",
  startup: false,
};

export function installBrowserDevBridge(): void {
  if (window.lapis) return;
  window.lapis = {
    auth: {
      login: (input) => authenticate("login", input),
      register: (input) => authenticate("register", input),
      restore: async () => {
        if (!session) return { ok: true, data: null };
        try {
          await refresh();
          return { ok: true, data: await currentUser() };
        } catch (error) {
          return resultError(error, "Не удалось восстановить сессию.");
        }
      },
      me: async () => {
        try {
          return { ok: true, data: await currentUser() };
        } catch (error) {
          return resultError(error, "Не удалось обновить права.");
        }
      },
      logout: async () => {
        const saved = session;
        saveSession(null);
        if (saved)
          await fetch(`${API_URL}/v1/auth/logout`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ refreshToken: saved.refreshToken }),
          }).catch(() => undefined);
        return { ok: true, data: null };
      },
    },
    catalog: {
      list: async () => {
        try {
          const response = await fetch(`${API_URL}/v1/servers`);
          if (!response.ok) throw new Error("Не удалось загрузить серверы.");
          return {
            ok: true,
            data: (await response.json()) as ServerCatalogItem[],
          };
        } catch (error) {
          return resultError(error, "Не удалось загрузить серверы.");
        }
      },
      mods: async (serverId) => {
        try {
          const response = await fetch(
            `${API_URL}/v1/servers/${encodeURIComponent(serverId)}/mods`,
          );
          if (!response.ok)
            throw new Error("Не удалось загрузить список модов.");
          return { ok: true, data: (await response.json()) as ServerMod[] };
        } catch (error) {
          return resultError(error, "Не удалось загрузить список модов.");
        }
      },
      players: async (serverId) => {
        try {
          const response = await fetch(
            `${API_URL}/v1/servers/${encodeURIComponent(serverId)}/players`,
          );
          if (!response.ok) throw new Error("Не удалось загрузить игроков.");
          return { ok: true, data: (await response.json()) as ServerPlayer[] };
        } catch (error) {
          return resultError(error, "Не удалось загрузить игроков.");
        }
      },
    },
    profile: {
      skin: async () => {
        try {
          const response = await authorized("/v1/profile/skin");
          if (!response.ok) throw new Error("Не удалось загрузить скин.");
          return { ok: true, data: (await response.json()) as PlayerSkin };
        } catch (error) {
          return resultError(error, "Не удалось загрузить скин.");
        }
      },
      uploadSkin: async () => {
        try {
          const pngBase64 = await chooseSkin();
          if (!pngBase64) return { ok: true, data: null };
          const response = await authorized("/v1/profile/skin", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ pngBase64 }),
          });
          if (!response.ok)
            throw new Error(
              await message(response, "Не удалось загрузить скин."),
            );
          return { ok: true, data: (await response.json()) as PlayerSkin };
        } catch (error) {
          return resultError(error, "Не удалось загрузить скин.");
        }
      },
    },
    admin: {
      servers: async () => {
        try {
          const response = await authorized("/v1/admin/servers");
          if (!response.ok)
            throw new Error(
              await message(response, "Не удалось загрузить серверы."),
            );
          return { ok: true, data: (await response.json()) as AdminServer[] };
        } catch (error) {
          return resultError(error, "Не удалось загрузить серверы.");
        }
      },
      createServer: async (input: AdminServerCreateInput) => {
        try {
          const response = await authorized("/v1/admin/servers", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(input),
          });
          if (!response.ok)
            throw new Error(
              await message(response, "Не удалось добавить сервер."),
            );
          return { ok: true, data: (await response.json()) as AdminServer };
        } catch (error) {
          return resultError(error, "Не удалось добавить сервер.");
        }
      },
      updateServer: async (serverId: string, input: AdminServerUpdateInput) => {
        try {
          const response = await authorized(
            `/v1/admin/servers/${encodeURIComponent(serverId)}`,
            {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(input),
            },
          );
          if (!response.ok)
            throw new Error(
              await message(response, "Не удалось сохранить сервер."),
            );
          return { ok: true, data: (await response.json()) as AdminServer };
        } catch (error) {
          return resultError(error, "Не удалось сохранить сервер.");
        }
      },
      clientMods: async (serverId: string) => {
        try {
          const response = await authorized(
            `/v1/admin/servers/${encodeURIComponent(serverId)}/client-mods`,
          );
          if (!response.ok)
            throw new Error(
              await message(response, "Не удалось загрузить клиентские моды."),
            );
          return {
            ok: true,
            data: (await response.json()) as AdminClientMod[],
          };
        } catch (error) {
          return resultError(error, "Не удалось загрузить клиентские моды.");
        }
      },
      toggleClientMod: async (
        serverId: string,
        modId: string,
        enabled: boolean,
      ) => {
        try {
          const response = await authorized(
            `/v1/admin/servers/${encodeURIComponent(serverId)}/client-mods/${encodeURIComponent(modId)}`,
            {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ enabled }),
            },
          );
          if (!response.ok)
            throw new Error(
              await message(response, "Не удалось изменить клиентский мод."),
            );
          return { ok: true, data: (await response.json()) as AdminClientMod };
        } catch (error) {
          return resultError(error, "Не удалось изменить клиентский мод.");
        }
      },
      uploadClientMod: async (serverId: string) => {
        try {
          const file = await chooseClientMod();
          if (!file) return { ok: true, data: null };
          const form = new FormData();
          form.append("file", file, file.name);
          const response = await authorized(
            `/v1/admin/servers/${encodeURIComponent(serverId)}/client-mods`,
            { method: "POST", body: form },
          );
          if (!response.ok)
            throw new Error(
              await message(response, "Не удалось загрузить клиентский мод."),
            );
          return { ok: true, data: (await response.json()) as AdminClientMod };
        } catch (error) {
          return resultError(error, "Не удалось загрузить клиентский мод.");
        }
      },
      deleteClientMods: async (
        serverId: string,
        input: AdminClientModDeleteInput,
      ): Promise<IpcResult<AdminClientModDeleteResult>> => {
        try {
          const response = await authorized(
            `/v1/admin/servers/${encodeURIComponent(serverId)}/client-mods`,
            {
              method: "DELETE",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(input),
            },
          );
          if (!response.ok)
            throw new Error(
              await message(response, "Не удалось удалить клиентские моды."),
            );
          return {
            ok: true,
            data: (await response.json()) as AdminClientModDeleteResult,
          };
        } catch (error) {
          return resultError(error, "Не удалось удалить клиентские моды.");
        }
      },
    },
    updates: {
      status: async () => ({ ok: true, data: disabledUpdate }),
      check: async () => ({ ok: true, data: disabledUpdate }),
      download: async () => ({ ok: true, data: disabledUpdate }),
      install: async () => ({ ok: true, data: null }),
      onStatus: () => () => undefined,
    },
    runtime: {
      customMods: async () => ({ ok: true, data: [] }),
      watchCustomMods: async () => ({
        ok: true,
        data: { mods: [], added: [], rejected: [] },
      }),
      unwatchCustomMods: async () => ({ ok: true, data: null }),
      openCustomModsFolder: async () =>
        resultError("", "Открытие папки доступно только в Electron."),
      onCustomModsChanged: () => () => undefined,
      addCustomMod: async () =>
        resultError(
          "",
          "Добавление локальных модов доступно только в Electron.",
        ),
      toggleCustomMod: async () =>
        resultError(
          "",
          "Изменение локальных модов доступно только в Electron.",
        ),
      deleteCustomMods: async () =>
        resultError("", "Удаление локальных модов доступно только в Electron."),
      javaStatus: async () => ({
        ok: true,
        data: { major: 25, installed: true },
      }),
      ensureJava: async () => ({
        ok: true,
        data: { major: 25, installed: true },
      }),
      ensureGame: async () =>
        resultError("", "Запуск доступен только в Electron."),
      buildStatus: async () => ({ ok: true, data: "ready" }),
      launchSettings: async () => ({
        ok: true,
        data: {
          memoryMb: 6144,
          recommendedMemoryMb: 6144,
          maxMemoryMb: 8192,
          fullscreen: false,
        },
      }),
      saveLaunchSettings: async (_serverId, settings) => ({
        ok: true,
        data: { ...settings, recommendedMemoryMb: 6144, maxMemoryMb: 8192 },
      }),
      removeGame: async () => ({ ok: true, data: null }),
      openGameDirectory: async () =>
        resultError("", "Доступно только в Electron."),
      gameStatus: async () => ({ ok: true, data: null }),
      stopGame: async () => ({ ok: true, data: null }),
      launchGame: async () =>
        resultError("", "Запуск доступен только в Electron."),
      onGameExit: () => () => undefined,
      onInstallProgress: () => () => undefined,
    },
  };
}

import { contextBridge, ipcRenderer } from "electron";
import type { AppUpdateStatus } from "../shared/update-types";

type AuthInput = { nickname: string; password: string };
type AuthResult = {
  user: { id: string; nickname: string };
  accessToken: string;
};
type ServerCatalogItem = {
  id: string;
  slug: string;
  name: string;
  iconUrl: string;
  build: {
    id: string;
    name: string;
    minecraftVersion: string;
    loader: "fabric";
    loaderVersion: string;
    modCount: number;
  };
  maintenance: boolean;
  status: "unknown" | "online" | "offline";
  onlinePlayers: number | null;
  maxPlayers: number | null;
};
type IpcResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        message: string;
        fields?: Partial<Record<"nickname" | "password", string>>;
      };
    };
type RunningGame = { pid: number; serverId: string; nickname: string } | null;
type PlayerSkin = { textureUrl: string; model: "default" | "slim" };
type LaunchSettings = {
  memoryMb: number;
  recommendedMemoryMb: number;
  maxMemoryMb: number;
  fullscreen: boolean;
};
contextBridge.exposeInMainWorld("lapis", {
  auth: {
    register: (input: AuthInput): Promise<IpcResult<AuthResult>> =>
      ipcRenderer.invoke("auth:register", input),
    login: (input: AuthInput): Promise<IpcResult<AuthResult>> =>
      ipcRenderer.invoke("auth:login", input),
    restore: (): Promise<IpcResult<AuthResult | null>> =>
      ipcRenderer.invoke("auth:restore"),
    logout: (): Promise<IpcResult<null>> => ipcRenderer.invoke("auth:logout"),
  },
  catalog: {
    list: (): Promise<IpcResult<ServerCatalogItem[]>> =>
      ipcRenderer.invoke("catalog:list"),
  },
  profile: {
    skin: (accessToken: string): Promise<IpcResult<PlayerSkin>> =>
      ipcRenderer.invoke("profile:skin", accessToken),
    uploadSkin: (accessToken: string): Promise<IpcResult<PlayerSkin | null>> =>
      ipcRenderer.invoke("profile:upload-skin", accessToken),
  },
  updates: {
    status: (): Promise<IpcResult<AppUpdateStatus>> =>
      ipcRenderer.invoke("updates:status"),
    check: (): Promise<IpcResult<AppUpdateStatus>> =>
      ipcRenderer.invoke("updates:check"),
    download: (): Promise<IpcResult<AppUpdateStatus>> =>
      ipcRenderer.invoke("updates:download"),
    install: (): Promise<IpcResult<null>> =>
      ipcRenderer.invoke("updates:install"),
    onStatus: (callback: (status: AppUpdateStatus) => void): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        status: AppUpdateStatus,
      ): void => callback(status);
      ipcRenderer.on("updates:status", listener);
      return () => ipcRenderer.removeListener("updates:status", listener);
    },
  },
  runtime: {
    javaStatus: (): Promise<IpcResult<{ major: number; installed: boolean }>> =>
      ipcRenderer.invoke("runtime:java-status"),
    ensureJava: (): Promise<IpcResult<{ major: number; installed: boolean }>> =>
      ipcRenderer.invoke("runtime:ensure-java"),
    ensureGame: (
      serverId: string,
    ): Promise<
      IpcResult<{
        instanceId: string;
        minecraftVersion: string;
        fabricVersion: string;
        installed: boolean;
      }>
    > => ipcRenderer.invoke("runtime:ensure-game", serverId),
    buildStatus: (
      serverId: string,
    ): Promise<IpcResult<"missing" | "update" | "ready">> =>
      ipcRenderer.invoke("runtime:build-status", serverId),
    launchSettings: (serverId: string): Promise<IpcResult<LaunchSettings>> =>
      ipcRenderer.invoke("runtime:launch-settings", serverId),
    saveLaunchSettings: (
      serverId: string,
      settings: Pick<LaunchSettings, "memoryMb" | "fullscreen">,
    ): Promise<IpcResult<LaunchSettings>> =>
      ipcRenderer.invoke("runtime:save-launch-settings", serverId, settings),
    removeGame: (serverId: string): Promise<IpcResult<null>> =>
      ipcRenderer.invoke("runtime:remove-game", serverId),
    openGameDirectory: (serverId: string): Promise<IpcResult<null>> =>
      ipcRenderer.invoke("runtime:open-game-directory", serverId),
    gameStatus: (): Promise<IpcResult<RunningGame>> =>
      ipcRenderer.invoke("runtime:game-status"),
    stopGame: (): Promise<IpcResult<null>> =>
      ipcRenderer.invoke("runtime:stop-game"),
    launchGame: (
      serverId: string,
      nickname: string,
      accessToken: string,
    ): Promise<IpcResult<Exclude<RunningGame, null>>> =>
      ipcRenderer.invoke(
        "runtime:launch-game",
        serverId,
        nickname,
        accessToken,
      ),
    onGameExit: (callback: () => void): (() => void) => {
      const listener = (): void => callback();
      ipcRenderer.on("runtime:game-exited", listener);
      return () => ipcRenderer.removeListener("runtime:game-exited", listener);
    },
    onInstallProgress: (
      callback: (progress: { serverId: string; progress: number }) => void,
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        progress: { serverId: string; progress: number },
      ): void => callback(progress);
      ipcRenderer.on("runtime:install-progress", listener);
      return () =>
        ipcRenderer.removeListener("runtime:install-progress", listener);
    },
  },
});

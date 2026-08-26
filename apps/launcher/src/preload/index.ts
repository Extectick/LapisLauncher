import { contextBridge, ipcRenderer } from "electron";
import type { AppUpdateStatus } from "../shared/update-types";
import type {
  AdminClientMod,
  AdminClientModDeleteInput,
  AdminClientModDeleteResult,
  AdminServer,
  AdminServerCreateInput,
  AdminServerUpdateInput,
  CurrentUser,
} from "@lapis/contracts";

type AuthInput = { nickname: string; password: string };
type AuthResult = CurrentUser;
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
type ServerMod = { fileName: string; required: boolean };
type ServerPlayer = { nickname: string; skin: PlayerSkin };
type InstallProgress = {
  serverId: string;
  progress: number;
  phase:
    | "preparing"
    | "java"
    | "minecraft"
    | "libraries"
    | "assets"
    | "fabric"
    | "mods"
    | "complete";
  completed?: number;
  total?: number;
  fileName?: string;
};
type LaunchSettings = {
  memoryMb: number;
  recommendedMemoryMb: number;
  maxMemoryMb: number;
  fullscreen: boolean;
};
type CustomClientMod = {
  id: string;
  fileName: string;
  name: string;
  version: string | null;
  size: number;
  sha1: string;
  enabled: boolean;
  addedAt: string;
};
type AddCustomClientModsResult = {
  added: CustomClientMod[];
  rejected: Array<{ fileName: string; message: string }>;
};
contextBridge.exposeInMainWorld("lapis", {
  auth: {
    register: (input: AuthInput): Promise<IpcResult<AuthResult>> =>
      ipcRenderer.invoke("auth:register", input),
    login: (input: AuthInput): Promise<IpcResult<AuthResult>> =>
      ipcRenderer.invoke("auth:login", input),
    restore: (): Promise<IpcResult<AuthResult | null>> =>
      ipcRenderer.invoke("auth:restore"),
    me: (): Promise<IpcResult<AuthResult>> => ipcRenderer.invoke("auth:me"),
    logout: (): Promise<IpcResult<null>> => ipcRenderer.invoke("auth:logout"),
  },
  catalog: {
    list: (): Promise<IpcResult<ServerCatalogItem[]>> =>
      ipcRenderer.invoke("catalog:list"),
    mods: (serverId: string): Promise<IpcResult<ServerMod[]>> =>
      ipcRenderer.invoke("catalog:mods", serverId),
    players: (serverId: string): Promise<IpcResult<ServerPlayer[]>> =>
      ipcRenderer.invoke("catalog:players", serverId),
  },
  profile: {
    skin: (): Promise<IpcResult<PlayerSkin>> =>
      ipcRenderer.invoke("profile:skin"),
    uploadSkin: (): Promise<IpcResult<PlayerSkin | null>> =>
      ipcRenderer.invoke("profile:upload-skin"),
  },
  admin: {
    servers: (): Promise<IpcResult<AdminServer[]>> =>
      ipcRenderer.invoke("admin:servers"),
    createServer: (
      input: AdminServerCreateInput,
    ): Promise<IpcResult<AdminServer>> =>
      ipcRenderer.invoke("admin:create-server", input),
    updateServer: (
      serverId: string,
      input: AdminServerUpdateInput,
    ): Promise<IpcResult<AdminServer>> =>
      ipcRenderer.invoke("admin:update-server", serverId, input),
    clientMods: (serverId: string): Promise<IpcResult<AdminClientMod[]>> =>
      ipcRenderer.invoke("admin:client-mods", serverId),
    toggleClientMod: (
      serverId: string,
      modId: string,
      enabled: boolean,
    ): Promise<IpcResult<AdminClientMod>> =>
      ipcRenderer.invoke("admin:toggle-client-mod", serverId, modId, enabled),
    uploadClientMod: (
      serverId: string,
    ): Promise<IpcResult<AdminClientMod | null>> =>
      ipcRenderer.invoke("admin:upload-client-mod", serverId),
    deleteClientMods: (
      serverId: string,
      input: AdminClientModDeleteInput,
    ): Promise<IpcResult<AdminClientModDeleteResult>> =>
      ipcRenderer.invoke("admin:delete-client-mods", serverId, input),
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
    customMods: (buildId: string): Promise<IpcResult<CustomClientMod[]>> =>
      ipcRenderer.invoke("runtime:custom-mods", buildId),
    addCustomMod: (
      serverId: string,
    ): Promise<IpcResult<AddCustomClientModsResult>> =>
      ipcRenderer.invoke("runtime:add-custom-mod", serverId),
    toggleCustomMod: (
      serverId: string,
      modId: string,
      enabled: boolean,
    ): Promise<IpcResult<CustomClientMod>> =>
      ipcRenderer.invoke("runtime:toggle-custom-mod", serverId, modId, enabled),
    deleteCustomMods: (
      serverId: string,
      ids: string[],
    ): Promise<IpcResult<string[]>> =>
      ipcRenderer.invoke("runtime:delete-custom-mods", serverId, ids),
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
    ): Promise<IpcResult<Exclude<RunningGame, null>>> =>
      ipcRenderer.invoke("runtime:launch-game", serverId),
    onGameExit: (callback: () => void): (() => void) => {
      const listener = (): void => callback();
      ipcRenderer.on("runtime:game-exited", listener);
      return () => ipcRenderer.removeListener("runtime:game-exited", listener);
    },
    onInstallProgress: (
      callback: (progress: InstallProgress) => void,
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        progress: InstallProgress,
      ): void => callback(progress);
      ipcRenderer.on("runtime:install-progress", listener);
      return () =>
        ipcRenderer.removeListener("runtime:install-progress", listener);
    },
  },
});

/// <reference types="vite/client" />

import type { AppUpdateStatus } from "../../shared/update-types";
import type {
  AdminClientMod,
  AdminClientModDeleteInput,
  AdminClientModDeleteResult,
  AdminServer,
  AdminServerCreateInput,
  AdminServerUpdateInput,
  CurrentUser,
} from "@lapis/contracts";

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
type LaunchSettings = {
  memoryMb: number;
  recommendedMemoryMb: number;
  maxMemoryMb: number;
  fullscreen: boolean;
};
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
type RefreshCustomClientModsResult = AddCustomClientModsResult & {
  mods: CustomClientMod[];
};
declare global {
  interface Window {
    lapis: {
      auth: {
        register(input: {
          nickname: string;
          password: string;
        }): Promise<IpcResult<AuthResult>>;
        login(input: {
          nickname: string;
          password: string;
        }): Promise<IpcResult<AuthResult>>;
        restore(): Promise<IpcResult<AuthResult | null>>;
        me(): Promise<IpcResult<AuthResult>>;
        logout(): Promise<IpcResult<null>>;
      };
      catalog: {
        list(): Promise<IpcResult<ServerCatalogItem[]>>;
        mods(serverId: string): Promise<IpcResult<ServerMod[]>>;
        players(serverId: string): Promise<IpcResult<ServerPlayer[]>>;
      };
      profile: {
        skin(): Promise<IpcResult<PlayerSkin>>;
        uploadSkin(): Promise<IpcResult<PlayerSkin | null>>;
      };
      admin: {
        servers(): Promise<IpcResult<AdminServer[]>>;
        createServer(
          input: AdminServerCreateInput,
        ): Promise<IpcResult<AdminServer>>;
        updateServer(
          serverId: string,
          input: AdminServerUpdateInput,
        ): Promise<IpcResult<AdminServer>>;
        clientMods(serverId: string): Promise<IpcResult<AdminClientMod[]>>;
        toggleClientMod(
          serverId: string,
          modId: string,
          enabled: boolean,
        ): Promise<IpcResult<AdminClientMod>>;
        uploadClientMod(
          serverId: string,
        ): Promise<IpcResult<AdminClientMod | null>>;
        deleteClientMods(
          serverId: string,
          input: AdminClientModDeleteInput,
        ): Promise<IpcResult<AdminClientModDeleteResult>>;
      };
      updates: {
        status(): Promise<IpcResult<AppUpdateStatus>>;
        check(): Promise<IpcResult<AppUpdateStatus>>;
        download(): Promise<IpcResult<AppUpdateStatus>>;
        install(): Promise<IpcResult<null>>;
        onStatus(callback: (status: AppUpdateStatus) => void): () => void;
      };
      runtime: {
        customMods(buildId: string): Promise<IpcResult<CustomClientMod[]>>;
        watchCustomMods(
          serverId: string,
        ): Promise<IpcResult<RefreshCustomClientModsResult>>;
        unwatchCustomMods(): Promise<IpcResult<null>>;
        openCustomModsFolder(serverId: string): Promise<IpcResult<null>>;
        onCustomModsChanged(
          callback: (
            serverId: string,
            result: IpcResult<RefreshCustomClientModsResult>,
          ) => void,
        ): () => void;
        addCustomMod(
          serverId: string,
        ): Promise<IpcResult<AddCustomClientModsResult>>;
        toggleCustomMod(
          serverId: string,
          modId: string,
          enabled: boolean,
        ): Promise<IpcResult<CustomClientMod>>;
        deleteCustomMods(
          serverId: string,
          ids: string[],
        ): Promise<IpcResult<string[]>>;
        javaStatus(): Promise<IpcResult<{ major: number; installed: boolean }>>;
        ensureJava(): Promise<IpcResult<{ major: number; installed: boolean }>>;
        ensureGame(serverId: string): Promise<
          IpcResult<{
            instanceId: string;
            minecraftVersion: string;
            fabricVersion: string;
            installed: boolean;
          }>
        >;
        buildStatus(
          serverId: string,
        ): Promise<IpcResult<"missing" | "update" | "ready">>;
        launchSettings(serverId: string): Promise<IpcResult<LaunchSettings>>;
        saveLaunchSettings(
          serverId: string,
          settings: Pick<LaunchSettings, "memoryMb" | "fullscreen">,
        ): Promise<IpcResult<LaunchSettings>>;
        removeGame(serverId: string): Promise<IpcResult<null>>;
        openGameDirectory(serverId: string): Promise<IpcResult<null>>;
        gameStatus(): Promise<IpcResult<RunningGame>>;
        stopGame(): Promise<IpcResult<null>>;
        launchGame(
          serverId: string,
        ): Promise<IpcResult<Exclude<RunningGame, null>>>;
        onGameExit(callback: () => void): () => void;
        onInstallProgress(
          callback: (progress: InstallProgress) => void,
        ): () => void;
      };
    };
  }
}
export {};

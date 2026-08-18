/// <reference types="vite/client" />

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
type LaunchSettings = {
  memoryMb: number;
  recommendedMemoryMb: number;
  maxMemoryMb: number;
  fullscreen: boolean;
};
type AppUpdateStatus = {
  currentVersion: string;
  phase:
    | "disabled"
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "downloaded"
    | "not-available"
    | "error";
  version?: string;
  progress?: number;
};
type PlayerSkin = { textureUrl: string; model: "default" | "slim" };
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
        logout(): Promise<IpcResult<null>>;
      };
      catalog: { list(): Promise<IpcResult<ServerCatalogItem[]>> };
      profile: {
        skin(accessToken: string): Promise<IpcResult<PlayerSkin>>;
        uploadSkin(accessToken: string): Promise<IpcResult<PlayerSkin | null>>;
      };
      updates: {
        status(): Promise<IpcResult<AppUpdateStatus>>;
        check(): Promise<IpcResult<AppUpdateStatus>>;
        download(): Promise<IpcResult<AppUpdateStatus>>;
        install(): Promise<IpcResult<null>>;
        onStatus(callback: (status: AppUpdateStatus) => void): () => void;
      };
      runtime: {
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
          nickname: string,
          accessToken: string,
        ): Promise<IpcResult<Exclude<RunningGame, null>>>;
        onGameExit(callback: () => void): () => void;
        onInstallProgress(
          callback: (progress: { serverId: string; progress: number }) => void,
        ): () => void;
      };
    };
  }
}
export {};

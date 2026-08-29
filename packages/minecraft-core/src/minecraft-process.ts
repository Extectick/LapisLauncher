import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";

/**
 * Minecraft writes its own persistent logs under the instance `logs` directory.
 * Keeping the child stdout/stderr as unread pipes can therefore only hurt us:
 * once a mod floods the console, the OS pipe fills and blocks Minecraft's main
 * render thread inside System.out. Discard the duplicate console streams while
 * retaining process lifecycle events and Minecraft's normal log files.
 */
export function minecraftSpawnOptions(
  cwd: string,
  env: NodeJS.ProcessEnv,
): SpawnOptions {
  return {
    cwd,
    env,
    windowsHide: false,
    stdio: "ignore",
  };
}

export function spawnMinecraftProcess(
  executable: string,
  args?: readonly string[],
  options?: SpawnOptions,
): ChildProcess {
  return options
    ? spawn(executable, args ?? [], options)
    : spawn(executable, args ?? []);
}

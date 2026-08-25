export const MINECRAFT_SHUTDOWN_GRACE_MS = 15_000;

const MINECRAFT_START_MARKER = /\[main\/INFO\]: Loading Minecraft /g;
const MINECRAFT_STOP_MARKER = /\[Render thread\/INFO\]: Stopping!/g;

function lastMatchIndex(value: string, pattern: RegExp): number {
  let lastIndex = -1;
  for (const match of value.matchAll(pattern)) lastIndex = match.index;
  return lastIndex;
}

/**
 * A log can contain multiple launches when a logging backend appends instead of
 * truncating. Treat the game as stopping only when the newest lifecycle marker
 * is Stopping!, never because an older run left that line in the tail.
 */
export function minecraftLogShowsStopping(logTail: string): boolean {
  const stoppingAt = lastMatchIndex(logTail, MINECRAFT_STOP_MARKER);
  if (stoppingAt < 0) return false;
  return stoppingAt > lastMatchIndex(logTail, MINECRAFT_START_MARKER);
}

type ShutdownCallback = (pid: number) => void;

/**
 * Owns at most one fallback timer for the tracked Minecraft process. Normal
 * child-process exit remains the primary path; this only handles JVMs that
 * keep running after Minecraft has logged its final shutdown marker.
 */
export class MinecraftShutdownFallback {
  private timer: NodeJS.Timeout | null = null;
  private pid: number | null = null;

  schedule(
    pid: number,
    callback: ShutdownCallback,
    delayMs = MINECRAFT_SHUTDOWN_GRACE_MS,
  ): boolean {
    if (this.timer && this.pid === pid) return false;
    this.cancel();
    this.pid = pid;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pid = null;
      callback(pid);
    }, delayMs);
    this.timer.unref();
    return true;
  }

  isPendingFor(pid: number): boolean {
    return this.timer !== null && this.pid === pid;
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pid = null;
  }
}

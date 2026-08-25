import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MINECRAFT_SHUTDOWN_GRACE_MS,
  MinecraftShutdownFallback,
  minecraftLogShowsStopping,
} from "./game-process-lifecycle";

afterEach(() => vi.useRealTimers());

describe("Minecraft process lifecycle", () => {
  it("detects a shutdown marker even when final cleanup logs follow it", () => {
    expect(
      minecraftLogShowsStopping(`
[14:25:06] [main/INFO]: Loading Minecraft 26.2 with Fabric Loader 0.19.3
[14:41:27] [Render thread/INFO]: Stopping!
[14:41:27] [Worker-Main-21/INFO]: final cleanup
`),
    ).toBe(true);
  });

  it("does not reuse the shutdown marker from an older launch", () => {
    expect(
      minecraftLogShowsStopping(`
[14:41:27] [Render thread/INFO]: Stopping!
[14:43:01] [main/INFO]: Loading Minecraft 26.2 with Fabric Loader 0.19.3
`),
    ).toBe(false);
  });

  it("schedules one fallback per process and cancels it on normal exit", () => {
    vi.useFakeTimers();
    const fallback = new MinecraftShutdownFallback();
    const terminate = vi.fn();

    expect(fallback.schedule(100, terminate)).toBe(true);
    expect(fallback.isPendingFor(100)).toBe(true);
    expect(fallback.schedule(100, terminate)).toBe(false);
    vi.advanceTimersByTime(MINECRAFT_SHUTDOWN_GRACE_MS - 1);
    expect(terminate).not.toHaveBeenCalled();

    fallback.cancel();
    expect(fallback.isPendingFor(100)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(terminate).not.toHaveBeenCalled();
  });

  it("forces the same tracked process after the grace period", () => {
    vi.useFakeTimers();
    const fallback = new MinecraftShutdownFallback();
    const terminate = vi.fn();

    fallback.schedule(14880, terminate);
    vi.advanceTimersByTime(MINECRAFT_SHUTDOWN_GRACE_MS);

    expect(fallback.isPendingFor(14880)).toBe(false);
    expect(terminate).toHaveBeenCalledOnce();
    expect(terminate).toHaveBeenCalledWith(14880);
  });
});

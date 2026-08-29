import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  minecraftSpawnOptions,
  spawnMinecraftProcess,
} from "./minecraft-process";

function waitForExit(process: ReturnType<typeof spawnMinecraftProcess>) {
  return new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      process.kill();
      reject(new Error("Child process output blocked its exit."));
    }, 10_000);
    process.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    process.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

describe("Minecraft child process output", () => {
  it("does not create unread stdout or stderr pipes", () => {
    expect(minecraftSpawnOptions(tmpdir(), process.env).stdio).toBe("ignore");
  });

  it("does not block when Minecraft-compatible output is very large", async () => {
    const child = spawnMinecraftProcess(
      process.execPath,
      [
        "-e",
        "for(let i=0;i<4096;i++){process.stdout.write('x'.repeat(4096));process.stderr.write('y'.repeat(4096))}",
      ],
      minecraftSpawnOptions(tmpdir(), process.env),
    );

    await expect(waitForExit(child)).resolves.toBe(0);
  });
});

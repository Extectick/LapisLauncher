import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyGraphicsCompatibilitySettingsAt,
  setMinecraftOption,
} from "./graphics-compatibility";

const temporaryDirectories: string[] = [];

async function temporaryInstance(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "lapis-graphics-compat-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Minecraft graphics compatibility", () => {
  it("updates OpenGL verbosity without changing other options", () => {
    expect(
      setMinecraftOption(
        "renderDistance:12\r\nglDebugVerbosity:1\r\nfullscreen:false\r\n",
        "glDebugVerbosity",
        "0",
      ),
    ).toBe("renderDistance:12\r\nglDebugVerbosity:0\r\nfullscreen:false\r\n");
  });

  it("creates a safe option on a fresh instance", async () => {
    const instance = await temporaryInstance();

    expect(await applyGraphicsCompatibilitySettingsAt(instance)).toBe(true);
    expect(await readFile(join(instance, "options.txt"), "utf8")).toBe(
      "glDebugVerbosity:0\n",
    );
  });

  it("is idempotent", async () => {
    const instance = await temporaryInstance();
    await writeFile(
      join(instance, "options.txt"),
      "renderDistance:12\nglDebugVerbosity:0\n",
      "utf8",
    );

    expect(await applyGraphicsCompatibilitySettingsAt(instance)).toBe(false);
  });
});

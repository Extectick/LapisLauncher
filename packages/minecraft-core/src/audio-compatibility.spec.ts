import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyAudioCompatibilitySettingsAt,
  setJavaProperty,
} from "./audio-compatibility";

const temporaryDirectories: string[] = [];

async function temporaryInstance(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "lapis-audio-compat-"));
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

describe("Minecraft audio compatibility", () => {
  it("updates one property without changing the rest of the file", () => {
    expect(
      setJavaProperty(
        "enabled=true\r\nsimple_voice_chat_integration=true\r\nreverb_gain=1.0\r\n",
        "simple_voice_chat_integration",
        "false",
      ),
    ).toBe(
      "enabled=true\r\nsimple_voice_chat_integration=false\r\nreverb_gain=1.0\r\n",
    );
  });

  it("isolates voice chat from Sound Physics when both mods are installed", async () => {
    const instance = await temporaryInstance();
    await mkdir(join(instance, "mods"), { recursive: true });
    await writeFile(
      join(instance, "mods", "sound-physics-remastered-fabric-1.5.1+26.2.jar"),
      "",
    );
    await writeFile(
      join(instance, "mods", "voicechat-fabric-2.6.22+26.2.jar"),
      "",
    );

    expect(await applyAudioCompatibilitySettingsAt(instance)).toBe(true);
    expect(
      await readFile(
        join(
          instance,
          "config",
          "sound_physics_remastered",
          "soundphysics.properties",
        ),
        "utf8",
      ),
    ).toBe("simple_voice_chat_integration=false\n");
    expect(await applyAudioCompatibilitySettingsAt(instance)).toBe(false);
  });

  it("does not create a config when the conflicting pair is absent", async () => {
    const instance = await temporaryInstance();
    await mkdir(join(instance, "mods"), { recursive: true });
    await writeFile(
      join(instance, "mods", "voicechat-fabric-2.6.22+26.2.jar"),
      "",
    );

    expect(await applyAudioCompatibilitySettingsAt(instance)).toBe(false);
  });
});

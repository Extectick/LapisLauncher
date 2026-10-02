import AdmZip from "adm-zip";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectNeoForgeMod } from "./neoforge-mod-metadata";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function jarWith(entries: Record<string, string>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "lapis-neoforge-metadata-"));
  directories.push(directory);
  const path = join(directory, "mod.jar");
  const archive = new AdmZip();
  for (const [name, content] of Object.entries(entries))
    archive.addFile(name, Buffer.from(content));
  archive.writeZip(path);
  return path;
}

describe("NeoForge mod metadata", () => {
  it("recognizes a NeoForge JAR without claiming untested dependency compatibility", async () => {
    const path = await jarWith({
      "META-INF/neoforge.mods.toml": 'modLoader="javafml"\n[[mods]]\nmodId="lapisbridge"\nversion="0.1.0"\n',
    });
    expect(inspectNeoForgeMod(path)).toMatchObject({
      status: "unknown",
      modId: "lapisbridge",
      modVersion: "0.1.0",
    });
  });

  it("rejects a JAR without a NeoForge manifest", async () => {
    const path = await jarWith({ "fabric.mod.json": '{"id":"fabric-only"}' });
    expect(inspectNeoForgeMod(path).status).toBe("incompatible");
  });
});

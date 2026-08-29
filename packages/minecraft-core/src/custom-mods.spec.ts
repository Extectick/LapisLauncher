import AdmZip from "adm-zip";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addCustomClientModAt,
  addCustomClientModsAt,
  deleteCustomClientModsAt,
  readCustomClientMods,
  refreshCustomClientModsAt,
  setCustomClientModEnabledAt,
} from "./custom-mods";
import { managedModsMatch } from "./managed-mods";

describe("local custom client mods", () => {
  let directory = "";
  let instance = "";
  let source = "";

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "lapis-custom-mods-"));
    instance = join(directory, "instance");
    source = join(directory, "example mod.jar");
    await mkdir(join(instance, "mods"), { recursive: true });
    await writeFile(join(instance, "mods", "official.jar"), "official");
    const archive = new AdmZip();
    archive.addFile(
      "fabric.mod.json",
      Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          id: "local_example",
          name: "Local Example",
          version: "1.2.3",
          environment: "client",
        }),
      ),
    );
    archive.writeZip(source);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("stores new mods disabled and preserves them across managed sync", async () => {
    const added = await addCustomClientModAt(instance, source, [
      "official.jar",
    ]);
    expect(added).toMatchObject({
      name: "Local Example",
      version: "1.2.3",
      enabled: false,
    });
    await expect(
      access(join(instance, "mods", added.fileName)),
    ).rejects.toThrow();

    const enabled = await setCustomClientModEnabledAt(
      instance,
      added.id,
      true,
      ["official.jar"],
    );
    expect(enabled.enabled).toBe(true);
    await expect(
      readFile(join(instance, "mods", added.fileName)),
    ).resolves.toEqual(await readFile(source));
    await expect(
      managedModsMatch(
        join(instance, "mods"),
        ["official.jar"],
        [added.fileName],
      ),
    ).resolves.toBe(true);

    await setCustomClientModEnabledAt(instance, added.id, false, [
      "official.jar",
    ]);
    await expect(
      access(join(instance, "mods", added.fileName)),
    ).rejects.toThrow();
    await expect(
      access(join(instance, "custom-mods", `${added.id}.jar`)),
    ).resolves.toBeUndefined();

    await expect(
      deleteCustomClientModsAt(instance, [added.id], ["official.jar"]),
    ).resolves.toEqual([added.id]);
    await expect(readCustomClientMods(instance)).resolves.toEqual([]);
    await expect(
      access(join(instance, "custom-mods", `${added.id}.jar`)),
    ).rejects.toThrow();
  });

  it("rejects duplicate and non-Fabric files", async () => {
    await addCustomClientModAt(instance, source, ["official.jar"]);
    await expect(
      addCustomClientModAt(instance, source, ["official.jar"]),
    ).rejects.toThrow("уже добавлен");

    const invalid = join(directory, "invalid.jar");
    await writeFile(invalid, "not a zip");
    await expect(
      addCustomClientModAt(instance, invalid, ["official.jar"]),
    ).rejects.toThrow("Fabric-мод");
  });

  it("adds multiple selected mods and reports rejected files", async () => {
    const secondSource = join(directory, "second.jar");
    const secondArchive = new AdmZip();
    secondArchive.addFile(
      "fabric.mod.json",
      Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          id: "local_second",
          name: "Local Second",
          version: "2.0.0",
          environment: "client",
        }),
      ),
    );
    secondArchive.writeZip(secondSource);
    const invalid = join(directory, "invalid.jar");
    await writeFile(invalid, "not a zip");

    const result = await addCustomClientModsAt(
      instance,
      [source, invalid, secondSource],
      ["official.jar"],
    );

    expect(result.added.map((mod) => mod.name)).toEqual([
      "Local Example",
      "Local Second",
    ]);
    expect(result.added.every((mod) => !mod.enabled)).toBe(true);
    expect(result.rejected).toEqual([
      {
        fileName: "invalid.jar",
        message: "Выберите корректный клиентский Fabric-мод.",
      },
    ]);
    await expect(readCustomClientMods(instance)).resolves.toHaveLength(2);
  });

  it("discovers mods copied into the public custom mods directory", async () => {
    const customDirectory = join(instance, "custom-mods");
    await mkdir(customDirectory, { recursive: true });
    const dropped = join(customDirectory, "example mod.jar");
    await writeFile(dropped, await readFile(source));

    const refreshed = await refreshCustomClientModsAt(instance, [
      "official.jar",
    ]);

    expect(refreshed.added).toHaveLength(1);
    expect(refreshed.mods).toMatchObject([
      { name: "Local Example", enabled: false },
    ]);
    await expect(access(dropped)).rejects.toThrow();
    await expect(
      access(join(customDirectory, `${refreshed.mods[0]!.id}.jar`)),
    ).resolves.toBeUndefined();

    await rm(join(customDirectory, `${refreshed.mods[0]!.id}.jar`));
    await expect(
      refreshCustomClientModsAt(instance, ["official.jar"]),
    ).resolves.toMatchObject({ mods: [] });
  });

  it("migrates the previous hidden custom mod storage without losing state", async () => {
    const added = await addCustomClientModAt(instance, source, [
      "official.jar",
    ]);
    const publicFile = join(instance, "custom-mods", `${added.id}.jar`);
    const legacyDirectory = join(instance, ".lapis-custom-mods");
    await mkdir(legacyDirectory, { recursive: true });
    await rename(publicFile, join(legacyDirectory, `${added.id}.jar`));

    await expect(readCustomClientMods(instance)).resolves.toMatchObject([
      { id: added.id, name: "Local Example" },
    ]);
    await expect(access(publicFile)).resolves.toBeUndefined();
  });
});

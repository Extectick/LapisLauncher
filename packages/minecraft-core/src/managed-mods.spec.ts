import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { managedModsMatch, reconcileManagedMods } from "./managed-mods";

describe("managed client mods", () => {
  let directory: string | null = null;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = null;
  });

  it("keeps exactly the client jars selected for the build", async () => {
    directory = await mkdtemp(join(tmpdir(), "lapis-managed-mods-"));
    await Promise.all([
      writeFile(join(directory, "enabled.jar"), "enabled"),
      writeFile(join(directory, "disabled.jar"), "disabled"),
      writeFile(join(directory, "user-added.jar"), "user"),
      writeFile(join(directory, "options.txt"), "preserve"),
    ]);
    await reconcileManagedMods(directory, ["enabled.jar", "disabled.jar"]);
    await reconcileManagedMods(directory, ["enabled.jar"]);

    await expect(readFile(join(directory, "disabled.jar"))).rejects.toThrow();
    await expect(readFile(join(directory, "user-added.jar"))).rejects.toThrow();
    await expect(
      readFile(join(directory, "options.txt"), "utf8"),
    ).resolves.toBe("preserve");
    await expect(managedModsMatch(directory, ["enabled.jar"])).resolves.toBe(
      true,
    );
  });

  it("marks a build for update when an extra jar appears", async () => {
    directory = await mkdtemp(join(tmpdir(), "lapis-managed-mods-"));
    await writeFile(join(directory, "enabled.jar"), "enabled");
    await reconcileManagedMods(directory, ["enabled.jar"]);
    await writeFile(join(directory, "local-extra.jar"), "extra");

    await expect(managedModsMatch(directory, ["enabled.jar"])).resolves.toBe(
      false,
    );
  });
});

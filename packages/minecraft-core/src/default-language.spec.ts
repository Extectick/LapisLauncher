import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyDefaultLanguageAt } from "./default-language";

const temporaryDirectories: string[] = [];

async function temporaryInstance(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "lapis-language-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Minecraft default language", () => {
  it("sets Russian for a fresh instance", async () => {
    const instance = await temporaryInstance();
    expect(await applyDefaultLanguageAt(instance)).toBe(true);
    expect(await readFile(join(instance, "options.txt"), "utf8")).toBe(
      "lang:ru_ru\n",
    );
  });

  it("migrates an English instance once and preserves later player changes", async () => {
    const instance = await temporaryInstance();
    await writeFile(join(instance, "options.txt"), "lang:en_us\nrenderDistance:12\n");
    expect(await applyDefaultLanguageAt(instance)).toBe(true);
    expect(await readFile(join(instance, "options.txt"), "utf8")).toBe(
      "lang:ru_ru\nrenderDistance:12\n",
    );
    await writeFile(join(instance, "options.txt"), "lang:fr_fr\nrenderDistance:12\n");
    expect(await applyDefaultLanguageAt(instance)).toBe(false);
    expect(await readFile(join(instance, "options.txt"), "utf8")).toBe(
      "lang:fr_fr\nrenderDistance:12\n",
    );
  });

  it("preserves an existing non-English language", async () => {
    const instance = await temporaryInstance();
    await writeFile(join(instance, "options.txt"), "lang:de_de\n");
    expect(await applyDefaultLanguageAt(instance)).toBe(false);
    expect(await readFile(join(instance, "options.txt"), "utf8")).toBe(
      "lang:de_de\n",
    );
  });
});

import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setMinecraftOption } from "./graphics-compatibility";

const DEFAULT_LANGUAGE_MARKER = ".lapis-default-language-v1";

/**
 * Set Russian once per managed instance. Existing non-English choices and any
 * language change made after this migration remain under the player's control.
 */
export async function applyDefaultLanguageAt(
  instanceDirectory: string,
): Promise<boolean> {
  const markerPath = join(instanceDirectory, DEFAULT_LANGUAGE_MARKER);
  try {
    await readFile(markerPath);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const optionsPath = join(instanceDirectory, "options.txt");
  let current = "";
  try {
    current = await readFile(optionsPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const currentLanguage = /^lang:(.*)$/m.exec(current)?.[1]?.trim();
  const shouldSetRussian =
    !currentLanguage || currentLanguage.toLowerCase() === "en_us";
  if (shouldSetRussian) {
    const next = setMinecraftOption(current, "lang", "ru_ru");
    if (next !== current) {
      const temporaryPath = `${optionsPath}.lapis-language.tmp`;
      await writeFile(temporaryPath, next, "utf8");
      await rename(temporaryPath, optionsPath);
    }
  }
  await writeFile(markerPath, "ru_ru\n", { flag: "wx" });
  return shouldSetRussian;
}

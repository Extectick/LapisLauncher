import { readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const MANAGED_MODS_FILE = ".lapis-managed-mods.json";
const MOD_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,179}\.jar$/i;

async function readManagedFiles(modsDirectory: string): Promise<string[]> {
  return readFile(join(modsDirectory, MANAGED_MODS_FILE), "utf8")
    .then((value) => JSON.parse(value) as unknown)
    .then((value) =>
      typeof value === "object" &&
      value !== null &&
      "files" in value &&
      Array.isArray(value.files)
        ? [
            ...value.files,
            ...(typeof value === "object" &&
            value !== null &&
            "customFiles" in value &&
            Array.isArray(value.customFiles)
              ? value.customFiles
              : []),
          ].filter(
            (fileName): fileName is string =>
              typeof fileName === "string" && MOD_FILE_PATTERN.test(fileName),
          )
        : [],
    )
    .catch(() => [] as string[]);
}

async function listInstalledJars(modsDirectory: string): Promise<string[]> {
  return readdir(modsDirectory, { withFileTypes: true })
    .then((entries) =>
      entries
        .filter((entry) => entry.isFile() && MOD_FILE_PATTERN.test(entry.name))
        .map((entry) => entry.name),
    )
    .catch(() => [] as string[]);
}

function normalizedFiles(files: string[]): string[] {
  return [...new Set(files.map((fileName) => fileName.toLowerCase()))].sort();
}

export async function reconcileManagedMods(
  modsDirectory: string,
  expectedFiles: string[],
  customFiles: string[] = [],
): Promise<void> {
  const next = new Set(
    [...expectedFiles, ...customFiles]
      .filter((fileName) => MOD_FILE_PATTERN.test(fileName))
      .map((fileName) => fileName.toLowerCase()),
  );
  const installed = await listInstalledJars(modsDirectory);
  await Promise.all(
    installed
      .filter((fileName) => !next.has(fileName.toLowerCase()))
      .map((fileName) => rm(join(modsDirectory, fileName), { force: true })),
  );
  const managedPath = join(modsDirectory, MANAGED_MODS_FILE);
  const temporaryPath = `${managedPath}.tmp`;
  await writeFile(
    temporaryPath,
    JSON.stringify({
      version: 3,
      strict: true,
      files: [...expectedFiles].sort(),
      customFiles: [...customFiles].sort(),
    }),
  );
  await rename(temporaryPath, managedPath);
}

export async function managedModsMatch(
  modsDirectory: string,
  expectedFiles: string[],
  customFiles: string[] = [],
): Promise<boolean> {
  const managedFiles = normalizedFiles(await readManagedFiles(modsDirectory));
  const installedFiles = normalizedFiles(
    await listInstalledJars(modsDirectory),
  );
  const expected = normalizedFiles([...expectedFiles, ...customFiles]);
  return (
    managedFiles.length === expected.length &&
    managedFiles.every((fileName, index) => fileName === expected[index]) &&
    installedFiles.length === expected.length &&
    installedFiles.every((fileName, index) => fileName === expected[index])
  );
}

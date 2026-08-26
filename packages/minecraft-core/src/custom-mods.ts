import AdmZip from "adm-zip";
import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { reconcileManagedMods } from "./managed-mods";

const CUSTOM_MODS_DIRECTORY = ".lapis-custom-mods";
const CUSTOM_MODS_FILE = ".lapis-custom-mods.json";
const MAX_CUSTOM_MOD_BYTES = 128 * 1024 * 1024;
const SHA1_PATTERN = /^[a-f0-9]{40}$/;
const INSTALLED_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,179}\.jar$/i;

export type CustomClientMod = {
  id: string;
  fileName: string;
  name: string;
  version: string | null;
  size: number;
  sha1: string;
  enabled: boolean;
  addedAt: string;
};

export type AddCustomClientModsResult = {
  added: CustomClientMod[];
  rejected: Array<{ fileName: string; message: string }>;
};

type CustomModsState = {
  version: 1;
  mods: CustomClientMod[];
};

export class CustomModError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomModError";
  }
}

function statePath(location: string): string {
  return join(location, CUSTOM_MODS_FILE);
}

function storageDirectory(location: string): string {
  return join(location, CUSTOM_MODS_DIRECTORY);
}

function storagePath(location: string, id: string): string {
  if (!SHA1_PATTERN.test(id)) throw new CustomModError("Некорректный мод.");
  return join(storageDirectory(location), `${id}.jar`);
}

function isCustomClientMod(value: unknown): value is CustomClientMod {
  if (typeof value !== "object" || value === null) return false;
  const mod = value as Partial<CustomClientMod>;
  return (
    typeof mod.id === "string" &&
    SHA1_PATTERN.test(mod.id) &&
    typeof mod.sha1 === "string" &&
    mod.sha1 === mod.id &&
    typeof mod.fileName === "string" &&
    INSTALLED_FILE_PATTERN.test(mod.fileName) &&
    typeof mod.name === "string" &&
    mod.name.length > 0 &&
    mod.name.length <= 160 &&
    (mod.version === null || typeof mod.version === "string") &&
    typeof mod.size === "number" &&
    Number.isSafeInteger(mod.size) &&
    mod.size > 0 &&
    mod.size <= MAX_CUSTOM_MOD_BYTES &&
    typeof mod.enabled === "boolean" &&
    typeof mod.addedAt === "string" &&
    !Number.isNaN(Date.parse(mod.addedAt))
  );
}

async function readState(location: string): Promise<CustomModsState> {
  try {
    const parsed = JSON.parse(await readFile(statePath(location), "utf8")) as {
      version?: unknown;
      mods?: unknown;
    };
    if (
      parsed.version !== 1 ||
      !Array.isArray(parsed.mods) ||
      !parsed.mods.every(isCustomClientMod)
    )
      throw new Error("Invalid custom mod state");
    const uniqueIds = new Set(parsed.mods.map((mod) => mod.id));
    const uniqueFiles = new Set(
      parsed.mods.map((mod) => mod.fileName.toLowerCase()),
    );
    if (
      uniqueIds.size !== parsed.mods.length ||
      uniqueFiles.size !== parsed.mods.length
    )
      throw new Error("Duplicate custom mod state");
    return { version: 1, mods: parsed.mods };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return { version: 1, mods: [] };
    throw new CustomModError(
      "Не удалось прочитать локальный список пользовательских модов.",
    );
  }
}

async function writeState(
  location: string,
  state: CustomModsState,
): Promise<void> {
  await mkdir(location, { recursive: true });
  const destination = statePath(location);
  const temporary = `${destination}.tmp`;
  await writeFile(temporary, JSON.stringify(state), "utf8");
  await rename(temporary, destination);
}

async function sha1File(path: string): Promise<string> {
  const hash = createHash("sha1");
  await new Promise<void>((resolve, reject) => {
    const input = createReadStream(path);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("error", reject);
    input.on("end", resolve);
  });
  return hash.digest("hex");
}

function safeInstalledFileName(originalName: string, sha1: string): string {
  const withoutExtension = basename(originalName).replace(/\.jar$/i, "");
  const safeBase = withoutExtension
    .replace(/[^A-Za-z0-9._+-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "")
    .slice(0, 155);
  return `${sha1.slice(0, 12)}-${safeBase || "custom-mod"}.jar`;
}

function stringMetadata(value: unknown, maximum: number): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().slice(0, maximum)
    : null;
}

function inspectFabricMod(path: string): {
  name: string;
  version: string | null;
} {
  try {
    const archive = new AdmZip(path);
    const entry = archive.getEntry("fabric.mod.json");
    if (!entry || entry.header.size > 1024 * 1024)
      throw new CustomModError(
        "Выберите клиентский мод для Fabric в формате JAR.",
      );
    const metadata = JSON.parse(entry.getData().toString("utf8")) as {
      id?: unknown;
      name?: unknown;
      version?: unknown;
      environment?: unknown;
    };
    if (!stringMetadata(metadata.id, 128))
      throw new CustomModError("В моде отсутствует корректный Fabric ID.");
    if (metadata.environment === "server")
      throw new CustomModError("Этот мод предназначен только для сервера.");
    return {
      name:
        stringMetadata(metadata.name, 160) ??
        basename(path).replace(/\.jar$/i, ""),
      version: stringMetadata(metadata.version, 80),
    };
  } catch (error) {
    if (error instanceof CustomModError) throw error;
    throw new CustomModError("Выберите корректный клиентский Fabric-мод.");
  }
}

function officialFileSet(officialFiles: string[]): Set<string> {
  return new Set(officialFiles.map((fileName) => fileName.toLowerCase()));
}

async function fileMatches(
  path: string,
  expectedSha1: string,
): Promise<boolean> {
  try {
    return (await sha1File(path)) === expectedSha1;
  } catch {
    return false;
  }
}

export async function readCustomClientMods(
  location: string,
): Promise<CustomClientMod[]> {
  const state = await readState(location);
  return [...state.mods].sort((left, right) =>
    right.addedAt.localeCompare(left.addedAt),
  );
}

export async function enabledCustomClientMods(
  location: string,
): Promise<CustomClientMod[]> {
  return (await readState(location)).mods.filter((mod) => mod.enabled);
}

export async function synchronizeCustomClientMods(
  location: string,
  officialFiles: string[],
  mods?: CustomClientMod[],
): Promise<void> {
  await Promise.all([
    mkdir(join(location, "mods"), { recursive: true }),
    mkdir(storageDirectory(location), { recursive: true }),
  ]);
  const official = officialFileSet(officialFiles);
  const resolvedMods = mods ?? (await readState(location)).mods;
  const enabled = resolvedMods.filter((mod) => mod.enabled);
  for (const mod of enabled) {
    if (official.has(mod.fileName.toLowerCase()))
      throw new CustomModError(
        `Пользовательский мод «${mod.name}» конфликтует с модом сборки.`,
      );
    const source = storagePath(location, mod.id);
    if (!(await fileMatches(source, mod.sha1)))
      throw new CustomModError(
        `Файл пользовательского мода «${mod.name}» повреждён или удалён.`,
      );
    const destination = join(location, "mods", mod.fileName);
    if (!(await fileMatches(destination, mod.sha1)))
      await copyFile(source, destination);
  }
  await reconcileManagedMods(
    join(location, "mods"),
    officialFiles,
    enabled.map((mod) => mod.fileName),
  );
}

export async function customClientModsMatch(
  location: string,
): Promise<boolean> {
  try {
    const enabled = await enabledCustomClientMods(location);
    return (
      await Promise.all(
        enabled.map(
          async (mod) =>
            (await fileMatches(storagePath(location, mod.id), mod.sha1)) &&
            (await fileMatches(join(location, "mods", mod.fileName), mod.sha1)),
        ),
      )
    ).every(Boolean);
  } catch {
    return false;
  }
}

export async function addCustomClientModAt(
  location: string,
  sourcePath: string,
  officialFiles: string[],
): Promise<CustomClientMod> {
  const info = await stat(sourcePath).catch(() => null);
  if (!info?.isFile()) throw new CustomModError("Файл мода не найден.");
  if (info.size <= 0 || info.size > MAX_CUSTOM_MOD_BYTES)
    throw new CustomModError(
      "Размер пользовательского мода — не более 128 МБ.",
    );
  const metadata = inspectFabricMod(sourcePath);
  const sha1 = await sha1File(sourcePath);
  const state = await readState(location);
  if (state.mods.some((mod) => mod.id === sha1))
    throw new CustomModError("Этот пользовательский мод уже добавлен.");
  const fileName = safeInstalledFileName(sourcePath, sha1);
  if (officialFileSet(officialFiles).has(fileName.toLowerCase()))
    throw new CustomModError("Мод с таким именем уже входит в сборку.");
  const mod: CustomClientMod = {
    id: sha1,
    fileName,
    name: metadata.name,
    version: metadata.version,
    size: info.size,
    sha1,
    enabled: false,
    addedAt: new Date().toISOString(),
  };
  await mkdir(storageDirectory(location), { recursive: true });
  const destination = storagePath(location, sha1);
  const temporary = `${destination}.tmp`;
  await copyFile(sourcePath, temporary);
  try {
    if ((await sha1File(temporary)) !== sha1)
      throw new CustomModError("Не удалось проверить скопированный файл мода.");
    await rename(temporary, destination);
    const next = { version: 1 as const, mods: [mod, ...state.mods] };
    await synchronizeCustomClientMods(location, officialFiles, next.mods);
    await writeState(location, next);
    return mod;
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    await rm(destination, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function addCustomClientModsAt(
  location: string,
  sourcePaths: string[],
  officialFiles: string[],
): Promise<AddCustomClientModsResult> {
  const added: CustomClientMod[] = [];
  const rejected: AddCustomClientModsResult["rejected"] = [];
  for (const sourcePath of sourcePaths) {
    try {
      added.push(
        await addCustomClientModAt(location, sourcePath, officialFiles),
      );
    } catch (error) {
      rejected.push({
        fileName: basename(sourcePath),
        message:
          error instanceof CustomModError
            ? error.message
            : "Не удалось добавить этот мод.",
      });
    }
  }
  return { added, rejected };
}

export async function setCustomClientModEnabledAt(
  location: string,
  id: string,
  enabled: boolean,
  officialFiles: string[],
): Promise<CustomClientMod> {
  if (!SHA1_PATTERN.test(id)) throw new CustomModError("Некорректный мод.");
  const state = await readState(location);
  const current = state.mods.find((mod) => mod.id === id);
  if (!current) throw new CustomModError("Пользовательский мод не найден.");
  const updated = { ...current, enabled };
  const next = {
    version: 1 as const,
    mods: state.mods.map((mod) => (mod.id === id ? updated : mod)),
  };
  await synchronizeCustomClientMods(location, officialFiles, next.mods);
  await writeState(location, next);
  return updated;
}

export async function deleteCustomClientModsAt(
  location: string,
  ids: string[],
  officialFiles: string[],
): Promise<string[]> {
  const requested = new Set(ids);
  if (
    requested.size === 0 ||
    requested.size !== ids.length ||
    [...requested].some((id) => !SHA1_PATTERN.test(id))
  )
    throw new CustomModError("Выберите пользовательские моды для удаления.");
  const state = await readState(location);
  const removed = state.mods.filter((mod) => requested.has(mod.id));
  if (removed.length !== requested.size)
    throw new CustomModError("Один из пользовательских модов уже удалён.");
  const next = {
    version: 1 as const,
    mods: state.mods.filter((mod) => !requested.has(mod.id)),
  };
  await synchronizeCustomClientMods(location, officialFiles, next.mods);
  await writeState(location, next);
  await Promise.all(
    removed.map((mod) => rm(storagePath(location, mod.id), { force: true })),
  );
  return removed.map((mod) => mod.id);
}

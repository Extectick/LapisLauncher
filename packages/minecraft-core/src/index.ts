import AdmZip from "adm-zip";
import { createWriteStream } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { ChildProcess } from "node:child_process";
import { installVersion } from "@xmcl/installer";
import { launch } from "@xmcl/core";
import { Agent, fetch as undiciFetch } from "undici";
import { createHash } from "node:crypto";
import { managedModsMatch, reconcileManagedMods } from "./managed-mods";

const execFileAsync = promisify(execFile);
const JAVA_MAJOR = 25;
const ADOPTIUM_URL = `https://api.adoptium.net/v3/binary/latest/${JAVA_MAJOR}/ga/windows/x64/jre/hotspot/normal/eclipse`;

export type JavaRuntime = { major: number; installed: boolean };
export type MinecraftInstallPhase =
  | "preparing"
  | "java"
  | "minecraft"
  | "libraries"
  | "assets"
  | "fabric"
  | "mods"
  | "complete";
export type MinecraftInstallProgressEvent = {
  progress: number;
  phase: MinecraftInstallPhase;
  completed?: number;
  total?: number;
  fileName?: string;
};
export type MinecraftInstallProgress = (
  event: MinecraftInstallProgressEvent,
) => void;

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

function formatDiskBytes(bytes: bigint): string {
  const gibibytes = Number(bytes) / GIB;
  return `${gibibytes.toFixed(gibibytes >= 10 ? 0 : 1)} ГБ`;
}

async function ensureFreeDiskSpace(
  directory: string,
  required: bigint,
): Promise<void> {
  const disk = await statfs(directory, { bigint: true });
  const available = disk.bavail * disk.bsize;
  if (available < required) {
    throw new Error(
      `Недостаточно места на диске. Освободите не менее ${formatDiskBytes(required)} и повторите установку.`,
    );
  }
}

export function requiredMinecraftDiskBytes(modSizes: number[]): bigint {
  const modsBytes = modSizes.reduce(
    (total, size) => total + Math.max(0, Math.ceil(size)),
    0,
  );
  return BigInt(Math.max(2 * GIB, modsBytes * 2 + GIB));
}

function lapisRoot(): string {
  return join(homedir(), ".lapis");
}
function runtimeRoot(): string {
  return join(lapisRoot(), "runtime");
}
function javaPath(): string {
  return join(runtimeRoot(), `temurin-${JAVA_MAJOR}`, "bin", "java.exe");
}
function instancesRoot(): string {
  return join(lapisRoot(), "instances");
}

export type MinecraftBuild = {
  id: string;
  minecraftVersion: string;
  loader: "fabric";
  loaderVersion: string;
  mods: {
    fileName: string;
    url: string;
    sha1: string;
    size: number;
    required: boolean;
  }[];
};

function instanceRoot(buildId: string): string {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(buildId))
    throw new Error("Идентификатор сборки содержит недопустимые символы.");
  return join(instancesRoot(), buildId);
}

async function javaWorks(executable: string): Promise<boolean> {
  try {
    await access(executable);
    const { stderr } = await execFileAsync(executable, ["-version"], {
      windowsHide: true,
      timeout: 10_000,
    });
    return new RegExp(`version\\s+"${JAVA_MAJOR}(?:[."]|$)`).test(stderr);
  } catch {
    return false;
  }
}

async function download(
  url: string,
  destination: string,
  onBytes?: (received: number, total: number) => void,
): Promise<void> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body)
    throw new Error("Не удалось загрузить Java runtime.");
  const maximumBytes = 500 * 1024 * 1024;
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > maximumBytes)
    throw new Error("Архив Java runtime слишком большой.");
  let received = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      onBytes?.(received, contentLength);
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
    meter,
    createWriteStream(destination),
  );
}

async function findJava(directory: string): Promise<string | null> {
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase() === "java.exe") {
      const candidate = join(entry.parentPath, entry.name);
      if (candidate.toLowerCase().endsWith("\\bin\\java.exe")) return candidate;
    }
  }
  return null;
}

async function extractArchive(
  archivePath: string,
  staging: string,
): Promise<void> {
  const zip = new AdmZip(archivePath);
  for (const entry of zip.getEntries()) {
    const target = resolve(staging, entry.entryName);
    const pathWithinStaging = relative(staging, target);
    if (pathWithinStaging.startsWith("..") || pathWithinStaging === "")
      throw new Error("Архив Java содержит небезопасный путь.");
    if (entry.isDirectory) await mkdir(target, { recursive: true });
    else {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, entry.getData());
    }
  }
}

export async function getJavaRuntime(): Promise<JavaRuntime> {
  return { major: JAVA_MAJOR, installed: await javaWorks(javaPath()) };
}

export async function ensureJavaRuntime(
  onProgress?: MinecraftInstallProgress,
): Promise<JavaRuntime> {
  const executable = javaPath();
  onProgress?.({ phase: "java", progress: 1, completed: 0, total: 1 });
  if (await javaWorks(executable)) {
    onProgress?.({ phase: "java", progress: 10, completed: 1, total: 1 });
    return { major: JAVA_MAJOR, installed: true };
  }
  const root = runtimeRoot();
  const archive = join(root, `temurin-${JAVA_MAJOR}.zip.download`);
  const staging = join(root, `temurin-${JAVA_MAJOR}.staging`);
  const destination = dirname(dirname(executable));
  await mkdir(root, { recursive: true });
  await ensureFreeDiskSpace(root, BigInt(GIB));
  await rm(staging, { recursive: true, force: true });
  try {
    let lastReportedProgress = -1;
    await download(ADOPTIUM_URL, archive, (received, total) => {
      const ratio = total > 0 ? received / total : 0;
      const progress = 1 + Math.round(Math.min(1, ratio) * 6);
      if (progress === lastReportedProgress) return;
      lastReportedProgress = progress;
      onProgress?.({
        phase: "java",
        progress,
        completed: received,
        total: total || undefined,
        fileName: `Java ${JAVA_MAJOR}`,
      });
    });
    onProgress?.({
      phase: "java",
      progress: 8,
      fileName: `Java ${JAVA_MAJOR}`,
    });
    await mkdir(staging, { recursive: true });
    await extractArchive(archive, staging);
    const found = await findJava(staging);
    if (!found || !(await javaWorks(found)))
      throw new Error("Загруженный Java runtime не прошёл проверку.");
    await rm(destination, { recursive: true, force: true });
    await mkdir(dirname(destination), { recursive: true });
    await rename(dirname(dirname(found)), destination);
    if (!(await javaWorks(executable)))
      throw new Error("Установленный Java runtime не прошёл проверку.");
    onProgress?.({ phase: "java", progress: 10, completed: 1, total: 1 });
    return { major: JAVA_MAJOR, installed: true };
  } finally {
    await rm(archive, { force: true });
    await rm(staging, { recursive: true, force: true });
  }
}

export type MinecraftRuntime = {
  instanceId: string;
  minecraftVersion: string;
  fabricVersion: string;
  installed: boolean;
};
export type MinecraftBuildStatus = "missing" | "update" | "ready";
export type MinecraftLaunchProfile = {
  nickname: string;
  uuid: string;
  memoryMb: number;
  fullscreen: boolean;
  bridgeBootstrap?: { port: number; nonce: string };
};

async function getOfficialMinecraftVersion(
  minecraftVersion: string,
): Promise<{ id: string; url: string }> {
  const response = await fetch(
    "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
  );
  if (!response.ok)
    throw new Error("Не удалось получить официальный manifest Minecraft.");
  const manifest = (await response.json()) as {
    versions?: { id: string; url: string }[];
  };
  const version = manifest.versions?.find(
    (candidate) => candidate.id === minecraftVersion,
  );
  if (!version)
    throw new Error(
      `Minecraft ${minecraftVersion} отсутствует в официальном manifest.`,
    );
  return version;
}

async function sha1File(path: string): Promise<string> {
  const content = await readFile(path);
  return createHash("sha1").update(content).digest("hex");
}

async function downloadVerified(
  url: string,
  destination: string,
  expectedSha1: string,
  dispatcher?: Agent,
): Promise<void> {
  try {
    if ((await sha1File(destination)) === expectedSha1) return;
  } catch {
    /* file is missing or invalid and will be downloaded */
  }
  const parsedUrl = new URL(url);
  const content =
    parsedUrl.protocol === "file:"
      ? await readFile(fileURLToPath(parsedUrl))
      : await (async () => {
          const response = dispatcher
            ? await undiciFetch(url, { dispatcher })
            : await fetch(url);
          if (!response.ok)
            throw new Error(`Не удалось скачать файл (${response.status}).`);
          return Buffer.from(await response.arrayBuffer());
        })();
  const actualSha1 = createHash("sha1").update(content).digest("hex");
  if (actualSha1 !== expectedSha1)
    throw new Error("Проверка целостности скачанного файла не пройдена.");
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.download`;
  await writeFile(temporary, content);
  await rename(temporary, destination);
}

function reportCountProgress(
  onProgress: MinecraftInstallProgress | undefined,
  phase: MinecraftInstallPhase,
  start: number,
  end: number,
  completed: number,
  total: number,
  fileName?: string,
): void {
  const interval = Math.max(1, Math.ceil(total / 100));
  if (completed !== 0 && completed !== total && completed % interval !== 0)
    return;
  onProgress?.({
    phase,
    progress:
      start + Math.round((completed / Math.max(total, 1)) * (end - start)),
    completed,
    total,
    ...(fileName ? { fileName } : {}),
  });
}

async function installAssetsWithFetch(
  location: string,
  minecraftVersion: string,
  dispatcher: Agent,
  onProgress?: MinecraftInstallProgress,
): Promise<void> {
  type Asset = { hash: string; size: number };
  type AssetIndex = { objects: Record<string, Asset> };
  const versionJson = JSON.parse(
    await readFile(
      join(location, "versions", minecraftVersion, `${minecraftVersion}.json`),
      "utf8",
    ),
  ) as { assetIndex: { id: string; url: string; sha1: string } };
  const indexPath = join(
    location,
    "assets",
    "indexes",
    `${versionJson.assetIndex.id}.json`,
  );
  await downloadVerified(
    versionJson.assetIndex.url,
    indexPath,
    versionJson.assetIndex.sha1,
    dispatcher,
  );
  const index = JSON.parse(await readFile(indexPath, "utf8")) as AssetIndex;
  const assets = Object.values(index.objects);
  let next = 0;
  let completed = 0;
  reportCountProgress(onProgress, "assets", 50, 75, completed, assets.length);
  const worker = async (): Promise<void> => {
    while (next < assets.length) {
      const asset = assets[next++];
      const url = `https://resources.download.minecraft.net/${asset.hash.slice(0, 2)}/${asset.hash}`;
      await downloadVerified(
        url,
        join(location, "assets", "objects", asset.hash.slice(0, 2), asset.hash),
        asset.hash,
        dispatcher,
      );
      completed += 1;
      reportCountProgress(
        onProgress,
        "assets",
        50,
        75,
        completed,
        assets.length,
      );
    }
  };
  await Promise.all(Array.from({ length: 8 }, () => worker()));
}

type MinecraftLibrary = {
  rules?: {
    action: "allow" | "disallow";
    os?: { name?: string; arch?: string };
  }[];
  downloads?: { artifact?: { path: string; url: string; sha1: string } };
};

function libraryAppliesToWindows(library: MinecraftLibrary): boolean {
  if (!library.rules?.length) return true;
  let allowed = false;
  for (const rule of library.rules) {
    const os = rule.os;
    const applies =
      !os ||
      ((os.name === undefined || os.name === "windows") &&
        (os.arch === undefined || os.arch === process.arch));
    if (applies) allowed = rule.action === "allow";
  }
  return allowed;
}

async function installVanillaLibrariesWithFetch(
  location: string,
  minecraftVersion: string,
  dispatcher: Agent,
  onProgress?: MinecraftInstallProgress,
): Promise<void> {
  const versionJson = JSON.parse(
    await readFile(
      join(location, "versions", minecraftVersion, `${minecraftVersion}.json`),
      "utf8",
    ),
  ) as { libraries?: MinecraftLibrary[] };
  const librariesRoot = join(location, "libraries");
  const files = (versionJson.libraries ?? [])
    .filter(libraryAppliesToWindows)
    .flatMap((library) =>
      library.downloads?.artifact ? [library.downloads.artifact] : [],
    );
  let next = 0;
  let completed = 0;
  reportCountProgress(onProgress, "libraries", 30, 50, completed, files.length);
  const worker = async (): Promise<void> => {
    while (next < files.length) {
      const file = files[next++];
      const target = resolve(librariesRoot, file.path);
      const pathWithinLibraries = relative(librariesRoot, target);
      if (pathWithinLibraries.startsWith("..") || pathWithinLibraries === "")
        throw new Error(
          "Minecraft manifest содержит небезопасный путь библиотеки.",
        );
      await downloadVerified(file.url, target, file.sha1, dispatcher);
      completed += 1;
      reportCountProgress(
        onProgress,
        "libraries",
        30,
        50,
        completed,
        files.length,
      );
    }
  };
  await Promise.all(Array.from({ length: 4 }, () => worker()));
}

type FabricProfile = {
  id: string;
  inheritsFrom: string;
  libraries: { name: string; url?: string; sha1?: string }[];
};

function mavenArtifactUrl(library: { name: string; url?: string }): string {
  const [group, artifact, version] = library.name.split(":");
  if (!group || !artifact || !version)
    throw new Error("Fabric profile contains an invalid library coordinate.");
  const base = library.url ?? "https://maven.fabricmc.net/";
  return `${base.replace(/\/$/, "")}/${group.replace(/\./g, "/")}/${artifact}/${version}/${artifact}-${version}.jar`;
}

async function installFabricFromOfficialProfile(
  location: string,
  build: MinecraftBuild,
  onProgress?: MinecraftInstallProgress,
): Promise<string> {
  const response = await fetch(
    `https://meta.fabricmc.net/v2/versions/loader/${build.minecraftVersion}/${build.loaderVersion}/profile/json`,
  );
  if (!response.ok)
    throw new Error("Не удалось получить официальный Fabric profile.");
  const profile = (await response.json()) as FabricProfile;
  if (profile.inheritsFrom !== build.minecraftVersion)
    throw new Error("Fabric profile не соответствует версии Minecraft.");
  const profilePath = join(
    location,
    "versions",
    profile.id,
    `${profile.id}.json`,
  );
  await mkdir(dirname(profilePath), { recursive: true });
  await writeFile(profilePath, JSON.stringify(profile));
  reportCountProgress(
    onProgress,
    "fabric",
    75,
    82,
    0,
    profile.libraries.length,
  );
  for (const [index, library] of profile.libraries.entries()) {
    const url = mavenArtifactUrl(library);
    const expectedSha1 =
      library.sha1 ??
      (await (await fetch(`${url}.sha1`)).text()).trim().split(/\s+/)[0];
    if (!/^[a-f0-9]{40}$/i.test(expectedSha1))
      throw new Error(
        "Не удалось получить контрольную сумму библиотеки Fabric.",
      );
    const [group, artifact, version] = library.name.split(":");
    await downloadVerified(
      url,
      join(
        location,
        "libraries",
        group.replace(/\./g, "/"),
        artifact,
        version,
        `${artifact}-${version}.jar`,
      ),
      expectedSha1,
    );
    reportCountProgress(
      onProgress,
      "fabric",
      75,
      82,
      index + 1,
      profile.libraries.length,
      `${artifact}-${version}.jar`,
    );
  }
  return profile.id;
}

async function installBuildMods(
  location: string,
  mods: MinecraftBuild["mods"],
  onProgress?: MinecraftInstallProgress,
): Promise<void> {
  const modsDirectory = join(location, "mods");
  await mkdir(modsDirectory, { recursive: true });
  for (const [index, mod] of mods.entries()) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,179}\.jar$/i.test(mod.fileName))
      throw new Error("Сборка содержит недопустимое имя файла мода.");
    onProgress?.({
      phase: "mods",
      progress: 82 + Math.round((index / Math.max(mods.length, 1)) * 17),
      completed: index,
      total: mods.length,
      fileName: mod.fileName,
    });
    await downloadVerified(
      mod.url,
      join(modsDirectory, mod.fileName),
      mod.sha1,
    );
    onProgress?.({
      phase: "mods",
      progress: 82 + Math.round(((index + 1) / Math.max(mods.length, 1)) * 17),
      completed: index + 1,
      total: mods.length,
      fileName: mod.fileName,
    });
  }
  await reconcileManagedMods(
    modsDirectory,
    mods.map((mod) => mod.fileName),
  );
}

async function ensureInstanceDirectories(location: string): Promise<void> {
  await Promise.all(
    ["mods", "config", "resourcepacks", "shaderpacks", "saves", "logs"].map(
      (directory) => mkdir(join(location, directory), { recursive: true }),
    ),
  );
}

export async function getMinecraftBuildStatus(
  build: MinecraftBuild,
): Promise<MinecraftBuildStatus> {
  const location = instanceRoot(build.id);
  try {
    await access(location);
  } catch {
    return "missing";
  }
  try {
    await access(
      join(
        location,
        "versions",
        build.minecraftVersion,
        `${build.minecraftVersion}.json`,
      ),
    );
    for (const mod of build.mods) {
      if ((await sha1File(join(location, "mods", mod.fileName))) !== mod.sha1)
        return "update";
    }
    if (
      !(await managedModsMatch(
        join(location, "mods"),
        build.mods.map((mod) => mod.fileName),
      ))
    )
      return "update";
    return "ready";
  } catch {
    return "update";
  }
}

export function minecraftInstanceDirectory(buildId: string): string {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(buildId))
    throw new Error("Недопустимый идентификатор сборки.");
  return instanceRoot(buildId);
}

export async function removeMinecraftRuntime(buildId: string): Promise<void> {
  await rm(minecraftInstanceDirectory(buildId), {
    recursive: true,
    force: true,
  });
}

export async function ensureMinecraftRuntime(
  build: MinecraftBuild,
  onProgress?: MinecraftInstallProgress,
): Promise<MinecraftRuntime> {
  const location = instanceRoot(build.id);
  await mkdir(location, { recursive: true });
  await ensureInstanceDirectories(location);
  onProgress?.({ phase: "preparing", progress: 10 });
  const requiredBytes = requiredMinecraftDiskBytes(
    build.mods.map((mod) => mod.size),
  );
  await ensureFreeDiskSpace(location, requiredBytes);
  const vanilla = await getOfficialMinecraftVersion(build.minecraftVersion);
  const dispatcher = new Agent({
    connections: 4,
    connectTimeout: 60_000,
    autoSelectFamily: true,
    autoSelectFamilyAttemptTimeout: 250,
  });
  const downloadOptions = {
    side: "client" as const,
    librariesDownloadConcurrency: 4,
    dispatcher,
  };
  try {
    try {
      onProgress?.({
        phase: "minecraft",
        progress: 10,
        fileName: `Minecraft ${build.minecraftVersion}`,
      });
      await installVersion(vanilla, location, downloadOptions);
      onProgress?.({
        phase: "minecraft",
        progress: 30,
        completed: 1,
        total: 1,
        fileName: `Minecraft ${build.minecraftVersion}`,
      });
      await installVanillaLibrariesWithFetch(
        location,
        build.minecraftVersion,
        dispatcher,
        onProgress,
      );
      await installAssetsWithFetch(
        location,
        build.minecraftVersion,
        dispatcher,
        onProgress,
      );
    } catch (error) {
      throw new Error(
        "Не удалось скачать игровые файлы Minecraft. Повторите установку — недостающие файлы будут докачаны.",
        { cause: error },
      );
    }
    try {
      const fabricVersion = await installFabricFromOfficialProfile(
        location,
        build,
        onProgress,
      );
      await installBuildMods(location, build.mods, onProgress);
      onProgress?.({
        phase: "complete",
        progress: 100,
        completed: build.mods.length,
        total: build.mods.length,
      });
      return {
        instanceId: build.id,
        minecraftVersion: build.minecraftVersion,
        fabricVersion,
        installed: true,
      };
    } catch (error) {
      throw new Error(
        "Не удалось установить зависимости Fabric. Повторите установку.",
        { cause: error },
      );
    }
  } finally {
    await dispatcher.close();
  }
}

export async function launchMinecraftRuntime(
  build: MinecraftBuild,
  runtime: MinecraftRuntime,
  profile: MinecraftLaunchProfile,
): Promise<ChildProcess> {
  if (
    !/^[A-Za-z0-9_]{3,16}$/.test(profile.nickname) ||
    !/^[a-f0-9]{32}$/i.test(profile.uuid)
  ) {
    throw new Error("Профиль игрока содержит недопустимые данные.");
  }
  const location = instanceRoot(build.id);
  if (runtime.instanceId !== build.id)
    throw new Error(
      "Сборка не соответствует подготовленному игровому окружению.",
    );
  const executable = javaPath();
  if (!(await javaWorks(executable)))
    throw new Error("Java runtime не готова.");
  if (!Number.isSafeInteger(profile.memoryMb) || profile.memoryMb < 1024) {
    throw new Error("Выбран недопустимый объём памяти для Minecraft.");
  }
  await prepareWindowsNativeLayout(location, runtime.fabricVersion);
  return launch({
    gameProfile: { name: profile.nickname, id: profile.uuid },
    accessToken: "0",
    userType: "legacy",
    launcherName: "Lapis Launcher",
    launcherBrand: "lapis",
    version: runtime.fabricVersion,
    gamePath: location,
    resourcePath: location,
    nativeRoot: join(location, "versions", runtime.fabricVersion, "natives"),
    javaPath: executable,
    minMemory: Math.min(1024, profile.memoryMb),
    maxMemory: profile.memoryMb,
    resolution: profile.fullscreen ? { fullscreen: true } : undefined,
    extraExecOption: {
      cwd: location,
      windowsHide: false,
      env: profile.bridgeBootstrap
        ? {
            ...process.env,
            LAPIS_BRIDGE_PORT: String(profile.bridgeBootstrap.port),
            LAPIS_BRIDGE_NONCE: profile.bridgeBootstrap.nonce,
          }
        : process.env,
    },
  });
}

async function prepareWindowsNativeLayout(
  location: string,
  fabricVersion: string,
): Promise<void> {
  const nativesDirectory = join(
    location,
    "versions",
    fabricVersion,
    "natives",
    "java",
  );
  await mkdir(nativesDirectory, { recursive: true });
  const librariesDirectory = join(location, "libraries");
  const entries = await readdir(librariesDirectory, {
    recursive: true,
    withFileTypes: true,
  });
  const archives = entries.filter(
    (entry) => entry.isFile() && /natives-windows\.jar$/i.test(entry.name),
  );
  if (!archives.length)
    throw new Error("Не найдены Windows native-библиотеки Minecraft.");
  for (const archive of archives) {
    const zip = new AdmZip(join(archive.parentPath, archive.name));
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory || !entry.entryName.toLowerCase().endsWith(".dll"))
        continue;
      await writeFile(
        join(nativesDirectory, basename(entry.entryName)),
        entry.getData(),
      );
    }
  }
}

import type { AdminClientMod } from "@lapis/contracts";
import AdmZip from "adm-zip";

type Requirement = string | string[];
type FabricMetadata = {
  id?: unknown;
  version?: unknown;
  environment?: unknown;
  depends?: unknown;
};

const MAX_METADATA_BYTES = 256 * 1024;
const MAX_ARCHIVE_ENTRIES = 20_000;

function parseLenientMetadata(value: string): FabricMetadata {
  try {
    return JSON.parse(value) as FabricMetadata;
  } catch {
    let inString = false;
    let escaped = false;
    let normalized = "";
    for (const character of value) {
      if (!inString) {
        if (character === '"') inString = true;
        normalized += character;
        continue;
      }
      if (escaped) {
        escaped = false;
        normalized += character;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        normalized += character;
      } else if (character === '"') {
        inString = false;
        normalized += character;
      } else if (character === "\n") normalized += "\\n";
      else if (character === "\r") normalized += "\\r";
      else if (character === "\t") normalized += "\\t";
      else normalized += character;
    }
    return JSON.parse(normalized) as FabricMetadata;
  }
}

function versionParts(value: string): number[] | null {
  const match = value.trim().match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

function compareVersions(left: string, right: string): number | null {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index]! > b[index]! ? 1 : -1;
  }
  return 0;
}

function satisfiesTerm(version: string, term: string): boolean | null {
  const value = term.trim();
  if (!value || value === "*") return true;
  const wildcard = value.match(/^(\d+)(?:\.(\d+))?\.(?:x|\*)$/i);
  if (wildcard) {
    const actual = versionParts(version);
    return actual
      ? actual[0] === Number(wildcard[1]) &&
          (wildcard[2] === undefined || actual[1] === Number(wildcard[2]))
      : null;
  }
  const match = value.match(/^(>=|<=|>|<|=|~|\^)?\s*(\d+(?:\.\d+){0,2})-?$/);
  if (!match) return null;
  const operator = match[1] ?? "=";
  const target = match[2]!;
  const comparison = compareVersions(version, target);
  if (comparison === null) return null;
  if (operator === ">=") return comparison >= 0;
  if (operator === "<=") return comparison <= 0;
  if (operator === ">") return comparison > 0;
  if (operator === "<") return comparison < 0;
  if (operator === "=") return comparison === 0;
  const current = versionParts(version)!;
  const required = versionParts(target)!;
  if (comparison < 0) return false;
  if (operator === "~")
    return current[0] === required[0] && current[1] === required[1];
  return required[0] === 0
    ? current[0] === 0 && current[1] === required[1]
    : current[0] === required[0];
}

function satisfiesRequirement(
  version: string,
  requirement: Requirement,
): boolean | null {
  const alternatives = Array.isArray(requirement) ? requirement : [requirement];
  let hasUnknown = false;
  for (const alternative of alternatives) {
    const groups = alternative.split("||").map((value) => value.trim());
    for (const group of groups) {
      const results = group
        .split(/\s+/)
        .filter(Boolean)
        .map((term) => satisfiesTerm(version, term));
      if (results.every((result) => result === true)) return true;
      if (results.some((result) => result === null)) hasUnknown = true;
    }
  }
  return hasUnknown ? null : false;
}

function requirementFrom(
  depends: Record<string, unknown>,
  key: string,
): Requirement | null {
  const value = depends[key];
  if (typeof value === "string") return value;
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string")
  )
    return value as string[];
  return null;
}

function displayRequirement(requirement: Requirement | null): string | null {
  if (!requirement) return null;
  return Array.isArray(requirement) ? requirement.join(" или ") : requirement;
}

export function inspectFabricMod(
  path: string,
  minecraftVersion: string,
  loaderVersion: string,
): AdminClientMod["compatibility"] {
  const unknown = (
    reason: string,
    overrides: Partial<AdminClientMod["compatibility"]> = {},
  ): AdminClientMod["compatibility"] => ({
    status: "unknown",
    reason,
    modId: null,
    modVersion: null,
    environment: "unknown",
    minecraftRequirement: null,
    loaderRequirement: null,
    ...overrides,
  });
  try {
    const archive = new AdmZip(path);
    const entries = archive.getEntries();
    if (entries.length > MAX_ARCHIVE_ENTRIES)
      return unknown("В архиве слишком много файлов для безопасной проверки.");
    const metadataEntry = archive.getEntry("fabric.mod.json");
    if (!metadataEntry) {
      const foreignLoader =
        archive.getEntry("META-INF/mods.toml") ||
        archive.getEntry("META-INF/neoforge.mods.toml");
      return foreignLoader
        ? {
            ...unknown(
              "Мод предназначен для Forge/NeoForge, а сборка использует Fabric.",
            ),
            status: "incompatible",
          }
        : unknown("В JAR нет fabric.mod.json — совместимость не определена.");
    }
    if (metadataEntry.header.size > MAX_METADATA_BYTES)
      return unknown(
        "fabric.mod.json слишком большой для безопасной проверки.",
      );
    const bytes = archive.readFile(metadataEntry);
    if (!bytes || bytes.length > MAX_METADATA_BYTES)
      return unknown("Не удалось безопасно прочитать fabric.mod.json.");
    const metadata = parseLenientMetadata(bytes.toString("utf8"));
    const depends =
      typeof metadata.depends === "object" && metadata.depends !== null
        ? (metadata.depends as Record<string, unknown>)
        : {};
    const minecraftRequirement = requirementFrom(depends, "minecraft");
    const loaderRequirement = requirementFrom(depends, "fabricloader");
    const environment =
      metadata.environment === "client"
        ? "client"
        : metadata.environment === "server"
          ? "server"
          : metadata.environment === "*" || metadata.environment === undefined
            ? "universal"
            : "unknown";
    const details = {
      modId: typeof metadata.id === "string" ? metadata.id.slice(0, 128) : null,
      modVersion:
        typeof metadata.version === "string"
          ? metadata.version.slice(0, 128)
          : null,
      environment,
      minecraftRequirement: displayRequirement(minecraftRequirement),
      loaderRequirement: displayRequirement(loaderRequirement),
    } satisfies Partial<AdminClientMod["compatibility"]>;
    if (environment === "server")
      return {
        status: "incompatible",
        reason:
          "Мод объявлен только для сервера и не должен ставиться клиенту.",
        ...details,
      };
    const minecraftMatches = minecraftRequirement
      ? satisfiesRequirement(minecraftVersion, minecraftRequirement)
      : null;
    const loaderMatches = loaderRequirement
      ? satisfiesRequirement(loaderVersion, loaderRequirement)
      : null;
    if (minecraftMatches === false)
      return {
        status: "incompatible",
        reason: `Не поддерживает Minecraft ${minecraftVersion}.`,
        ...details,
      };
    if (loaderMatches === false)
      return {
        status: "incompatible",
        reason: `Не поддерживает Fabric Loader ${loaderVersion}.`,
        ...details,
      };
    if (minecraftMatches === true && loaderMatches === true)
      return {
        status: "compatible",
        reason: `Поддерживает Minecraft ${minecraftVersion} и Fabric Loader ${loaderVersion}.`,
        ...details,
      };
    return unknown(
      "В метаданных недостаточно данных для точной проверки версии и загрузчика.",
      details,
    );
  } catch {
    return unknown("Не удалось прочитать метаданные Fabric из JAR.");
  }
}

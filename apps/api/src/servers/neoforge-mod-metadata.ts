import type { AdminClientMod } from "@lapis/contracts";
import AdmZip from "adm-zip";

export function inspectNeoForgeMod(path: string): AdminClientMod["compatibility"] {
  const base = {
    modId: null,
    modVersion: null,
    environment: "universal" as const,
    minecraftRequirement: null,
    loaderRequirement: null,
  };
  try {
    const archive = new AdmZip(path);
    if (archive.getEntries().length > 20_000)
      throw new Error("Слишком много файлов в JAR.");
    const entry = archive.getEntry("META-INF/neoforge.mods.toml") ?? archive.getEntry("META-INF/mods.toml");
    if (!entry)
      return { ...base, status: "incompatible", reason: "Не найден манифест NeoForge." };
    if (entry.header.size > 256 * 1024)
      throw new Error("Манифест NeoForge слишком большой.");
    const content = entry.getData().toString("utf8");
    const modId = /^\s*modId\s*=\s*["']([^"']+)["']/m.exec(content)?.[1] ?? null;
    const modVersion = /^\s*version\s*=\s*["']([^"']+)["']/m.exec(content)?.[1] ?? null;
    if (!modId)
      return { ...base, status: "unknown", reason: "Манифест NeoForge найден, но modId не распознан." };
    return {
      ...base,
      status: "unknown",
      reason: "Мод NeoForge найден; совместимость зависимостей проверьте при запуске.",
      modId: modId.slice(0, 128),
      modVersion: modVersion?.slice(0, 128) ?? null,
    };
  } catch {
    return { ...base, status: "unknown", reason: "Не удалось прочитать манифест NeoForge." };
  }
}

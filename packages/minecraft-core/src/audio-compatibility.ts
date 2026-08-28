import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const SOUND_PHYSICS_CONFIG = join(
  "config",
  "sound_physics_remastered",
  "soundphysics.properties",
);
const VOICE_CHAT_INTEGRATION_KEY = "simple_voice_chat_integration";

function hasMod(fileNames: string[], pattern: RegExp): boolean {
  return fileNames.some((fileName) => pattern.test(fileName));
}

export function setJavaProperty(
  contents: string,
  key: string,
  value: string,
): string {
  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  const property = `${key}=${value}`;
  const pattern = new RegExp(
    `^[ \\t]*${key.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}[ \\t]*=.*$`,
    "m",
  );

  if (pattern.test(contents)) return contents.replace(pattern, property);
  if (!contents) return `${property}${newline}`;
  return `${contents}${contents.endsWith("\n") ? "" : newline}${property}${newline}`;
}

/**
 * Sound Physics Remastered attaches EFX filters directly to Simple Voice Chat
 * OpenAL sources. On some Windows/OpenAL devices those sources become invalid
 * after an audio/resource reload and can flood the audio thread with
 * AL_INVALID_VALUE until the JVM stops responding. Keep both mods enabled, but
 * isolate voice-chat audio from Sound Physics' optional EFX integration.
 */
export async function applyAudioCompatibilitySettingsAt(
  instanceDirectory: string,
): Promise<boolean> {
  let modFileNames: string[];
  try {
    modFileNames = await readdir(join(instanceDirectory, "mods"));
  } catch {
    return false;
  }

  const hasSoundPhysics = hasMod(
    modFileNames,
    /^sound-physics-remastered(?:-fabric)?-.*\.jar$/i,
  );
  const hasVoiceChat = hasMod(modFileNames, /^voicechat(?:-fabric)?-.*\.jar$/i);
  if (!hasSoundPhysics || !hasVoiceChat) return false;

  const configPath = join(instanceDirectory, SOUND_PHYSICS_CONFIG);
  let current = "";
  try {
    current = await readFile(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const next = setJavaProperty(current, VOICE_CHAT_INTEGRATION_KEY, "false");
  if (next === current) return false;

  await mkdir(dirname(configPath), { recursive: true });
  const temporaryPath = `${configPath}.tmp`;
  await writeFile(temporaryPath, next, "utf8");
  await rename(temporaryPath, configPath);
  return true;
}

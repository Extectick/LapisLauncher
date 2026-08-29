import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const OPENGL_DEBUG_VERBOSITY_KEY = "glDebugVerbosity";

export function setMinecraftOption(
  contents: string,
  key: string,
  value: string,
): string {
  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  const option = `${key}:${value}`;
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escapedKey}:.*$`, "m");

  if (pattern.test(contents)) return contents.replace(pattern, option);
  if (!contents) return `${option}${newline}`;
  return `${contents}${contents.endsWith("\n") ? "" : newline}${option}${newline}`;
}

/**
 * Minecraft's OpenGL debug callback logs on the render thread. Iris/shader
 * incompatibilities can emit thousands of GL_INVALID_OPERATION messages per
 * second, turning a recoverable rendering problem into an application freeze.
 * Level 0 disables that noisy callback without disabling Iris or shader packs.
 */
export async function applyGraphicsCompatibilitySettingsAt(
  instanceDirectory: string,
): Promise<boolean> {
  const optionsPath = join(instanceDirectory, "options.txt");
  let current = "";
  try {
    current = await readFile(optionsPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const next = setMinecraftOption(current, OPENGL_DEBUG_VERBOSITY_KEY, "0");
  if (next === current) return false;

  const temporaryPath = `${optionsPath}.tmp`;
  await writeFile(temporaryPath, next, "utf8");
  await rename(temporaryPath, optionsPath);
  return true;
}

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const launcherDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
const workspaceDirectory = resolve(launcherDirectory, "../..");
const packageJson = JSON.parse(
  await readFile(join(launcherDirectory, "package.json"), "utf8"),
);
const configuredOutputDirectory = process.env.VELOPACK_OUTPUT_DIR?.trim();
const outputDirectory = configuredOutputDirectory
  ? resolve(workspaceDirectory, configuredOutputDirectory)
  : join(launcherDirectory, "release", "velopack");
const releaseBuild = process.argv.includes("--release");
const signParams = process.env.VELOPACK_SIGN_PARAMS?.trim();
const azureSigningFile = process.env.VELOPACK_AZURE_TRUSTED_SIGN_FILE?.trim();

if (releaseBuild && !signParams && !azureSigningFile) {
  throw new Error(
    "Production packaging requires VELOPACK_SIGN_PARAMS or VELOPACK_AZURE_TRUSTED_SIGN_FILE.",
  );
}

const argumentsList = [
  "tool",
  "run",
  "vpk",
  "--",
  "pack",
  "--packId",
  "LapisLauncher",
  "--packVersion",
  packageJson.version,
  "--packDir",
  join(launcherDirectory, "release", "electron", "win-unpacked"),
  "--outputDir",
  outputDirectory,
  "--channel",
  "stable",
  "--runtime",
  "win-x64",
  "--mainExe",
  "LapisLauncher.exe",
  "--packTitle",
  "Lapis Launcher",
  "--packAuthors",
  "Lapis",
  "--icon",
  join(launcherDirectory, "src", "renderer", "public", "logo.ico"),
  "--noPortable",
];

const releaseNotes = process.env.VELOPACK_RELEASE_NOTES?.trim();
if (releaseNotes) argumentsList.push("--releaseNotes", resolve(releaseNotes));
if (signParams) argumentsList.push("--signParams", signParams);
if (azureSigningFile)
  argumentsList.push("--azureTrustedSignFile", resolve(azureSigningFile));

await new Promise((resolvePromise, reject) => {
  const child = spawn("dotnet", argumentsList, {
    cwd: workspaceDirectory,
    stdio: "inherit",
    windowsHide: true,
  });
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (code === 0) resolvePromise();
    else
      reject(
        new Error(
          `Velopack packaging failed (${signal ? `signal ${signal}` : `exit ${code ?? "unknown"}`}).`,
        ),
      );
  });
});

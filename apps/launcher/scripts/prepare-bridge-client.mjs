import { copyFile, mkdir, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const launcherRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = join(launcherRoot, "..", "..");
const bridgeRoot = join(repositoryRoot, "fabric-bridge");
const gradle = join(
  bridgeRoot,
  process.platform === "win32" ? "gradlew.bat" : "gradlew",
);

execFileSync(
  gradle,
  [":bridge-client:build", ":bridge-server:build", "--no-daemon"],
  {
    cwd: bridgeRoot,
    stdio: "inherit",
    ...(process.platform === "win32" ? { shell: true } : {}),
  },
);

const properties = await readFile(
  join(bridgeRoot, "gradle.properties"),
  "utf8",
);
const version = /^mod_version=(.+)$/m.exec(properties)?.[1]?.trim();
if (!version || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version)) {
  throw new Error("Unable to determine Lapis Bridge version.");
}

const source = join(
  bridgeRoot,
  "bridge-client",
  "build",
  "libs",
  `bridge-client-${version}.jar`,
);
const destination = join(launcherRoot, "resources", "lapis-bridge-client.jar");
await mkdir(dirname(destination), { recursive: true });
await copyFile(source, destination);
console.log(`Prepared Lapis Bridge Client ${version}.`);

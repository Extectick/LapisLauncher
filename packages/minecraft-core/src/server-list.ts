import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  deserializeSync,
  getPrototypeOf,
  serializeSync,
  setPrototypeOf,
  TagType,
  type NBTPrototype,
} from "@xmcl/nbt";
import { directConnectTarget, type DirectConnectServer } from "./direct-connect";

type ServerEntry = { name: string; ip: string };
type ServerList = { servers: ServerEntry[] };

class ManagedServerEntry {
  name: string;
  ip: string;

  constructor(name = "", ip = "") {
    this.name = name;
    this.ip = ip;
  }
}
TagType(TagType.String)(ManagedServerEntry.prototype, "name");
TagType(TagType.String)(ManagedServerEntry.prototype, "ip");

class ManagedServerList {
  servers: ManagedServerEntry[] = [];
}
TagType([ManagedServerEntry])(ManagedServerList.prototype, "servers");

export async function ensureServerListEntryAt(
  instanceDirectory: string,
  serverName: string,
  server: DirectConnectServer,
): Promise<boolean> {
  if (!serverName.trim() || serverName.length > 80) {
    throw new Error("Название игрового сервера недопустимо.");
  }
  const target = directConnectTarget(server);
  const address = `${target.ip}:${target.port}`;
  const path = join(instanceDirectory, "servers.dat");
  let root: ServerList;
  try {
    root = deserializeSync<ServerList>(await readFile(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    root = new ManagedServerList();
  }
  if (!Array.isArray(root.servers)) {
    throw new Error("Файл списка серверов Minecraft повреждён.");
  }

  const existing = root.servers.find(
    (entry) => entry.name === serverName || entry.ip === address,
  );
  if (existing?.name === serverName && existing.ip === address) return false;
  if (existing) {
    existing.name = serverName;
    existing.ip = address;
  } else {
    root.servers.push(new ManagedServerEntry(serverName, address));
  }

  // Dynamic NBT reads infer a compound schema for a List<Compound>. Restore
  // the list schema before writing, retaining any tags on existing entries.
  const entrySchema = Object.assign(
    { name: TagType.String, ip: TagType.String },
    ...root.servers.map((entry) => getPrototypeOf(entry) ?? {}),
  );
  const serializableRoot: ServerList = { ...root };
  setPrototypeOf(serializableRoot, {
    ...getPrototypeOf(root),
    servers: [entrySchema],
  } as NBTPrototype);
  const temporaryPath = `${path}.lapis.tmp`;
  await writeFile(temporaryPath, serializeSync(serializableRoot));
  await rename(temporaryPath, path);
  return true;
}

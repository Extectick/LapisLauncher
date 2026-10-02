import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deserializeSync, serializeSync, TagType } from "@xmcl/nbt";
import { afterEach, describe, expect, it } from "vitest";
import { ensureServerListEntryAt } from "./server-list";

const temporaryDirectories: string[] = [];
async function temporaryInstance(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "lapis-servers-"));
  temporaryDirectories.push(directory);
  return directory;
}
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

class ExistingEntry {
  name = "Other";
  ip = "example.org:25565";
  icon = "data:image/png;base64,example";
  acceptTextures = 1;
}
TagType(TagType.String)(ExistingEntry.prototype, "name");
TagType(TagType.String)(ExistingEntry.prototype, "ip");
TagType(TagType.String)(ExistingEntry.prototype, "icon");
TagType(TagType.Byte)(ExistingEntry.prototype, "acceptTextures");
class ExistingList {
  servers = [new ExistingEntry()];
}
TagType([ExistingEntry])(ExistingList.prototype, "servers");

const target = { host: "195.208.129.43", port: 25566 };

describe("Minecraft server list", () => {
  it("adds the managed server to a fresh list", async () => {
    const instance = await temporaryInstance();
    expect(await ensureServerListEntryAt(instance, "Thaumcraft Reborn", target)).toBe(true);
    const data = deserializeSync<{ servers: { name: string; ip: string }[] }>(
      await readFile(join(instance, "servers.dat")),
    );
    expect(data.servers).toEqual([
      { name: "Thaumcraft Reborn", ip: "195.208.129.43:25566" },
    ]);
    expect(await ensureServerListEntryAt(instance, "Thaumcraft Reborn", target)).toBe(false);
  });

  it("preserves another server's icon and resource-pack choice", async () => {
    const instance = await temporaryInstance();
    await writeFile(join(instance, "servers.dat"), serializeSync(new ExistingList()));
    expect(await ensureServerListEntryAt(instance, "Thaumcraft Reborn", target)).toBe(true);
    const data = deserializeSync<ExistingList>(
      await readFile(join(instance, "servers.dat")),
      { type: ExistingList },
    );
    expect(data.servers[0]).toEqual(new ExistingEntry());
    expect(data.servers[1]).toMatchObject({
      name: "Thaumcraft Reborn",
      ip: "195.208.129.43:25566",
    });
  });

  it("updates a stale address with the same server name", async () => {
    const instance = await temporaryInstance();
    const list = new ExistingList();
    list.servers[0].name = "Thaumcraft Reborn";
    list.servers[0].ip = "192.168.30.206:25566";
    await writeFile(join(instance, "servers.dat"), serializeSync(list));
    expect(await ensureServerListEntryAt(instance, "Thaumcraft Reborn", target)).toBe(true);
    const data = deserializeSync<ExistingList>(
      await readFile(join(instance, "servers.dat")),
      { type: ExistingList },
    );
    expect(data.servers).toHaveLength(1);
    expect(data.servers[0].ip).toBe("195.208.129.43:25566");
    expect(data.servers[0].icon).toBe("data:image/png;base64,example");
  });
});

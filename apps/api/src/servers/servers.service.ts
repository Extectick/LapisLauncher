import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from "@nestjs/common";
import {
  AdminClientMod,
  AdminClientModDeleteInput,
  AdminClientModDeleteResult,
  AdminClientModUpdateInput,
  GameInstallManifest,
  GameLaunchContext,
  AdminServer,
  AdminServerCreateInput,
  AdminServerUpdateInput,
  ServerCatalogItem,
  ServerMod,
  ServerPlayer,
  SignedInstallManifest,
  gameInstallManifestSchema,
  adminClientModSchema,
  adminClientModDeleteResultSchema,
  adminServerSchema,
  gameLaunchContextSchema,
  nicknameSchema,
  serverCatalogItemSchema,
  serverModSchema,
  serverPlayerSchema,
} from "@lapis/contracts";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, open, rename, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { MultipartFile } from "@fastify/multipart";
import { PrismaService } from "../prisma.service";
import { SkinService } from "../profile/skin.service";
import { ManifestSigningService } from "./manifest-signing.service";
import { inspectFabricMod } from "./fabric-mod-metadata";

const SERVER_ICON_ROUTE = "v1/servers";
const MOD_CONTENT_ROUTE = "v1/content/mods";
const DEFAULT_CONTENT_ROOT = "V:\\LapisServer\\client-mods";
const MAX_CLIENT_MOD_BYTES = 128 * 1024 * 1024;
const CLIENT_MOD_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,179}\.jar$/i;

function publicApiUrl(path: string): string {
  const configuredBase =
    process.env.LAPIS_PUBLIC_API_URL ??
    `http://127.0.0.1:${process.env.PORT ?? 3000}`;
  const baseUrl = `${configuredBase.replace(/\/+$/, "")}/`;
  return new URL(path.replace(/^\/+/, ""), baseUrl).toString();
}

async function resolveModPath(
  root: string,
  sha1: string,
  fileName: string,
): Promise<string> {
  const contentAddressedPath = join(root, `${sha1}.jar`);
  try {
    await access(contentAddressedPath);
    return contentAddressedPath;
  } catch {
    // Existing installations stored files by their launch name. Keep that
    // layout readable while all new uploads use immutable hash-based blobs.
    return join(root, fileName);
  }
}

@Injectable()
export class ServersService {
  private readonly modCompatibilityCache = new Map<
    string,
    AdminClientMod["compatibility"]
  >();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ManifestSigningService)
    private readonly manifestSigning: ManifestSigningService,
    @Inject(SkinService) private readonly skins: SkinService,
  ) {}

  async listVisible(): Promise<ServerCatalogItem[]> {
    const servers = await this.prisma.server.findMany({
      where: { visible: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        slug: true,
        name: true,
        maintenance: true,
        status: true,
        onlinePlayers: true,
        maxPlayers: true,
        activeBuild: {
          select: {
            id: true,
            name: true,
            minecraftVersion: true,
            loader: true,
            loaderVersion: true,
            _count: {
              select: { mods: { where: { enabled: true } } },
            },
          },
        },
      },
    });
    return serverCatalogItemSchema.array().parse(
      servers.map(({ activeBuild, ...server }) => {
        if (!activeBuild || activeBuild.loader !== "fabric")
          throw new Error(`Server ${server.id} has no supported active build.`);
        return {
          ...server,
          iconUrl: publicApiUrl(
            `${SERVER_ICON_ROUTE}/${encodeURIComponent(server.id)}/icon`,
          ),
          build: { ...activeBuild, modCount: activeBuild._count.mods },
        };
      }),
    );
  }

  async listAdmin(): Promise<AdminServer[]> {
    const servers = await this.prisma.server.findMany({
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: {
        id: true,
        slug: true,
        name: true,
        host: true,
        port: true,
        visible: true,
        maintenance: true,
        status: true,
        onlinePlayers: true,
        maxPlayers: true,
        updatedAt: true,
        activeBuild: {
          select: {
            id: true,
            name: true,
            minecraftVersion: true,
            loader: true,
            loaderVersion: true,
            _count: {
              select: { mods: { where: { enabled: true } } },
            },
          },
        },
      },
    });
    return adminServerSchema.array().parse(
      servers.map(({ activeBuild, updatedAt, ...server }) => ({
        ...server,
        iconUrl: publicApiUrl(
          `${SERVER_ICON_ROUTE}/${encodeURIComponent(server.id)}/icon`,
        ),
        updatedAt: updatedAt.toISOString(),
        activeBuild: {
          ...activeBuild,
          modCount: activeBuild._count.mods,
        },
      })),
    );
  }

  async createAdmin(
    input: AdminServerCreateInput,
    actorUserId: string,
  ): Promise<AdminServer> {
    const existing = await this.prisma.server.findUnique({
      where: { id: input.id },
      select: { id: true },
    });
    if (existing)
      throw new ConflictException("Сервер с таким ID уже существует.");

    const template = await this.prisma.server.findFirst({
      where: input.templateServerId
        ? { id: input.templateServerId }
        : { visible: true },
      orderBy: { id: "asc" },
      select: {
        minecraftVersion: true,
        loader: true,
        activeBuild: {
          select: {
            name: true,
            minecraftVersion: true,
            loader: true,
            loaderVersion: true,
            mods: {
              select: {
                fileName: true,
                sha1: true,
                required: true,
                enabled: true,
              },
            },
          },
        },
      },
    });
    if (!template?.activeBuild)
      throw new BadRequestException(
        "Нет сборки, которую можно использовать как шаблон.",
      );

    const buildId = `${input.id}-client-${Date.now().toString(36)}`;
    const slug = input.id.toLowerCase();
    await this.prisma.$transaction(async (tx) => {
      await tx.gameBuild.create({
        data: {
          id: buildId,
          slug: buildId.toLowerCase(),
          name: `${input.name} client`,
          minecraftVersion: template.activeBuild.minecraftVersion,
          loader: template.activeBuild.loader,
          loaderVersion: template.activeBuild.loaderVersion,
          mods: { create: template.activeBuild.mods },
        },
      });
      await tx.server.create({
        data: {
          id: input.id,
          slug,
          name: input.name,
          host: input.host,
          port: input.port,
          visible: input.visible,
          minecraftVersion: template.minecraftVersion,
          loader: template.loader,
          activeBuildId: buildId,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId,
          action: "server.create",
          resourceType: "server",
          resourceId: input.id,
          serverId: input.id,
          after: {
            id: input.id,
            name: input.name,
            host: input.host,
            port: input.port,
            visible: input.visible,
            activeBuildId: buildId,
          },
        },
      });
    });
    return this.getAdmin(input.id);
  }

  async updateAdmin(
    serverId: string,
    input: AdminServerUpdateInput,
    actorUserId: string,
  ): Promise<AdminServer> {
    const before = await this.prisma.server.findUnique({
      where: { id: serverId },
      select: { name: true, host: true, port: true, visible: true },
    });
    if (!before) throw new NotFoundException("Сервер не найден.");
    const after = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.server.update({
        where: { id: serverId },
        data: input,
        select: { name: true, host: true, port: true, visible: true },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId,
          action: "server.update",
          resourceType: "server",
          resourceId: serverId,
          serverId,
          before,
          after: updated,
        },
      });
      return updated;
    });
    void after;
    return this.getAdmin(serverId);
  }

  async listAdminClientMods(serverId: string): Promise<AdminClientMod[]> {
    const server = await this.prisma.server.findUnique({
      where: { id: serverId },
      select: {
        activeBuild: {
          select: {
            minecraftVersion: true,
            loaderVersion: true,
            mods: {
              orderBy: [{ createdAt: "desc" }, { fileName: "asc" }],
              select: {
                id: true,
                fileName: true,
                sha1: true,
                enabled: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });
    if (!server?.activeBuild) throw new NotFoundException("Сервер не найден.");
    const root = process.env.LAPIS_CONTENT_ROOT ?? DEFAULT_CONTENT_ROOT;
    return adminClientModSchema.array().parse(
      await Promise.all(
        server.activeBuild.mods.map(async ({ createdAt, ...mod }) => {
          const path = await resolveModPath(root, mod.sha1, mod.fileName);
          return {
            ...mod,
            uploadedAt: createdAt.toISOString(),
            compatibility: this.compatibilityFor(
              mod.sha1,
              path,
              server.activeBuild!.minecraftVersion,
              server.activeBuild!.loaderVersion,
            ),
            size: await stat(path)
              .then((entry) => entry.size)
              .catch(() => 0),
          };
        }),
      ),
    );
  }

  async uploadAdminClientMod(
    serverId: string,
    part: MultipartFile,
    actorUserId: string,
  ): Promise<AdminClientMod> {
    const fileName = basename(part.filename);
    if (fileName !== part.filename || !CLIENT_MOD_FILE_PATTERN.test(fileName))
      throw new BadRequestException(
        "Выберите JAR-файл мода с корректным именем.",
      );
    const server = await this.prisma.server.findUnique({
      where: { id: serverId },
      select: {
        activeBuildId: true,
        activeBuild: {
          select: { minecraftVersion: true, loaderVersion: true },
        },
      },
    });
    if (!server) throw new NotFoundException("Сервер не найден.");

    const root = process.env.LAPIS_CONTENT_ROOT ?? DEFAULT_CONTENT_ROOT;
    const temporaryRoot = join(root, ".uploads");
    await mkdir(temporaryRoot, { recursive: true });
    const temporaryPath = join(temporaryRoot, `${randomUUID()}.jar.part`);
    const hash = createHash("sha1");
    let size = 0;
    const digest = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    try {
      await pipeline(
        part.file,
        digest,
        createWriteStream(temporaryPath, { flags: "wx" }),
      );
      if (part.file.truncated || size > MAX_CLIENT_MOD_BYTES)
        throw new PayloadTooLargeException(
          "Размер клиентского мода не должен превышать 128 МБ.",
        );
      const handle = await open(temporaryPath, "r");
      const signature = Buffer.alloc(4);
      await handle.read(signature, 0, signature.length, 0);
      await handle.close();
      if (signature[0] !== 0x50 || signature[1] !== 0x4b)
        throw new BadRequestException(
          "Файл не является корректным JAR-архивом.",
        );

      const sha1 = hash.digest("hex");
      const destinationPath = join(root, `${sha1}.jar`);
      try {
        await access(destinationPath);
      } catch {
        await rename(temporaryPath, destinationPath);
      }
      const compatibility = this.compatibilityFor(
        sha1,
        destinationPath,
        server.activeBuild.minecraftVersion,
        server.activeBuild.loaderVersion,
      );
      const mod = await this.prisma.$transaction(async (tx) => {
        const before = await tx.buildMod.findUnique({
          where: {
            buildId_fileName: { buildId: server.activeBuildId, fileName },
          },
          select: { id: true, sha1: true, enabled: true },
        });
        const saved = await tx.buildMod.upsert({
          where: {
            buildId_fileName: { buildId: server.activeBuildId, fileName },
          },
          create: {
            buildId: server.activeBuildId,
            fileName,
            sha1,
            required: true,
            enabled: false,
          },
          update: { sha1 },
          select: {
            id: true,
            fileName: true,
            sha1: true,
            enabled: true,
            createdAt: true,
          },
        });
        await tx.auditEvent.create({
          data: {
            actorUserId,
            action: "client_mod.upload",
            resourceType: "build_mod",
            resourceId: saved.id,
            serverId,
            before: before
              ? { sha1: before.sha1, enabled: before.enabled }
              : undefined,
            after: {
              fileName,
              sha1,
              size,
              enabled: saved.enabled,
              compatibility: compatibility.status,
            },
          },
        });
        return saved;
      });
      return adminClientModSchema.parse({
        ...mod,
        uploadedAt: mod.createdAt.toISOString(),
        compatibility,
        size,
      });
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  async updateAdminClientMod(
    serverId: string,
    modId: string,
    input: AdminClientModUpdateInput,
    actorUserId: string,
  ): Promise<AdminClientMod> {
    const before = await this.prisma.buildMod.findFirst({
      where: { id: modId, build: { servers: { some: { id: serverId } } } },
      select: { id: true, fileName: true, sha1: true, enabled: true },
    });
    if (!before) throw new NotFoundException("Клиентский мод не найден.");
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.buildMod.update({
        where: { id: modId },
        data: { enabled: input.enabled },
        select: {
          id: true,
          fileName: true,
          sha1: true,
          enabled: true,
          createdAt: true,
          build: {
            select: { minecraftVersion: true, loaderVersion: true },
          },
        },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId,
          action: "client_mod.toggle",
          resourceType: "build_mod",
          resourceId: modId,
          serverId,
          before: { enabled: before.enabled },
          after: { enabled: saved.enabled },
        },
      });
      return saved;
    });
    const root = process.env.LAPIS_CONTENT_ROOT ?? DEFAULT_CONTENT_ROOT;
    const size = await resolveModPath(root, updated.sha1, updated.fileName)
      .then((path) => stat(path))
      .then((entry) => entry.size)
      .catch(() => 0);
    const { createdAt, build, ...mod } = updated;
    return adminClientModSchema.parse({
      ...mod,
      uploadedAt: createdAt.toISOString(),
      compatibility: this.compatibilityFor(
        updated.sha1,
        await resolveModPath(root, updated.sha1, updated.fileName),
        build.minecraftVersion,
        build.loaderVersion,
      ),
      size,
    });
  }

  async deleteAdminClientMods(
    serverId: string,
    input: AdminClientModDeleteInput,
    actorUserId: string,
  ): Promise<AdminClientModDeleteResult> {
    const server = await this.prisma.server.findUnique({
      where: { id: serverId },
      select: {
        activeBuildId: true,
        activeBuild: {
          select: {
            mods: {
              where: { id: { in: input.ids } },
              select: { id: true, fileName: true, sha1: true, enabled: true },
            },
          },
        },
      },
    });
    if (!server) throw new NotFoundException("Сервер не найден.");
    if (server.activeBuild.mods.length !== input.ids.length)
      throw new NotFoundException("Один или несколько модов не найдены.");
    const deletedIds = server.activeBuild.mods.map((mod) => mod.id);
    await this.prisma.$transaction(async (tx) => {
      await tx.buildMod.deleteMany({
        where: { buildId: server.activeBuildId, id: { in: deletedIds } },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId,
          action: "client_mod.delete",
          resourceType: "game_build",
          resourceId: server.activeBuildId,
          serverId,
          before: server.activeBuild.mods,
          after: { deletedIds },
        },
      });
    });
    return adminClientModDeleteResultSchema.parse({ deletedIds });
  }

  private compatibilityFor(
    sha1: string,
    path: string,
    minecraftVersion: string,
    loaderVersion: string,
  ): AdminClientMod["compatibility"] {
    const key = `${sha1}:${minecraftVersion}:${loaderVersion}`;
    const cached = this.modCompatibilityCache.get(key);
    if (cached) return cached;
    const compatibility = inspectFabricMod(
      path,
      minecraftVersion,
      loaderVersion,
    );
    this.modCompatibilityCache.set(key, compatibility);
    if (this.modCompatibilityCache.size > 512) {
      const oldest = this.modCompatibilityCache.keys().next().value;
      if (oldest) this.modCompatibilityCache.delete(oldest);
    }
    return compatibility;
  }

  private async getAdmin(serverId: string): Promise<AdminServer> {
    const servers = await this.listAdmin();
    const server = servers.find((item) => item.id === serverId);
    if (!server) throw new NotFoundException("Сервер не найден.");
    return server;
  }

  async installManifest(serverId: string): Promise<SignedInstallManifest> {
    const server = await this.prisma.server.findFirst({
      where: { id: serverId, visible: true },
      select: {
        activeBuild: {
          select: {
            id: true,
            minecraftVersion: true,
            loader: true,
            loaderVersion: true,
            mods: {
              where: { enabled: true },
              select: { fileName: true, sha1: true, required: true },
              orderBy: { fileName: "asc" },
            },
          },
        },
      },
    });
    if (!server?.activeBuild || server.activeBuild.loader !== "fabric")
      throw new Error("Сборка сервера недоступна.");
    const modsRoot = process.env.LAPIS_CONTENT_ROOT ?? DEFAULT_CONTENT_ROOT;
    const mods = await Promise.all(
      server.activeBuild.mods.map(async (mod) => {
        const safeMod = serverModSchema.parse(mod);
        return {
          ...safeMod,
          sha1: mod.sha1,
          size: (
            await stat(
              await resolveModPath(modsRoot, mod.sha1, safeMod.fileName),
            )
          ).size,
          url: publicApiUrl(
            `${MOD_CONTENT_ROUTE}/${mod.sha1}/${encodeURIComponent(safeMod.fileName)}`,
          ),
        };
      }),
    );
    const manifest = {
      ...server.activeBuild,
      mods,
    };
    return this.manifestSigning.sign(gameInstallManifestSchema.parse(manifest));
  }

  async listMods(serverId: string): Promise<ServerMod[]> {
    const server = await this.prisma.server.findFirst({
      where: { id: serverId, visible: true },
      select: {
        activeBuild: {
          select: {
            mods: {
              where: { enabled: true },
              select: { fileName: true, required: true },
              orderBy: { fileName: "asc" },
            },
          },
        },
      },
    });
    if (!server?.activeBuild) throw new NotFoundException("Сервер не найден.");
    return serverModSchema.array().parse(server.activeBuild.mods);
  }

  async listPlayers(serverId: string): Promise<ServerPlayer[]> {
    const server = await this.prisma.server.findFirst({
      where: { id: serverId, visible: true },
      select: { status: true, onlinePlayerNames: true },
    });
    if (!server) throw new NotFoundException("Сервер не найден.");
    if (server.status !== "online") return [];
    const nicknames = server.onlinePlayerNames
      .filter((nickname) => nicknameSchema.safeParse(nickname).success)
      .slice(0, 100);
    return serverPlayerSchema.array().parse(
      await Promise.all(
        nicknames.map(async (nickname) => ({
          nickname,
          skin: await this.skins.getSkin(nickname),
        })),
      ),
    );
  }

  async launchTarget(
    serverId: string,
  ): Promise<Omit<GameLaunchContext, "ticket" | "expiresAt">> {
    const server = await this.prisma.server.findFirst({
      where: { id: serverId, visible: true, maintenance: false },
      select: {
        id: true,
        host: true,
        port: true,
        activeBuild: { select: { id: true, loader: true } },
      },
    });
    if (!server?.activeBuild || server.activeBuild.loader !== "fabric")
      throw new Error("Сервер недоступен.");
    return gameLaunchContextSchema
      .omit({ ticket: true, expiresAt: true })
      .parse({
        serverId: server.id,
        host: server.host,
        port: server.port,
        buildId: server.activeBuild.id,
        bridgeProtocolVersion: 1,
      });
  }
}

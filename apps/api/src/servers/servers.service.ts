import { Inject, Injectable } from '@nestjs/common';
import { GameInstallManifest, GameLaunchContext, ServerCatalogItem, SignedInstallManifest, gameInstallManifestSchema, gameLaunchContextSchema, serverCatalogItemSchema } from '@lapis/contracts';
import { PrismaService } from '../prisma.service';
import { ManifestSigningService } from './manifest-signing.service';

@Injectable()
export class ServersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ManifestSigningService) private readonly manifestSigning: ManifestSigningService,
  ) {}

  async listVisible(): Promise<ServerCatalogItem[]> {
    const servers = await this.prisma.server.findMany({
      where: { visible: true },
      orderBy: { name: 'asc' },
      select: {
        id: true, slug: true, name: true,
        maintenance: true, status: true, onlinePlayers: true, maxPlayers: true,
        activeBuild: { select: { id: true, name: true, minecraftVersion: true, loader: true, loaderVersion: true, _count: { select: { mods: true } } } },
      },
    });
    return serverCatalogItemSchema.array().parse(servers.map(({ activeBuild, ...server }) => {
      if (!activeBuild || activeBuild.loader !== 'fabric') throw new Error(`Server ${server.id} has no supported active build.`);
      const apiOrigin = process.env.LAPIS_PUBLIC_API_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`;
      return { ...server, iconUrl: `${apiOrigin}/v1/servers/${encodeURIComponent(server.id)}/icon`, build: { ...activeBuild, modCount: activeBuild._count.mods } };
    }));
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
              select: { fileName: true, url: true, sha1: true, required: true },
              orderBy: { fileName: 'asc' },
            },
          },
        },
      },
    });
    if (!server?.activeBuild || server.activeBuild.loader !== 'fabric') throw new Error('Сборка сервера недоступна.');
    return this.manifestSigning.sign(gameInstallManifestSchema.parse(server.activeBuild));
  }

  async launchTarget(serverId: string): Promise<Omit<GameLaunchContext, 'ticket' | 'expiresAt'>> {
    const server = await this.prisma.server.findFirst({
      where: { id: serverId, visible: true, maintenance: false },
      select: { id: true, host: true, port: true, activeBuild: { select: { id: true, loader: true } } },
    });
    if (!server?.activeBuild || server.activeBuild.loader !== 'fabric') throw new Error('Сервер недоступен.');
    return gameLaunchContextSchema.omit({ ticket: true, expiresAt: true }).parse({
      serverId: server.id,
      host: server.host,
      port: server.port,
      buildId: server.activeBuild.id,
      bridgeProtocolVersion: 1,
    });
  }
}

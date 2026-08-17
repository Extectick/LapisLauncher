import { Controller, Get, Headers, HttpCode, Inject, NotFoundException, Param, Post, Res } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { FastifyReply } from 'fastify';
import { GameLaunchContext, GameTicket, ServerCatalogItem, SignedInstallManifest } from '@lapis/contracts';
import { AuthService } from '../auth/auth.service';
import { GameTicketsService } from './game-tickets.service';
import { ServersService } from './servers.service';

@Controller('v1/servers')
export class ServersController {
  constructor(
    @Inject(ServersService) private readonly servers: ServersService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(GameTicketsService) private readonly tickets: GameTicketsService,
  ) {}

  @Get()
  list(): Promise<ServerCatalogItem[]> {
    return this.servers.listVisible();
  }

  @Get(':id/icon')
  async icon(@Param('id') id: string, @Res() reply: FastifyReply): Promise<void> {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(id)) throw new NotFoundException();
    const root = process.env.LAPIS_SERVER_ROOT ?? 'V:\\LapisServer';
    const path = join(root, 'server-icon.png');
    try { await access(path); } catch { throw new NotFoundException(); }
    reply.header('content-type', 'image/png');
    reply.header('cache-control', 'no-cache');
    await reply.send(createReadStream(path));
  }

  @Get(':id/install-manifest')
  installManifest(@Param('id') id: string): Promise<SignedInstallManifest> {
    return this.servers.installManifest(id);
  }

  @HttpCode(201)
  @Post(':id/game-ticket')
  async issueTicket(@Param('id') id: string, @Headers('authorization') authorization: string | undefined): Promise<GameTicket> {
    const user = await this.auth.accessUser(authorization);
    return this.tickets.issue(user.id, id);
  }

  @HttpCode(201)
  @Post(':id/game-launch-context')
  async issueLaunchContext(@Param('id') id: string, @Headers('authorization') authorization: string | undefined): Promise<GameLaunchContext> {
    const user = await this.auth.accessUser(authorization);
    const [target, ticket] = await Promise.all([this.servers.launchTarget(id), this.tickets.issue(user.id, id)]);
    return { ...target, ...ticket };
  }
}

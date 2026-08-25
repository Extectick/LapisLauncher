import {
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Res,
} from "@nestjs/common";
import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { FastifyReply } from "fastify";
import {
  GameLaunchContext,
  GameTicket,
  ServerCatalogItem,
  ServerMod,
  ServerPlayer,
  SignedInstallManifest,
} from "@lapis/contracts";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AccessUser } from "../auth/auth.types";
import { Public } from "../auth/public.decorator";
import { GameTicketsService } from "./game-tickets.service";
import { ServersService } from "./servers.service";

@Controller("v1/servers")
export class ServersController {
  constructor(
    @Inject(ServersService) private readonly servers: ServersService,
    @Inject(GameTicketsService) private readonly tickets: GameTicketsService,
  ) {}

  @Public()
  @Get()
  list(): Promise<ServerCatalogItem[]> {
    return this.servers.listVisible();
  }

  @Public()
  @Get(":id/icon")
  async icon(
    @Param("id") id: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(id)) throw new NotFoundException();
    const root = process.env.LAPIS_SERVER_ROOT ?? "V:\\LapisServer";
    const path = join(root, "server-icon.png");
    try {
      await access(path);
    } catch {
      throw new NotFoundException();
    }
    reply.header("content-type", "image/png");
    reply.header("cache-control", "no-cache");
    await reply.send(createReadStream(path));
  }

  @Public()
  @Get(":id/install-manifest")
  installManifest(@Param("id") id: string): Promise<SignedInstallManifest> {
    return this.servers.installManifest(id);
  }

  @Public()
  @Get(":id/mods")
  mods(@Param("id") id: string): Promise<ServerMod[]> {
    return this.servers.listMods(id);
  }

  @Public()
  @Get(":id/players")
  players(@Param("id") id: string): Promise<ServerPlayer[]> {
    return this.servers.listPlayers(id);
  }

  @HttpCode(201)
  @Post(":id/game-ticket")
  async issueTicket(
    @Param("id") id: string,
    @CurrentUser() user: AccessUser,
  ): Promise<GameTicket> {
    return this.tickets.issue(user.id, id);
  }

  @HttpCode(201)
  @Post(":id/game-launch-context")
  async issueLaunchContext(
    @Param("id") id: string,
    @CurrentUser() user: AccessUser,
  ): Promise<GameLaunchContext> {
    const [target, ticket, profile] = await Promise.all([
      this.servers.launchTarget(id),
      this.tickets.issue(user.id, id),
      this.tickets.canonicalProfile(user.id),
    ]);
    return { ...target, ...ticket, ...profile };
  }
}

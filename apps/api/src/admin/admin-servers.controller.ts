import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import {
  AdminClientMod,
  AdminClientModDeleteResult,
  AdminServer,
  adminClientModDeleteSchema,
  adminClientModUpdateSchema,
  adminServerCreateSchema,
  adminServerUpdateSchema,
} from "@lapis/contracts";
import type { FastifyRequest } from "fastify";
import type { ZodType } from "zod";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AccessUser } from "../auth/auth.types";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { ServersService } from "../servers/servers.service";

function parseInput<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new BadRequestException(
    parsed.error.issues[0]?.message ?? "Проверьте введённые данные.",
  );
}

@Controller("v1/admin/servers")
export class AdminServersController {
  constructor(
    @Inject(ServersService) private readonly servers: ServersService,
  ) {}

  @RequirePermissions("admin.access", "servers.read")
  @Get()
  list(): Promise<AdminServer[]> {
    return this.servers.listAdmin();
  }

  @RequirePermissions("admin.access", "servers.write")
  @Post()
  create(
    @Body() body: unknown,
    @CurrentUser() user: AccessUser,
  ): Promise<AdminServer> {
    return this.servers.createAdmin(
      parseInput(adminServerCreateSchema, body),
      user.id,
    );
  }

  @RequirePermissions("admin.access", "servers.write")
  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: AccessUser,
  ): Promise<AdminServer> {
    return this.servers.updateAdmin(
      id,
      parseInput(adminServerUpdateSchema, body),
      user.id,
    );
  }

  @RequirePermissions("admin.access", "mods.read")
  @Get(":id/client-mods")
  clientMods(@Param("id") id: string): Promise<AdminClientMod[]> {
    return this.servers.listAdminClientMods(id);
  }

  @RequirePermissions("admin.access", "mods.write")
  @Post(":id/client-mods")
  async uploadClientMod(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @CurrentUser() user: AccessUser,
  ): Promise<AdminClientMod> {
    const part = await request.file({
      limits: { files: 1, fields: 0, parts: 1, fileSize: 128 * 1024 * 1024 },
    });
    if (!part)
      throw new BadRequestException("Выберите JAR-файл клиентского мода.");
    return this.servers.uploadAdminClientMod(id, part, user.id);
  }

  @RequirePermissions("admin.access", "mods.write")
  @Patch(":id/client-mods/:modId")
  updateClientMod(
    @Param("id") id: string,
    @Param("modId") modId: string,
    @Body() body: unknown,
    @CurrentUser() user: AccessUser,
  ): Promise<AdminClientMod> {
    return this.servers.updateAdminClientMod(
      id,
      modId,
      parseInput(adminClientModUpdateSchema, body),
      user.id,
    );
  }

  @RequirePermissions("admin.access", "mods.write")
  @Delete(":id/client-mods")
  deleteClientMods(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: AccessUser,
  ): Promise<AdminClientModDeleteResult> {
    return this.servers.deleteAdminClientMods(
      id,
      parseInput(adminClientModDeleteSchema, body),
      user.id,
    );
  }
}

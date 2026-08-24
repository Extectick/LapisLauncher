import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Post,
} from "@nestjs/common";
import { PlayerSkin, skinUploadSchema } from "@lapis/contracts";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AccessUser } from "../auth/auth.types";
import { SkinService } from "./skin.service";

@Controller("v1/profile")
export class ProfileController {
  constructor(
    @Inject(SkinService) private readonly skins: SkinService,
  ) {}

  @Get("skin")
  async skin(@CurrentUser() user: AccessUser): Promise<PlayerSkin> {
    return this.skins.getSkin(user.nickname);
  }

  @Post("skin")
  async upload(
    @CurrentUser() user: AccessUser,
    @Body() input: unknown,
  ): Promise<PlayerSkin> {
    const parsed = skinUploadSchema.safeParse(input);
    if (!parsed.success)
      throw new BadRequestException("Загрузите файл PNG размером до 20 КБ.");
    return this.skins.uploadSkin(user.id, user.nickname, parsed.data.pngBase64);
  }
}

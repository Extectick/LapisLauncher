import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Post,
} from "@nestjs/common";
import { PlayerSkin, skinUploadSchema } from "@lapis/contracts";
import { AuthService } from "../auth/auth.service";
import { SkinService } from "./skin.service";

@Controller("v1/profile")
export class ProfileController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SkinService) private readonly skins: SkinService,
  ) {}

  @Get("skin")
  async skin(
    @Headers("authorization") authorization: string | undefined,
  ): Promise<PlayerSkin> {
    const user = await this.auth.accessUser(authorization);
    return this.skins.getSkin(user.nickname);
  }

  @Post("skin")
  async upload(
    @Headers("authorization") authorization: string | undefined,
    @Body() input: unknown,
  ): Promise<PlayerSkin> {
    const user = await this.auth.accessUser(authorization);
    const parsed = skinUploadSchema.safeParse(input);
    if (!parsed.success)
      throw new BadRequestException("Загрузите файл PNG размером до 20 КБ.");
    return this.skins.uploadSkin(user.id, user.nickname, parsed.data.pngBase64);
  }
}

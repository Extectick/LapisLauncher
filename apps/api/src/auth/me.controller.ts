import { Controller, Get, Inject } from "@nestjs/common";
import { CurrentUser as CurrentUserResponse, currentUserSchema } from "@lapis/contracts";
import { AuthorizationService } from "./authorization.service";
import { CurrentUser } from "./current-user.decorator";
import type { AccessUser } from "./auth.types";

@Controller("v1/me")
export class MeController {
  constructor(
    @Inject(AuthorizationService)
    private readonly authorization: AuthorizationService,
  ) {}

  @Get()
  async me(@CurrentUser() user: AccessUser): Promise<CurrentUserResponse> {
    return currentUserSchema.parse({
      user,
      authorization: await this.authorization.snapshot(user.id),
    });
  }
}

import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import type { PermissionKey } from "@lapis/contracts";
import { Reflector } from "@nestjs/core";
import type { AuthenticatedRequest } from "./auth.types";
import { AuthorizationService } from "./authorization.service";
import { REQUIRED_PERMISSIONS_KEY } from "./require-permissions.decorator";

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthorizationService)
    private readonly authorization: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PermissionKey[]>(
      REQUIRED_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) return false;
    const serverId =
      request.params && typeof request.params.serverId === "string"
        ? request.params.serverId
        : undefined;
    request.authorization = await this.authorization.require(
      request.user.id,
      required,
      serverId,
    );
    return true;
  }
}

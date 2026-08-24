import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { AccessUser, AuthenticatedRequest } from "./auth.types";

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AccessUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) throw new Error("Authenticated request has no user.");
    return request.user;
  },
);

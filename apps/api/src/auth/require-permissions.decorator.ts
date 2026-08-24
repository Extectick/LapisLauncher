import { SetMetadata } from "@nestjs/common";
import type { PermissionKey } from "@lapis/contracts";

export const REQUIRED_PERMISSIONS_KEY = "lapis:required-permissions";
export const RequirePermissions = (
  ...permissions: PermissionKey[]
): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);

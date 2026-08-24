import type { AuthorizationSnapshot } from "@lapis/contracts";

export type AccessUser = { id: string; nickname: string };

export type AuthenticatedRequest = {
  headers: { authorization?: string };
  params?: Record<string, unknown>;
  user?: AccessUser;
  authorization?: AuthorizationSnapshot;
};

import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import {
  AuthorizationSnapshot,
  PermissionKey,
  authorizationSnapshotSchema,
  permissionKeySchema,
} from "@lapis/contracts";
import { PrismaService } from "../prisma.service";

type Assignment = {
  scopeType: "GLOBAL" | "SERVER";
  scopeId: string | null;
  role: {
    key: string;
    isSuperAdmin: boolean;
    permissions: Array<{ permission: { key: string } }>;
  };
};

@Injectable()
export class AuthorizationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async snapshot(userId: string): Promise<AuthorizationSnapshot> {
    const assignments = (await this.prisma.userRole.findMany({
      where: {
        userId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: [{ scopeType: "asc" }, { role: { key: "asc" } }],
      select: {
        scopeType: true,
        scopeId: true,
        role: {
          select: {
            key: true,
            isSuperAdmin: true,
            permissions: {
              select: { permission: { select: { key: true } } },
            },
          },
        },
      },
    })) as Assignment[];

    const globalPermissions = new Set<PermissionKey>();
    const serverPermissions = new Map<string, Set<PermissionKey>>();
    let isSuperAdmin = false;

    for (const assignment of assignments) {
      const target =
        assignment.scopeType === "GLOBAL"
          ? globalPermissions
          : assignment.scopeId
            ? (serverPermissions.get(assignment.scopeId) ??
              new Set<PermissionKey>())
            : null;
      if (!target) continue;
      if (assignment.scopeType === "SERVER" && assignment.scopeId)
        serverPermissions.set(assignment.scopeId, target);
      if (assignment.scopeType === "GLOBAL" && assignment.role.isSuperAdmin)
        isSuperAdmin = true;
      for (const item of assignment.role.permissions) {
        const parsed = permissionKeySchema.safeParse(item.permission.key);
        if (parsed.success) target.add(parsed.data);
      }
    }

    return authorizationSnapshotSchema.parse({
      isSuperAdmin,
      roles: assignments.map((assignment) => ({
        key: assignment.role.key,
        scopeType: assignment.scopeType,
        scopeId: assignment.scopeId,
      })),
      globalPermissions: [...globalPermissions].sort(),
      serverPermissions: [...serverPermissions.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([serverId, permissions]) => ({
          serverId,
          permissions: [...permissions].sort(),
        })),
    });
  }

  async require(
    userId: string,
    required: readonly PermissionKey[],
    serverId?: string,
  ): Promise<AuthorizationSnapshot> {
    const snapshot = await this.snapshot(userId);
    if (snapshot.isSuperAdmin) return snapshot;
    const available = new Set(snapshot.globalPermissions);
    if (serverId) {
      for (const permission of
        snapshot.serverPermissions.find((item) => item.serverId === serverId)
          ?.permissions ?? [])
        available.add(permission);
    }
    if (!required.every((permission) => available.has(permission)))
      throw new ForbiddenException("Недостаточно прав для этого действия.");
    return snapshot;
  }
}

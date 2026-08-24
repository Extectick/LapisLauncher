import "../env";
import { PrismaClient } from "@prisma/client";

function nicknameFromArgs(): string {
  const index = process.argv.indexOf("--nickname");
  const nickname = index >= 0 ? process.argv[index + 1] : undefined;
  if (!nickname || !/^[A-Za-z0-9_]{3,16}$/.test(nickname))
    throw new Error(
      "Usage: pnpm --filter @lapis/api admin:grant-super -- --nickname <nickname>",
    );
  return nickname;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const nickname = nicknameFromArgs();
    const user = await prisma.user.findUnique({
      where: { nicknameFold: nickname.toLocaleLowerCase("en-US") },
      select: { id: true, nickname: true },
    });
    if (!user) throw new Error(`Lapis user "${nickname}" was not found.`);
    const role = await prisma.role.findUnique({
      where: { key: "super_admin" },
      select: { id: true },
    });
    if (!role)
      throw new Error("RBAC migration is not applied: super_admin is missing.");

    await prisma.$transaction(async (tx) => {
      const existing = await tx.userRole.findFirst({
        where: {
          userId: user.id,
          roleId: role.id,
          scopeType: "GLOBAL",
          scopeId: null,
        },
        select: { id: true },
      });
      if (!existing)
        await tx.userRole.create({
          data: {
            userId: user.id,
            roleId: role.id,
            scopeType: "GLOBAL",
          },
        });
      await tx.auditEvent.create({
        data: {
          action: existing
            ? "role.bootstrap.confirmed"
            : "role.bootstrap.assigned",
          resourceType: "user",
          resourceId: user.id,
          after: { role: "super_admin", nickname: user.nickname },
        },
      });
    });
    process.stdout.write(`super_admin assigned to ${user.nickname}.\n`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

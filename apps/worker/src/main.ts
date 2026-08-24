import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { pingMinecraftServer } from './minecraft-status';

config({ path: resolve(__dirname, '../../api/.env'), override: false });
const prisma = new PrismaClient();
const configuredIntervalMs = Number(process.env.LAPIS_SERVER_PING_INTERVAL_MS ?? 30_000);
const intervalMs = Number.isFinite(configuredIntervalMs)
  ? Math.max(10_000, Math.min(300_000, Math.round(configuredIntervalMs)))
  : 30_000;

async function refreshServerStatuses(): Promise<void> {
  const servers = await prisma.server.findMany({
    where: { visible: true },
    select: { id: true, host: true, port: true },
  });
  await Promise.all(
    servers.map(async (server) => {
      try {
        const result = await pingMinecraftServer(server.host, server.port);
        await prisma.server.update({
          where: { id: server.id },
          data: {
            status: 'online',
            onlinePlayers: result.onlinePlayers,
            maxPlayers: result.maxPlayers,
            onlinePlayerNames: result.playerNames,
          },
        });
      } catch {
        await prisma.server.update({
          where: { id: server.id },
          data: {
            status: 'offline',
            onlinePlayers: null,
            maxPlayers: null,
            onlinePlayerNames: [],
          },
        });
      }
    }),
  );
}

async function bootstrap(): Promise<void> {
  await refreshServerStatuses();
  if (process.env.WORKER_RUN_ONCE === '1') return prisma.$disconnect();
  const scheduleNextRefresh = (): void => {
    setTimeout(() => {
      void refreshServerStatuses()
        .catch(() => console.error('Server status refresh failed.'))
        .finally(scheduleNextRefresh);
    }, intervalMs).unref();
  };
  scheduleNextRefresh();
}
void bootstrap();

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { Socket } from 'node:net';
import { resolve } from 'node:path';

config({ path: resolve(__dirname, '../../api/.env'), override: false });
const prisma = new PrismaClient();
const intervalMs = Number(process.env.LAPIS_SERVER_PING_INTERVAL_MS ?? 30_000);

function decodeUtf16Be(data: Buffer): string {
  const littleEndian = Buffer.allocUnsafe(data.length);
  for (let index = 0; index < data.length; index += 2) {
    littleEndian[index] = data[index + 1];
    littleEndian[index + 1] = data[index];
  }
  return littleEndian.toString('utf16le');
}

function pingLegacyMinecraft(host: string, port: number, timeoutMs = 5_000): Promise<{ onlinePlayers: number; maxPlayers: number }> {
  return new Promise((resolvePing, rejectPing) => {
    const socket = new Socket();
    const chunks: Buffer[] = [];
    const fail = (error: Error): void => { socket.destroy(); rejectPing(error); };
    const timer = setTimeout(() => fail(new Error('Minecraft status ping timed out.')), timeoutMs);
    socket.once('error', fail);
    socket.connect(port, host, () => socket.write(Buffer.from([0xfe, 0x01])));
    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      const data = Buffer.concat(chunks);
      if (data.length < 3) return;
      if (data[0] !== 0xff) return fail(new Error('Invalid Minecraft status packet.'));
      const characters = data.readUInt16BE(1);
      if (data.length < 3 + characters * 2) return;
      clearTimeout(timer);
      socket.destroy();
      const parts = decodeUtf16Be(data.subarray(3, 3 + characters * 2)).split('\u0000');
      const onlinePlayers = Number(parts.at(-2));
      const maxPlayers = Number(parts.at(-1));
      if (!Number.isInteger(onlinePlayers) || !Number.isInteger(maxPlayers) || onlinePlayers < 0 || maxPlayers < 0) return fail(new Error('Invalid player counts.'));
      resolvePing({ onlinePlayers, maxPlayers });
    });
  });
}

async function refreshServerStatuses(): Promise<void> {
  const servers = await prisma.server.findMany({ where: { visible: true }, select: { id: true, host: true, port: true } });
  await Promise.all(servers.map(async (server) => {
    try {
      const result = await pingLegacyMinecraft(server.host, server.port);
      await prisma.server.update({ where: { id: server.id }, data: { status: 'online', ...result } });
    } catch {
      await prisma.server.update({ where: { id: server.id }, data: { status: 'offline', onlinePlayers: null, maxPlayers: null } });
    }
  }));
}

async function bootstrap(): Promise<void> {
  await refreshServerStatuses();
  if (process.env.WORKER_RUN_ONCE === '1') return prisma.$disconnect();
  setInterval(() => void refreshServerStatuses(), intervalMs).unref();
}
void bootstrap();

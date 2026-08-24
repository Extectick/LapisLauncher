import { Socket } from "node:net";

export type MinecraftServerStatus = {
  onlinePlayers: number;
  maxPlayers: number;
  playerNames: string[];
};

function encodeVarInt(value: number): Buffer {
  let remaining = value >>> 0;
  const output: number[] = [];
  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining !== 0) byte |= 0x80;
    output.push(byte);
  } while (remaining !== 0);
  return Buffer.from(output);
}

function encodeString(value: string): Buffer {
  const content = Buffer.from(value, "utf8");
  return Buffer.concat([encodeVarInt(content.length), content]);
}

function frame(payload: Buffer): Buffer {
  return Buffer.concat([encodeVarInt(payload.length), payload]);
}

function readVarInt(
  buffer: Buffer,
  offset: number,
): { value: number; offset: number } | null {
  let value = 0;
  let shift = 0;
  for (let index = 0; index < 5; index += 1) {
    if (offset >= buffer.length) return null;
    const byte = buffer[offset++];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, offset };
    shift += 7;
  }
  throw new Error("Minecraft status response contains an invalid VarInt.");
}

export function parseStatusResponse(
  buffer: Buffer,
): MinecraftServerStatus | null {
  const packetLength = readVarInt(buffer, 0);
  if (!packetLength) return null;
  if (packetLength.value < 1 || packetLength.value > 1024 * 1024)
    throw new Error("Minecraft status response has an invalid size.");
  if (buffer.length - packetLength.offset < packetLength.value) return null;
  const packetEnd = packetLength.offset + packetLength.value;
  const packetId = readVarInt(buffer, packetLength.offset);
  if (!packetId || packetId.value !== 0)
    throw new Error("Minecraft status response has an invalid packet id.");
  const jsonLength = readVarInt(buffer, packetId.offset);
  if (!jsonLength || jsonLength.value < 2)
    throw new Error("Minecraft status response has no JSON payload.");
  if (jsonLength.offset + jsonLength.value > packetEnd)
    throw new Error("Minecraft status response JSON is truncated.");
  const payload = JSON.parse(
    buffer
      .subarray(jsonLength.offset, jsonLength.offset + jsonLength.value)
      .toString("utf8"),
  ) as {
    players?: {
      online?: unknown;
      max?: unknown;
      sample?: { name?: unknown }[];
    };
  };
  const onlinePlayers = payload.players?.online;
  const maxPlayers = payload.players?.max;
  if (
    !Number.isInteger(onlinePlayers) ||
    !Number.isInteger(maxPlayers) ||
    (onlinePlayers as number) < 0 ||
    (maxPlayers as number) < 1
  )
    throw new Error("Minecraft status response has invalid player counts.");
  const playerNames = [
    ...new Set(
      (payload.players?.sample ?? [])
        .map((player) => player.name)
        .filter(
          (name): name is string =>
            typeof name === "string" && /^[A-Za-z0-9_]{3,16}$/.test(name),
        ),
    ),
  ].slice(0, 100);
  return {
    onlinePlayers: onlinePlayers as number,
    maxPlayers: maxPlayers as number,
    playerNames,
  };
}

export function pingMinecraftServer(
  host: string,
  port: number,
  timeoutMs = 5_000,
): Promise<MinecraftServerStatus> {
  if (!host || host.length > 255 || !Number.isInteger(port) || port < 1 || port > 65_535)
    return Promise.reject(new Error("Minecraft server address is invalid."));
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    let response = Buffer.alloc(0);
    let settled = false;
    let timer: NodeJS.Timeout;
    const finish = (error?: Error, status?: MinecraftServerStatus): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(status!);
    };
    timer = setTimeout(
      () => finish(new Error("Minecraft status ping timed out.")),
      timeoutMs,
    );
    socket.once("error", (error) => finish(error));
    socket.connect(port, host, () => {
      const handshake = Buffer.concat([
        encodeVarInt(0),
        encodeVarInt(0),
        encodeString(host),
        Buffer.from([port >> 8, port & 0xff]),
        encodeVarInt(1),
      ]);
      socket.write(frame(handshake));
      socket.write(frame(encodeVarInt(0)));
    });
    socket.on("data", (chunk) => {
      try {
        response = Buffer.concat([response, chunk]);
        if (response.length > 1024 * 1024 + 5)
          throw new Error("Minecraft status response is too large.");
        const status = parseStatusResponse(response);
        if (status) finish(undefined, status);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

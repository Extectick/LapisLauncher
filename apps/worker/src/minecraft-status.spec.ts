import { describe, expect, it } from "vitest";
import { parseStatusResponse } from "./minecraft-status";

function varInt(value: number): Buffer {
  const output: number[] = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value) byte |= 0x80;
    output.push(byte);
  } while (value);
  return Buffer.from(output);
}

function statusPacket(payload: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(payload));
  const packet = Buffer.concat([varInt(0), varInt(json.length), json]);
  return Buffer.concat([varInt(packet.length), packet]);
}

describe("Minecraft status protocol", () => {
  it("parses counts and safe player samples", () => {
    const packet = statusPacket({
      players: {
        online: 2,
        max: 10,
        sample: [
          { name: "extectick" },
          { name: "Lapis_Player" },
          { name: "invalid name" },
        ],
      },
    });
    expect(parseStatusResponse(packet)).toEqual({
      onlinePlayers: 2,
      maxPlayers: 10,
      playerNames: ["extectick", "Lapis_Player"],
    });
  });

  it("waits for a complete packet", () => {
    const packet = statusPacket({ players: { online: 0, max: 10 } });
    expect(
      parseStatusResponse(packet.subarray(0, packet.length - 1)),
    ).toBeNull();
  });
});

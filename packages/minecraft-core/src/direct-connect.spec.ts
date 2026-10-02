import { describe, expect, it } from "vitest";
import {
  directConnectLaunchOptions,
  directConnectTarget,
} from "./direct-connect";

describe("Minecraft direct connection", () => {
  it("passes the selected server and port to the game launcher", () => {
    expect(
      directConnectTarget({ host: "195.208.129.43", port: 25566 }),
    ).toEqual({ ip: "195.208.129.43", port: 25566 });
  });

  it("rejects malformed destinations", () => {
    expect(() =>
      directConnectTarget({ host: "example.org/path", port: 25566 }),
    ).toThrow("Адрес игрового сервера недопустим.");
    expect(() =>
      directConnectTarget({ host: "example.org", port: 65536 }),
    ).toThrow("Адрес игрового сервера недопустим.");
  });

  it("uses Quick Play for NeoForge 1.21.1 instead of ignored legacy arguments", () => {
    expect(
      directConnectLaunchOptions("neoforge", {
        host: "195.208.129.43",
        port: 25566,
      }),
    ).toEqual({
      extraMCArgs: ["--quickPlayMultiplayer", "195.208.129.43:25566"],
    });
  });

  it("keeps the existing Fabric connection path", () => {
    expect(
      directConnectLaunchOptions("fabric", {
        host: "195.208.129.43",
        port: 25565,
      }),
    ).toEqual({ server: { ip: "195.208.129.43", port: 25565 } });
  });
});

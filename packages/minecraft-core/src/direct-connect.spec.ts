import { describe, expect, it } from "vitest";
import { directConnectTarget } from "./direct-connect";

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
});

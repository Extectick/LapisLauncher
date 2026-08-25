import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameLaunchContext } from "@lapis/contracts";
import {
  createBridgeBootstrap,
  type BridgeBootstrap,
} from "./bridge-bootstrap";

const initial: GameLaunchContext = {
  serverId: "main",
  host: "195.208.129.43",
  port: 25565,
  buildId: "lapis-26.2-fabric-0.19.3",
  ticket: "a".repeat(43),
  expiresAt: "2026-08-25T09:00:00.000Z",
  nickname: "Extectick",
  minecraftUuid: "a".repeat(32),
  bridgeProtocolVersion: 1,
};

describe("Minecraft Bridge bootstrap", () => {
  let bootstrap: BridgeBootstrap | undefined;
  afterEach(() => bootstrap?.close());

  it("returns the launch ticket once and renews every reconnect", async () => {
    const renewed = { ...initial, ticket: "b".repeat(43) };
    const renew = vi.fn(async () => renewed);
    bootstrap = await createBridgeBootstrap(initial, renew, vi.fn());
    const request = () =>
      fetch(`http://127.0.0.1:${bootstrap!.port}/v1/launch-context`, {
        method: "POST",
        headers: { "x-lapis-bootstrap": bootstrap!.nonce },
      });

    expect(await (await request()).json()).toMatchObject({
      ticket: initial.ticket,
    });
    expect(await (await request()).json()).toMatchObject({
      ticket: renewed.ticket,
    });
    expect(renew).toHaveBeenCalledTimes(1);
  });

  it("does not expose a context without the per-process nonce", async () => {
    bootstrap = await createBridgeBootstrap(
      initial,
      async () => initial,
      vi.fn(),
    );
    const response = await fetch(
      `http://127.0.0.1:${bootstrap.port}/v1/launch-context`,
      { method: "POST" },
    );
    expect(response.status).toBe(404);
  });
});

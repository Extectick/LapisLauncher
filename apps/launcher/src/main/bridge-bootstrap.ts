import type { GameLaunchContext } from "@lapis/contracts";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";

export type BridgeBootstrap = {
  port: number;
  nonce: string;
  close: () => void;
};

function nonceMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const actual = createHash("sha256").update(provided).digest();
  const wanted = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actual, wanted);
}

function sameGame(
  context: GameLaunchContext,
  initial: GameLaunchContext,
): boolean {
  return (
    context.serverId === initial.serverId &&
    context.buildId === initial.buildId &&
    context.nickname === initial.nickname &&
    context.minecraftUuid === initial.minecraftUuid
  );
}

export async function createBridgeBootstrap(
  initialContext: GameLaunchContext,
  renewContext: () => Promise<GameLaunchContext>,
  reportError: (error: unknown) => void,
): Promise<BridgeBootstrap> {
  const nonce = randomBytes(32).toString("base64url");
  let nextContext: GameLaunchContext | null = initialContext;
  let requestInFlight = false;
  const requestTimes: number[] = [];
  let server: HttpServer | undefined;
  const close = (): void => {
    server?.close();
    server = undefined;
  };
  server = createServer((request, response) => {
    const bootstrapHeader = request.headers["x-lapis-bootstrap"];
    const validRequest =
      request.method === "POST" &&
      request.url === "/v1/launch-context" &&
      nonceMatches(
        typeof bootstrapHeader === "string" ? bootstrapHeader : undefined,
        nonce,
      );
    if (!validRequest) {
      response.writeHead(404).end();
      return;
    }
    const now = Date.now();
    while (requestTimes.length && requestTimes[0] < now - 60_000)
      requestTimes.shift();
    if (requestInFlight || requestTimes.length >= 20) {
      response.writeHead(429, { "cache-control": "no-store" }).end();
      return;
    }
    requestTimes.push(now);
    requestInFlight = true;
    void (async () => {
      try {
        const context = nextContext ?? (await renewContext());
        nextContext = null;
        if (!sameGame(context, initialContext))
          throw new Error(
            "Refreshed launch context does not match the running game",
          );
        const payload = JSON.stringify(context);
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "content-length": Buffer.byteLength(payload),
        });
        response.end(payload);
      } catch (error) {
        reportError(error);
        if (!response.headersSent)
          response.writeHead(503, { "cache-control": "no-store" });
        response.end();
      } finally {
        requestInFlight = false;
      }
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server?.once("error", reject);
    server?.listen(0, "127.0.0.1", () => resolve());
  });
  return { port: (server.address() as AddressInfo).port, nonce, close };
}

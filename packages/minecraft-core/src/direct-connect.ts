export type DirectConnectServer = { host: string; port: number };

export function directConnectTarget(
  server: DirectConnectServer,
): { ip: string; port: number } {
  if (
    !server.host ||
    /[\s/\\]/.test(server.host) ||
    !Number.isInteger(server.port) ||
    server.port < 1 ||
    server.port > 65535
  ) {
    throw new Error("Адрес игрового сервера недопустим.");
  }
  return { ip: server.host, port: server.port };
}

export function directConnectLaunchOptions(
  loader: "fabric" | "neoforge",
  server: DirectConnectServer,
):
  | { server: { ip: string; port: number } }
  | { extraMCArgs: string[] } {
  const target = directConnectTarget(server);
  if (loader === "neoforge") {
    // Minecraft 1.21.1 ignores the older --server/--port arguments. Quick Play
    // is its supported direct-connect entry point.
    return {
      extraMCArgs: ["--quickPlayMultiplayer", `${target.ip}:${target.port}`],
    };
  }
  return { server: target };
}

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

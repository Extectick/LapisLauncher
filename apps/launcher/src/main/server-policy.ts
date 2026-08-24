export type NicknameServerTarget = Readonly<{
  host: string;
  port: number;
}>;

const NICKNAME_SERVER_TARGETS: Readonly<Record<string, NicknameServerTarget>> =
  Object.freeze({
    main: Object.freeze({ host: "195.208.129.43", port: 25565 }),
  });

export function nicknameServerTarget(
  serverId: string,
): NicknameServerTarget | null {
  return NICKNAME_SERVER_TARGETS[serverId] ?? null;
}

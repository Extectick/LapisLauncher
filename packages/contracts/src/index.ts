import { z } from "zod";

export const nicknameSchema = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9_]{3,16}$/,
    "Ник должен состоять из 3–16 латинских букв, цифр или символов подчёркивания.",
  );

export const passwordSchema = z
  .string()
  .min(6, "Пароль должен содержать не менее 6 символов.");

export const registerSchema = z.object({
  nickname: nicknameSchema,
  password: passwordSchema,
});
export const loginSchema = z.object({
  nickname: nicknameSchema,
  password: z.string().min(1),
});
export const refreshSchema = z.object({ refreshToken: z.string().min(1) });
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export const serverCatalogItemSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  iconUrl: z.string().url(),
  build: z.object({
    id: z.string(),
    name: z.string(),
    minecraftVersion: z.string(),
    loader: z.literal("fabric"),
    loaderVersion: z.string(),
    modCount: z.number().int().nonnegative(),
  }),
  maintenance: z.boolean(),
  status: z.enum(["unknown", "online", "offline"]),
  onlinePlayers: z.number().int().nonnegative().nullable(),
  maxPlayers: z.number().int().positive().nullable(),
});
export type ServerCatalogItem = z.infer<typeof serverCatalogItemSchema>;

export const playerSkinSchema = z.object({
  textureUrl: z.string().url(),
  model: z.enum(["default", "slim"]),
});
export type PlayerSkin = z.infer<typeof playerSkinSchema>;

export const skinUploadSchema = z.object({
  pngBase64: z.string().min(1).max(28_000),
});
export type SkinUploadInput = z.infer<typeof skinUploadSchema>;

export const gameInstallManifestSchema = z.object({
  id: z.string(),
  minecraftVersion: z.string(),
  loader: z.literal("fabric"),
  loaderVersion: z.string(),
  mods: z.array(
    z.object({
      fileName: z.string(),
      url: z.string().url(),
      sha1: z.string().regex(/^[a-f0-9]{40}$/i),
      required: z.boolean(),
    }),
  ),
});
export type GameInstallManifest = z.infer<typeof gameInstallManifestSchema>;

export const signedInstallManifestSchema = z.object({
  keyId: z.string().min(1),
  payload: gameInstallManifestSchema,
  signature: z.string().regex(/^[A-Za-z0-9_-]+$/),
});
export type SignedInstallManifest = z.infer<typeof signedInstallManifestSchema>;

export const gameTicketSchema = z.object({
  ticket: z.string().min(32),
  expiresAt: z.string().datetime(),
});
export type GameTicket = z.infer<typeof gameTicketSchema>;

// This is returned only to Electron main process and is never exposed to the renderer.
export const gameLaunchContextSchema = gameTicketSchema.extend({
  serverId: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  buildId: z.string().min(1).max(64),
  bridgeProtocolVersion: z.literal(1),
});
export type GameLaunchContext = z.infer<typeof gameLaunchContextSchema>;

export const consumeGameTicketSchema = z.object({
  ticket: z.string().min(32),
  serverId: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
});
export type ConsumedGameTicket = { userId: string; nickname: string };

export function canonicalInstallManifest(
  manifest: GameInstallManifest,
): string {
  return JSON.stringify({
    id: manifest.id,
    minecraftVersion: manifest.minecraftVersion,
    loader: manifest.loader,
    loaderVersion: manifest.loaderVersion,
    mods: manifest.mods.map((mod) => ({
      fileName: mod.fileName,
      url: mod.url,
      sha1: mod.sha1,
      required: mod.required,
    })),
  });
}

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

export const permissionKeys = [
  "admin.access",
  "servers.read",
  "servers.write",
  "mods.read",
  "mods.write",
  "mods.archive",
  "builds.read",
  "builds.write",
  "builds.publish",
  "builds.activate",
  "deployments.read",
  "deployments.execute",
  "audit.read",
  "roles.read",
  "roles.manage",
] as const;
export const permissionKeySchema = z.enum(permissionKeys);
export type PermissionKey = z.infer<typeof permissionKeySchema>;

export const authorizationSnapshotSchema = z.object({
  isSuperAdmin: z.boolean(),
  roles: z.array(
    z.object({
      key: z.string().min(1).max(64),
      scopeType: z.enum(["GLOBAL", "SERVER"]),
      scopeId: z.string().min(1).max(32).nullable(),
    }),
  ),
  globalPermissions: z.array(permissionKeySchema),
  serverPermissions: z.array(
    z.object({
      serverId: z.string().min(1).max(32),
      permissions: z.array(permissionKeySchema),
    }),
  ),
});
export type AuthorizationSnapshot = z.infer<typeof authorizationSnapshotSchema>;

export const currentUserSchema = z.object({
  user: z.object({ id: z.string().uuid(), nickname: nicknameSchema }),
  authorization: authorizationSnapshotSchema,
});
export type CurrentUser = z.infer<typeof currentUserSchema>;

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

export const adminServerSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  slug: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  iconUrl: z.string().url(),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  visible: z.boolean(),
  maintenance: z.boolean(),
  status: z.enum(["unknown", "online", "offline"]),
  onlinePlayers: z.number().int().nonnegative().nullable(),
  maxPlayers: z.number().int().positive().nullable(),
  updatedAt: z.string().datetime(),
  activeBuild: z.object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(80),
    minecraftVersion: z.string().min(1).max(32),
    loader: z.literal("fabric"),
    loaderVersion: z.string().min(1).max(32),
    modCount: z.number().int().nonnegative(),
  }),
});
export type AdminServer = z.infer<typeof adminServerSchema>;

const serverIdSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9_-]{0,31}$/,
    "ID: до 32 строчных латинских символов, цифр, - или _.",
  );
const serverHostSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (value) => !/[\s/\\]/.test(value),
    "Укажите адрес без протокола и пути.",
  );

export const adminServerCreateSchema = z.object({
  id: serverIdSchema,
  name: z.string().trim().min(1).max(80),
  host: serverHostSchema,
  port: z.number().int().min(1).max(65535),
  visible: z.boolean(),
  templateServerId: serverIdSchema.optional(),
});
export type AdminServerCreateInput = z.infer<typeof adminServerCreateSchema>;

export const adminServerUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    host: serverHostSchema.optional(),
    port: z.number().int().min(1).max(65535).optional(),
    visible: z.boolean().optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "Нет изменений для сохранения.",
  );
export type AdminServerUpdateInput = z.infer<typeof adminServerUpdateSchema>;

export const adminClientModSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,179}\.jar$/i),
  sha1: z.string().regex(/^[a-f0-9]{40}$/i),
  size: z
    .number()
    .int()
    .nonnegative()
    .max(128 * 1024 * 1024),
  enabled: z.boolean(),
  uploadedAt: z.string().datetime(),
  compatibility: z.object({
    status: z.enum(["compatible", "incompatible", "unknown"]),
    reason: z.string().min(1).max(240),
    modId: z.string().max(128).nullable(),
    modVersion: z.string().max(128).nullable(),
    environment: z.enum(["client", "server", "universal", "unknown"]),
    minecraftRequirement: z.string().max(240).nullable(),
    loaderRequirement: z.string().max(240).nullable(),
  }),
});
export type AdminClientMod = z.infer<typeof adminClientModSchema>;

export const adminClientModUpdateSchema = z.object({ enabled: z.boolean() });
export type AdminClientModUpdateInput = z.infer<
  typeof adminClientModUpdateSchema
>;

export const adminClientModDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
});
export type AdminClientModDeleteInput = z.infer<
  typeof adminClientModDeleteSchema
>;

export const adminClientModDeleteResultSchema = z.object({
  deletedIds: z.array(z.string().uuid()).min(1).max(100),
});
export type AdminClientModDeleteResult = z.infer<
  typeof adminClientModDeleteResultSchema
>;

export const serverModSchema = z.object({
  fileName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,179}\.jar$/i),
  required: z.boolean(),
});
export type ServerMod = z.infer<typeof serverModSchema>;

export const playerSkinSchema = z.object({
  textureUrl: z.string().url(),
  model: z.enum(["default", "slim"]),
});
export type PlayerSkin = z.infer<typeof playerSkinSchema>;

export const signedPlayerSkinSchema = playerSkinSchema.extend({
  value: z
    .string()
    .min(64)
    .max(8192)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  signature: z
    .string()
    .min(64)
    .max(2048)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
});
export type SignedPlayerSkin = z.infer<typeof signedPlayerSkinSchema>;

export const serverPlayerSchema = z.object({
  nickname: nicknameSchema,
  skin: playerSkinSchema,
});
export type ServerPlayer = z.infer<typeof serverPlayerSchema>;

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
      fileName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,179}\.jar$/i),
      url: z.string().url(),
      sha1: z.string().regex(/^[a-f0-9]{40}$/i),
      size: z
        .number()
        .int()
        .nonnegative()
        .max(1024 * 1024 * 1024)
        .default(0),
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
  serverName: z.string().trim().min(1).max(80),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  buildId: z.string().min(1).max(64),
  // The API owns the canonical casing of a nickname. Minecraft offline UUIDs
  // are case-sensitive, so the launcher must never derive this identity from
  // the spelling entered on the login screen or from a stale local session.
  nickname: nicknameSchema,
  minecraftUuid: z.string().regex(/^[a-f0-9]{32}$/),
  bridgeProtocolVersion: z.literal(1),
});
export type GameLaunchContext = z.infer<typeof gameLaunchContextSchema>;

export const consumeGameTicketSchema = z.object({
  ticket: z.string().min(32),
  serverId: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
});
export const consumedGameTicketSchema = z.object({
  userId: z.string().uuid(),
  nickname: nicknameSchema,
});
export type ConsumedGameTicket = z.infer<typeof consumedGameTicketSchema>;

export const consumedGameTicketWithSkinSchema = consumedGameTicketSchema.extend(
  {
    minecraftUuid: z.string().regex(/^[a-f0-9]{32}$/),
    skin: signedPlayerSkinSchema.nullable(),
  },
);
export type ConsumedGameTicketWithSkin = z.infer<
  typeof consumedGameTicketWithSkinSchema
>;

export function canonicalInstallManifest(
  manifest: GameInstallManifest,
): string {
  // Manifest v1 intentionally keeps size outside the signed canonical payload:
  // 0.1.7 clients must be able to verify manifests produced by the new API.
  // SHA-1 remains signed and is still the source of truth for file integrity.
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

import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  PlayerSkin,
  SignedPlayerSkin,
  signedPlayerSkinSchema,
} from "@lapis/contracts";
import { PrismaService } from "../prisma.service";

const DEFAULT_SKIN: PlayerSkin = {
  textureUrl:
    "https://textures.minecraft.net/texture/6d3b06c38504ffc0229b9492147c69fcf59fd2ed7885f78502152f77b4d50de1",
  model: "default",
};
const SKIN_RESTORER_DIRECTORY =
  process.env.LAPIS_SKIN_RESTORER_DIRECTORY ??
  join(
    process.env.LAPIS_SERVER_ROOT ?? "V:\\LapisServer",
    "world",
    "skinrestorer",
  );
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const MAX_SKIN_BYTES = 20 * 1024;
const MIN_GENERATION_INTERVAL_MS = 3_000;
const MAX_QUEUED_GENERATIONS = 5;

type StoredSkin = {
  value?: { value?: string; signature?: string };
};
type TexturePayload = {
  textures?: { SKIN?: { url?: string; metadata?: { model?: string } } };
};
type MineSkinResponse = {
  success?: boolean;
  skin?: { texture?: { data?: { value?: string; signature?: string } } };
  errors?: Array<{ message?: string }>;
};

class SkinRateLimitException extends HttpException {
  constructor(message: string) {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}

function offlinePlayerUuid(nickname: string): string {
  const hash = createHash("md5")
    .update(`OfflinePlayer:${nickname}`, "utf8")
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const value = hash.toString("hex");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function skinFromStoredValue(value: string | undefined): PlayerSkin | null {
  if (!value) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(value, "base64").toString("utf8"),
    ) as TexturePayload;
    const source = payload.textures?.SKIN;
    if (!source?.url) return null;
    const url = new URL(source.url);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.hostname !== "textures.minecraft.net" ||
      !/^\/texture\/[a-f0-9]{64}$/i.test(url.pathname)
    )
      return null;
    url.protocol = "https:";
    return {
      textureUrl: url.toString(),
      model: source.metadata?.model === "slim" ? "slim" : "default",
    };
  } catch {
    return null;
  }
}

function signedSkinFromStoredValue(
  value: string | undefined,
  signature: string | undefined,
): SignedPlayerSkin | null {
  const skin = skinFromStoredValue(value);
  if (!skin || !value || !signature) return null;
  const parsed = signedPlayerSkinSchema.safeParse({
    ...skin,
    value,
    signature,
  });
  return parsed.success ? parsed.data : null;
}

function parseMinecraftSkin(pngBase64: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(pngBase64) || pngBase64.length % 4 !== 0)
    throw new BadRequestException("Файл скина повреждён.");
  const png = Buffer.from(pngBase64, "base64");
  if (
    png.length < 33 ||
    png.length > MAX_SKIN_BYTES ||
    !png.subarray(0, 8).equals(PNG_SIGNATURE)
  )
    throw new BadRequestException("Загрузите PNG-скин размером до 20 КБ.");
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width !== 64 || (height !== 64 && height !== 32))
    throw new BadRequestException("Подходит только скин PNG 64×64 или 64×32.");
  return png;
}

@Injectable()
export class SkinService {
  private readonly logger = new Logger(SkinService.name);
  private readonly lastUploadByUser = new Map<string, number>();
  private queueDepth = 0;
  private nextGenerationAt = 0;
  private queueTail: Promise<void> = Promise.resolve();

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getSkin(nickname: string, userId?: string): Promise<PlayerSkin> {
    const stored = userId
      ? await this.getSignedSkin(userId, nickname)
      : await this.getSignedSkinByNickname(nickname);
    return stored
      ? { textureUrl: stored.textureUrl, model: stored.model }
      : DEFAULT_SKIN;
  }

  async getSignedSkin(
    userId: string,
    nickname: string,
  ): Promise<SignedPlayerSkin | null> {
    const stored = await this.prisma.userSkin.findUnique({
      where: { userId },
      select: {
        textureValue: true,
        textureSignature: true,
        textureUrl: true,
        model: true,
      },
    });
    if (stored) {
      const parsed = signedPlayerSkinSchema.safeParse({
        value: stored.textureValue,
        signature: stored.textureSignature,
        textureUrl: stored.textureUrl,
        model: stored.model,
      });
      if (parsed.success) return parsed.data;
      this.logger.error(`Stored skin is invalid for user ${userId}.`);
    }

    const legacy = await this.readLegacySkin(nickname);
    if (!legacy) return null;
    await this.saveDatabaseSkin(userId, legacy).catch((error: unknown) => {
      this.logger.warn(
        `Could not migrate the legacy skin for user ${userId}: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    });
    return legacy;
  }

  private async getSignedSkinByNickname(
    nickname: string,
  ): Promise<SignedPlayerSkin | null> {
    const user = await this.prisma.user.findUnique({
      where: { nicknameFold: nickname.toLocaleLowerCase("en-US") },
      select: { id: true, nickname: true },
    });
    return user
      ? this.getSignedSkin(user.id, user.nickname)
      : this.readLegacySkin(nickname);
  }

  private async readLegacySkin(
    nickname: string,
  ): Promise<SignedPlayerSkin | null> {
    try {
      const raw = await readFile(
        join(SKIN_RESTORER_DIRECTORY, `${offlinePlayerUuid(nickname)}.json`),
        "utf8",
      );
      const value = (JSON.parse(raw) as StoredSkin).value;
      return signedSkinFromStoredValue(value?.value, value?.signature);
    } catch {
      return null;
    }
  }

  private saveDatabaseSkin(
    userId: string,
    skin: SignedPlayerSkin,
  ): Promise<unknown> {
    return this.prisma.userSkin.upsert({
      where: { userId },
      create: {
        userId,
        textureValue: skin.value,
        textureSignature: skin.signature,
        textureUrl: skin.textureUrl,
        model: skin.model,
      },
      update: {
        textureValue: skin.value,
        textureSignature: skin.signature,
        textureUrl: skin.textureUrl,
        model: skin.model,
      },
    });
  }

  private async saveUploadedSkin(
    userId: string,
    nickname: string,
    skin: SignedPlayerSkin,
  ): Promise<void> {
    await this.saveDatabaseSkin(userId, skin);
    await this.storeSkin(nickname, skin.value, skin.signature).catch(
      (error: unknown) => {
        this.logger.warn(
          `Could not write the compatibility skin file for user ${userId}: ${error instanceof Error ? error.message : "unknown error"}`,
        );
      },
    );
  }

  private parseGeneratedSkin(
    value: string,
    signature: string,
  ): SignedPlayerSkin {
    const skin = signedSkinFromStoredValue(value, signature);
    if (!skin)
      throw new ServiceUnavailableException(
        "MineSkin вернул некорректную текстуру.",
      );
    return skin;
  }

  async uploadSkin(
    userId: string,
    nickname: string,
    pngBase64: string,
  ): Promise<PlayerSkin> {
    const now = Date.now();
    const retryIn =
      MIN_GENERATION_INTERVAL_MS -
      (now - (this.lastUploadByUser.get(userId) ?? 0));
    if (retryIn > 0)
      throw new SkinRateLimitException(
        `Повторите загрузку через ${Math.ceil(retryIn / 1000)} сек.`,
      );
    if (this.queueDepth >= MAX_QUEUED_GENERATIONS)
      throw new SkinRateLimitException(
        "Очередь загрузки занята. Повторите через несколько секунд.",
      );
    const png = parseMinecraftSkin(pngBase64);
    this.lastUploadByUser.set(userId, now);
    this.queueDepth += 1;
    let release!: () => void;
    const previous = this.queueTail;
    this.queueTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      const wait = this.nextGenerationAt - Date.now();
      if (wait > 0)
        await new Promise<void>((resolve) => setTimeout(resolve, wait));
      const generated = await this.generateWithMineSkin(png, nickname);
      this.nextGenerationAt = Date.now() + MIN_GENERATION_INTERVAL_MS;
      const skin = this.parseGeneratedSkin(
        generated.value,
        generated.signature,
      );
      await this.saveUploadedSkin(userId, nickname, skin);
      return { textureUrl: skin.textureUrl, model: skin.model };
    } finally {
      this.queueDepth -= 1;
      release();
    }
  }

  private async generateWithMineSkin(
    png: Buffer,
    nickname: string,
  ): Promise<{ value: string; signature: string }> {
    const apiKey = process.env.LAPIS_MINESKIN_API_KEY;
    if (!apiKey)
      throw new ServiceUnavailableException(
        "Загрузка скинов ещё не настроена.",
      );
    const form = new FormData();
    const image = new Uint8Array(png.byteLength);
    image.set(png);
    form.set("file", new Blob([image], { type: "image/png" }), "skin.png");
    form.set("name", `Lapis-${nickname}`.slice(0, 20));
    form.set("visibility", "unlisted");
    try {
      const response = await fetch("https://api.mineskin.org/v2/generate", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "mineskin-user-agent": "LapisLauncher/0.1.0",
        },
        body: form,
      });
      const payload = (await response
        .json()
        .catch(() => null)) as MineSkinResponse | null;
      if (response.status === 429)
        throw new SkinRateLimitException(
          "Лимит генерации скинов исчерпан. Повторите чуть позже.",
        );
      if (!response.ok || !payload?.success)
        throw new BadRequestException(
          payload?.errors?.[0]?.message ??
            "MineSkin не смог обработать этот файл.",
        );
      const value = payload.skin?.texture?.data?.value;
      const signature = payload.skin?.texture?.data?.signature;
      if (!value || !signature || !skinFromStoredValue(value))
        throw new ServiceUnavailableException(
          "MineSkin вернул некорректную текстуру.",
        );
      return { value, signature };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof SkinRateLimitException ||
        error instanceof ServiceUnavailableException
      )
        throw error;
      throw new ServiceUnavailableException(
        "Не удалось связаться с MineSkin. Повторите позже.",
      );
    }
  }

  private async storeSkin(
    nickname: string,
    value: string,
    signature: string,
  ): Promise<void> {
    await mkdir(SKIN_RESTORER_DIRECTORY, { recursive: true });
    const path = join(
      SKIN_RESTORER_DIRECTORY,
      `${offlinePlayerUuid(nickname)}.json`,
    );
    const temporary = `${path}.new`;
    await writeFile(
      temporary,
      JSON.stringify({
        provider: "mineskin",
        argument: `lapis:${nickname}`,
        value: { name: "textures", value, signature },
        version: 1,
      }),
      { encoding: "utf8", mode: 0o600 },
    );
    await rename(temporary, path);
  }
}

import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { GameTicket, gameTicketSchema } from "@lapis/contracts";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { PrismaService } from "../prisma.service";

const TICKET_TTL_MS = 60_000;

@Injectable()
export class GameTicketsService {
  private readonly pepper = process.env.LAPIS_REFRESH_TOKEN_PEPPER ?? "";

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async issue(userId: string, serverId: string): Promise<GameTicket> {
    const server = await this.prisma.server.findFirst({
      where: { id: serverId, visible: true, maintenance: false },
      select: { id: true },
    });
    if (!server) throw new ForbiddenException("Сервер недоступен.");
    const ticket = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + TICKET_TTL_MS);
    await this.prisma.gameTicket.create({
      data: { tokenHash: this.hash(ticket), expiresAt, userId, serverId },
    });
    return gameTicketSchema.parse({
      ticket,
      expiresAt: expiresAt.toISOString(),
    });
  }

  async canonicalProfile(
    userId: string,
  ): Promise<{ nickname: string; minecraftUuid: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { nickname: true },
    });
    if (!user) throw new UnauthorizedException("Профиль игрока не найден.");
    return {
      nickname: user.nickname,
      minecraftUuid: createHash("md5")
        .update(`OfflinePlayer:${user.nickname}`)
        .digest("hex"),
    };
  }

  async consume(
    ticket: string,
    serverId: string,
  ): Promise<{
    userId: string;
    nickname: string;
    minecraftUuid: string;
  }> {
    const result = await this.prisma.gameTicket.updateMany({
      where: {
        tokenHash: this.hash(ticket),
        serverId,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    });
    if (result.count !== 1)
      throw new UnauthorizedException(
        "Игровой билет недействителен или истёк.",
      );
    const consumed = await this.prisma.gameTicket.findUnique({
      where: { tokenHash: this.hash(ticket) },
      select: { userId: true, user: { select: { nickname: true } } },
    });
    if (!consumed)
      throw new UnauthorizedException("Игровой билет недействителен.");
    return {
      userId: consumed.userId,
      nickname: consumed.user.nickname,
      minecraftUuid: createHash("md5")
        .update(`OfflinePlayer:${consumed.user.nickname}`)
        .digest("hex"),
    };
  }

  private hash(ticket: string): string {
    return createHmac("sha256", this.pepper).update(ticket).digest("hex");
  }
}

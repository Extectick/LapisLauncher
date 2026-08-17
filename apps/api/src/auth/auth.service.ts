import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { LoginInput, RegisterInput } from '@lapis/contracts';
import { PrismaService } from '../prisma.service';

const RESERVED_NICKNAMES = new Set(['admin', 'administrator', 'lapis', 'system', 'support']);
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type AuthResult = {
  user: { id: string; nickname: string };
  accessToken: string;
  refreshToken: string;
};

@Injectable()
export class AuthService {
  private readonly refreshPepper: string;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwt: JwtService,
  ) {
    this.refreshPepper = process.env.LAPIS_REFRESH_TOKEN_PEPPER ?? '';
    if (this.refreshPepper.length < 32) {
      throw new Error('LAPIS_REFRESH_TOKEN_PEPPER must contain at least 32 characters.');
    }
  }

  async register(input: RegisterInput): Promise<AuthResult> {
    const nicknameFold = input.nickname.toLocaleLowerCase('en-US');
    if (RESERVED_NICKNAMES.has(nicknameFold)) {
      throw new ConflictException('Этот ник зарезервирован.');
    }

    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    try {
      const user = await this.prisma.user.create({
        data: { nickname: input.nickname, nicknameFold, passwordHash },
      });
      return this.issueSession(user);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Этот ник уже занят.');
      }
      throw error;
    }
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({
      where: { nicknameFold: input.nickname.toLocaleLowerCase('en-US') },
    });
    if (!user || !(await argon2.verify(user.passwordHash, input.password))) {
      throw new UnauthorizedException('Неверный ник или пароль.');
    }
    return this.issueSession(user);
  }

  async refresh(refreshToken: string): Promise<AuthResult> {
    const tokenHash = this.hashRefreshToken(refreshToken);
    const session = await this.prisma.session.findFirst({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { user: true },
    });
    if (!session) {
      throw new UnauthorizedException('Сессия недействительна или истекла.');
    }

    const rotated = this.newRefreshToken();
    const result = await this.prisma.session.updateMany({
      where: { id: session.id, tokenHash, revokedAt: null },
      data: { tokenHash: this.hashRefreshToken(rotated), expiresAt: this.refreshExpiry() },
    });
    if (result.count !== 1) {
      throw new UnauthorizedException('Сессия уже была обновлена.');
    }
    return this.authResult(session.user, rotated);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { tokenHash: this.hashRefreshToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async accessUser(authorization: string | undefined): Promise<{ id: string; nickname: string }> {
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) throw new UnauthorizedException('Требуется авторизация.');
    try {
      const payload = await this.jwt.verifyAsync<{ sub?: string; nickname?: string }>(token);
      if (!payload.sub || !payload.nickname) throw new Error('Invalid token payload');
      return { id: payload.sub, nickname: payload.nickname };
    } catch {
      throw new UnauthorizedException('Сессия истекла. Войдите снова.');
    }
  }

  private async issueSession(user: { id: string; nickname: string }): Promise<AuthResult> {
    const refreshToken = this.newRefreshToken();
    await this.prisma.session.create({
      data: { id: randomUUID(), userId: user.id, tokenHash: this.hashRefreshToken(refreshToken), expiresAt: this.refreshExpiry() },
    });
    return this.authResult(user, refreshToken);
  }

  private authResult(user: { id: string; nickname: string }, refreshToken: string): AuthResult {
    return {
      user: { id: user.id, nickname: user.nickname },
      accessToken: this.jwt.sign({ sub: user.id, nickname: user.nickname }),
      refreshToken,
    };
  }

  private newRefreshToken(): string {
    return randomBytes(48).toString('base64url');
  }

  private hashRefreshToken(token: string): string {
    return createHmac('sha256', this.refreshPepper).update(token).digest('hex');
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + REFRESH_TTL_MS);
  }
}

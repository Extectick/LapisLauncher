import '../src/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { canonicalInstallManifest } from '@lapis/contracts';
import { verify } from 'node:crypto';

const DEVELOPMENT_MANIFEST_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAGKwnxT59diFYHRUHn4Fgd0MO7Y/BfHa8P44p5NSXgMw=
-----END PUBLIC KEY-----`;

function assertIsolatedTestDatabase(): void {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || process.env.RUN_DATABASE_TESTS !== '1') {
    throw new Error('E2E tests require the dedicated test environment. Use `pnpm test`.');
  }
  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, '');
  if (databaseName !== 'lapis_test') {
    throw new Error(`Refusing to run destructive tests against database "${databaseName}". Expected "lapis_test".`);
  }
}

describe.skipIf(process.env.RUN_DATABASE_TESTS !== '1')('auth API', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    assertIsolatedTestDatabase();
    process.env.LAPIS_ACCESS_TOKEN_SECRET ??= 'test-access-secret-with-at-least-32-characters';
    process.env.LAPIS_REFRESH_TOKEN_PEPPER ??= 'test-refresh-pepper-with-at-least-32-characters';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = app.get(PrismaService);
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('registers a user, prevents case-insensitive duplicates, and logs in', async () => {
    const registration = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { nickname: 'LapisPlayer', password: 'StrongPassword42' },
    });
    expect(registration.statusCode).toBe(201);
    const registered = registration.json();
    expect(registered.user.nickname).toBe('LapisPlayer');
    expect(registered.accessToken).toBeTypeOf('string');
    expect(registered.refreshToken).toBeTypeOf('string');

    const duplicate = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { nickname: 'lapisplayer', password: 'StrongPassword42' },
    });
    expect(duplicate.statusCode).toBe(409);

    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { nickname: 'LAPISPLAYER', password: 'StrongPassword42' },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().user.nickname).toBe('LapisPlayer');
  });

  it('rotates a refresh token and rejects its previous value', async () => {
    const registration = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { nickname: 'RefreshUser', password: 'Abc123' },
    });
    const firstRefresh = registration.json().refreshToken as string;
    const refresh = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: firstRefresh } });
    expect(refresh.statusCode).toBe(200);
    expect(refresh.json().refreshToken).not.toBe(firstRefresh);

    const reused = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: firstRefresh } });
    expect(reused.statusCode).toBe(401);
  });

  it('returns the seeded Lapis server without exposing its address', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/servers' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'main', name: 'Lapis', build: expect.objectContaining({ id: 'lapis-26.2-fabric-0.19.3', minecraftVersion: '26.2', loader: 'fabric', loaderVersion: '0.19.3', modCount: 0 }), status: expect.any(String) }),
    ]));
    expect(response.payload).not.toContain('195.208.129.43');

    const manifest = await app.inject({ method: 'GET', url: '/v1/servers/main/install-manifest' });
    expect(manifest.statusCode).toBe(200);
    expect(manifest.json()).toEqual(expect.objectContaining({
      keyId: expect.any(String), signature: expect.any(String),
      payload: { id: 'lapis-26.2-fabric-0.19.3', minecraftVersion: '26.2', loader: 'fabric', loaderVersion: '0.19.3', mods: [] },
    }));
    const signedManifest = manifest.json();
    expect(verify(null, Buffer.from(canonicalInstallManifest(signedManifest.payload)), DEVELOPMENT_MANIFEST_PUBLIC_KEY, Buffer.from(signedManifest.signature, 'base64url'))).toBe(true);
  });

  it('issues a short-lived single-use ticket only to an authenticated launcher', async () => {
    const registration = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { nickname: 'TicketUser', password: 'Abc123' } });
    const accessToken = registration.json().accessToken as string;
    const issued = await app.inject({ method: 'POST', url: '/v1/servers/main/game-ticket', headers: { authorization: `Bearer ${accessToken}` } });
    expect(issued.statusCode).toBe(201);
    const ticket = issued.json().ticket as string;

    const denied = await app.inject({ method: 'POST', url: '/v1/game-tickets/consume', payload: { ticket, serverId: 'main' } });
    expect(denied.statusCode).toBe(403);

    const consumed = await app.inject({ method: 'POST', url: '/v1/game-tickets/consume', headers: { 'x-lapis-bridge-key': 'lapis-dev-bridge-key-change-in-production' }, payload: { ticket, serverId: 'main' } });
    expect(consumed.statusCode).toBe(200);
    expect(consumed.json()).toEqual(expect.objectContaining({ nickname: 'TicketUser' }));

    const reused = await app.inject({ method: 'POST', url: '/v1/game-tickets/consume', headers: { 'x-lapis-bridge-key': 'lapis-dev-bridge-key-change-in-production' }, payload: { ticket, serverId: 'main' } });
    expect(reused.statusCode).toBe(401);
  });
});

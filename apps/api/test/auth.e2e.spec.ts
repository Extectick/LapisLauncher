import "../src/env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma.service";
import { canonicalInstallManifest } from "@lapis/contracts";
import { createHash, verify } from "node:crypto";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import multipart from "@fastify/multipart";
import AdmZip from "adm-zip";

const DEVELOPMENT_MANIFEST_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAGKwnxT59diFYHRUHn4Fgd0MO7Y/BfHa8P44p5NSXgMw=
-----END PUBLIC KEY-----`;

function assertIsolatedTestDatabase(): void {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || process.env.RUN_DATABASE_TESTS !== "1") {
    throw new Error(
      "E2E tests require the dedicated test environment. Use `pnpm test`.",
    );
  }
  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "");
  if (databaseName !== "lapis_test") {
    throw new Error(
      `Refusing to run destructive tests against database "${databaseName}". Expected "lapis_test".`,
    );
  }
}

describe.skipIf(process.env.RUN_DATABASE_TESTS !== "1")("auth API", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    assertIsolatedTestDatabase();
    process.env.LAPIS_ACCESS_TOKEN_SECRET ??=
      "test-access-secret-with-at-least-32-characters";
    process.env.LAPIS_REFRESH_TOKEN_PEPPER ??=
      "test-refresh-pepper-with-at-least-32-characters";
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.register(multipart, {
      limits: { files: 1, fields: 0, parts: 1, fileSize: 128 * 1024 * 1024 },
      throwFileSizeLimit: true,
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = app.get(PrismaService);
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it("registers a user, prevents case-insensitive duplicates, and logs in", async () => {
    const registration = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { nickname: "LapisPlayer", password: "StrongPassword42" },
    });
    expect(registration.statusCode).toBe(201);
    const registered = registration.json();
    expect(registered.user.nickname).toBe("LapisPlayer");
    expect(registered.accessToken).toBeTypeOf("string");
    expect(registered.refreshToken).toBeTypeOf("string");

    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { nickname: "lapisplayer", password: "StrongPassword42" },
    });
    expect(duplicate.statusCode).toBe(409);

    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { nickname: "LAPISPLAYER", password: "StrongPassword42" },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().user.nickname).toBe("LapisPlayer");
  });

  it("rotates a refresh token and rejects its previous value", async () => {
    const registration = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { nickname: "RefreshUser", password: "Abc123" },
    });
    const firstRefresh = registration.json().refreshToken as string;
    const refresh = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refreshToken: firstRefresh },
    });
    expect(refresh.statusCode).toBe(200);
    expect(refresh.json().refreshToken).not.toBe(firstRefresh);

    const reused = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refreshToken: firstRefresh },
    });
    expect(reused.statusCode).toBe(401);
  });

  it("enforces admin permissions and grants full access through super_admin", async () => {
    const anonymousMe = await app.inject({ method: "GET", url: "/v1/me" });
    expect(anonymousMe.statusCode).toBe(401);

    const registration = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { nickname: "AdminCandidate", password: "Abc123" },
    });
    expect(registration.statusCode).toBe(201);
    const accessToken = registration.json().accessToken as string;
    const userId = registration.json().user.id as string;

    const regularMe = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(regularMe.statusCode).toBe(200);
    expect(regularMe.json().authorization).toEqual({
      isSuperAdmin: false,
      roles: [],
      globalPermissions: [],
      serverPermissions: [],
    });

    const denied = await app.inject({
      method: "GET",
      url: "/v1/admin/servers",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(denied.statusCode).toBe(403);

    const superAdmin = await prisma.role.findUniqueOrThrow({
      where: { key: "super_admin" },
      select: { id: true },
    });
    await prisma.userRole.create({
      data: {
        userId,
        roleId: superAdmin.id,
        scopeType: "GLOBAL",
      },
    });

    const adminMe = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(adminMe.statusCode).toBe(200);
    expect(adminMe.json().authorization).toEqual(
      expect.objectContaining({
        isSuperAdmin: true,
        roles: [
          expect.objectContaining({ key: "super_admin", scopeType: "GLOBAL" }),
        ],
      }),
    );

    const allowed = await app.inject({
      method: "GET",
      url: "/v1/admin/servers",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "main",
          host: expect.any(String),
          activeBuild: expect.objectContaining({
            modCount: expect.any(Number),
          }),
        }),
      ]),
    );
  });

  it("returns the seeded Lapis server without exposing its address", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/servers" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "main",
          name: "Lapis",
          build: expect.objectContaining({
            id: "lapis-26.2-fabric-0.19.3",
            minecraftVersion: "26.2",
            loader: "fabric",
            loaderVersion: "0.19.3",
            modCount: 0,
          }),
          status: expect.any(String),
        }),
      ]),
    );
    expect(response.payload).not.toContain("195.208.129.43");

    const manifest = await app.inject({
      method: "GET",
      url: "/v1/servers/main/install-manifest",
    });
    expect(manifest.statusCode).toBe(200);
    expect(manifest.json()).toEqual(
      expect.objectContaining({
        keyId: expect.any(String),
        signature: expect.any(String),
        payload: {
          id: "lapis-26.2-fabric-0.19.3",
          minecraftVersion: "26.2",
          loader: "fabric",
          loaderVersion: "0.19.3",
          mods: [],
        },
      }),
    );
    const signedManifest = manifest.json();
    expect(
      verify(
        null,
        Buffer.from(canonicalInstallManifest(signedManifest.payload)),
        DEVELOPMENT_MANIFEST_PUBLIC_KEY,
        Buffer.from(signedManifest.signature, "base64url"),
      ),
    ).toBe(true);
  });

  it("includes the actual downloadable mod size in a valid signed manifest", async () => {
    const contentRoot = await mkdtemp(join(tmpdir(), "lapis-content-"));
    const previousContentRoot = process.env.LAPIS_CONTENT_ROOT;
    const fileName = "example-mod.jar";
    const content = Buffer.from("mod-data");
    const sha1 = createHash("sha1").update(content).digest("hex");
    process.env.LAPIS_CONTENT_ROOT = contentRoot;
    try {
      await writeFile(join(contentRoot, fileName), content);
      await prisma.buildMod.create({
        data: {
          buildId: "lapis-26.2-fabric-0.19.3",
          fileName,
          sha1,
          required: true,
        },
      });
      const response = await app.inject({
        method: "GET",
        url: "/v1/servers/main/install-manifest",
      });
      expect(response.statusCode).toBe(200);
      const signedManifest = response.json();
      expect(signedManifest.payload.mods).toEqual([
        expect.objectContaining({ fileName, sha1, size: content.length }),
      ]);
      expect(
        verify(
          null,
          Buffer.from(canonicalInstallManifest(signedManifest.payload)),
          DEVELOPMENT_MANIFEST_PUBLIC_KEY,
          Buffer.from(signedManifest.signature, "base64url"),
        ),
      ).toBe(true);
    } finally {
      await prisma.buildMod.deleteMany({ where: { fileName } });
      if (previousContentRoot === undefined)
        delete process.env.LAPIS_CONTENT_ROOT;
      else process.env.LAPIS_CONTENT_ROOT = previousContentRoot;
      await rm(contentRoot, { recursive: true, force: true });
    }
  });

  it("returns public mod and online-player details", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { nickname: "OnlineUser", password: "Abc123" },
    });
    await prisma.server.update({
      where: { id: "main" },
      data: {
        status: "online",
        onlinePlayers: 1,
        onlinePlayerNames: ["OnlineUser"],
      },
    });

    const mods = await app.inject({
      method: "GET",
      url: "/v1/servers/main/mods",
    });
    expect(mods.statusCode).toBe(200);
    expect(mods.json()).toEqual([]);

    const players = await app.inject({
      method: "GET",
      url: "/v1/servers/main/players",
    });
    expect(players.statusCode).toBe(200);
    expect(players.json()).toEqual([
      expect.objectContaining({
        nickname: "OnlineUser",
        skin: expect.objectContaining({
          textureUrl: expect.stringMatching(/^https:\/\//),
        }),
      }),
    ]);
  });

  it("creates a hidden server and manages its client-only mods", async () => {
    const registration = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { nickname: "ClientAdmin", password: "Abc123" },
    });
    const accessToken = registration.json().accessToken as string;
    const userId = registration.json().user.id as string;
    const superAdmin = await prisma.role.findUniqueOrThrow({
      where: { key: "super_admin" },
      select: { id: true },
    });
    await prisma.userRole.create({
      data: { userId, roleId: superAdmin.id, scopeType: "GLOBAL" },
    });

    const serverId = "client-test";
    const contentRoot = await mkdtemp(join(tmpdir(), "lapis-client-admin-"));
    const previousContentRoot = process.env.LAPIS_CONTENT_ROOT;
    let createdBuildId: string | null = null;
    process.env.LAPIS_CONTENT_ROOT = contentRoot;
    try {
      await prisma.auditEvent.deleteMany({ where: { serverId } });
      const created = await app.inject({
        method: "POST",
        url: "/v1/admin/servers",
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          id: serverId,
          name: "Client Test",
          host: "127.0.0.1",
          port: 25566,
          visible: false,
          templateServerId: "main",
        },
      });
      expect(created.statusCode).toBe(201);
      expect(created.json()).toEqual(
        expect.objectContaining({ id: serverId, visible: false }),
      );
      createdBuildId = created.json().activeBuild.id as string;

      const hiddenCatalog = await app.inject({
        method: "GET",
        url: "/v1/servers",
      });
      expect(hiddenCatalog.json()).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: serverId })]),
      );

      const madeVisible = await app.inject({
        method: "PATCH",
        url: `/v1/admin/servers/${serverId}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { visible: true },
      });
      expect(madeVisible.statusCode).toBe(200);
      expect(madeVisible.json().visible).toBe(true);

      const boundary = "----lapis-client-mod-test";
      const jarArchive = new AdmZip();
      jarArchive.addFile(
        "fabric.mod.json",
        Buffer.from(
          JSON.stringify({
            schemaVersion: 1,
            id: "client-test",
            version: "1.0.0",
            environment: "client",
            depends: {
              minecraft: ">=26.2- <26.3-",
              fabricloader: ">=0.19.0",
            },
          }),
        ),
      );
      const jar = jarArchive.toBuffer();
      const multipartBody = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="client-test.jar"\r\nContent-Type: application/java-archive\r\n\r\n`,
        ),
        jar,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const uploaded = await app.inject({
        method: "POST",
        url: `/v1/admin/servers/${serverId}/client-mods`,
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        payload: multipartBody,
      });
      expect(uploaded.statusCode).toBe(201);
      expect(uploaded.json()).toEqual(
        expect.objectContaining({
          fileName: "client-test.jar",
          enabled: false,
          compatibility: expect.objectContaining({ status: "compatible" }),
        }),
      );

      const modId = uploaded.json().id as string;
      const replacementArchive = new AdmZip();
      replacementArchive.addFile(
        "fabric.mod.json",
        Buffer.from(
          JSON.stringify({
            schemaVersion: 1,
            id: "client-test",
            version: "2.0.0",
            environment: "client",
            depends: { minecraft: "26.2", fabricloader: ">=0.19.0" },
          }),
        ),
      );
      const replacementJar = replacementArchive.toBuffer();
      const replacementSha1 = createHash("sha1")
        .update(replacementJar)
        .digest("hex");
      const replacementBody = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="client-test.jar"\r\nContent-Type: application/java-archive\r\n\r\n`,
        ),
        replacementJar,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const replaced = await app.inject({
        method: "POST",
        url: `/v1/admin/servers/${serverId}/client-mods`,
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        payload: replacementBody,
      });
      expect(replaced.statusCode).toBe(201);
      expect(replaced.json()).toEqual(
        expect.objectContaining({
          id: modId,
          fileName: "client-test.jar",
          sha1: replacementSha1,
          enabled: false,
          compatibility: expect.objectContaining({
            status: "compatible",
            modVersion: "2.0.0",
          }),
        }),
      );
      await expect(
        access(join(contentRoot, `${replacementSha1}.jar`)),
      ).resolves.toBeUndefined();

      const enabled = await app.inject({
        method: "PATCH",
        url: `/v1/admin/servers/${serverId}/client-mods/${modId}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { enabled: true },
      });
      expect(enabled.statusCode).toBe(200);
      expect(enabled.json().enabled).toBe(true);

      const replacementManifest = await app.inject({
        method: "GET",
        url: `/v1/servers/${serverId}/install-manifest`,
      });
      const replacementMod = replacementManifest
        .json()
        .payload.mods.find(
          (mod: { fileName: string }) => mod.fileName === "client-test.jar",
        );
      expect(replacementMod).toEqual(
        expect.objectContaining({
          sha1: replacementSha1,
          url: expect.stringContaining(
            `/v1/content/mods/${replacementSha1}/client-test.jar`,
          ),
        }),
      );
      const downloaded = await app.inject({
        method: "GET",
        url: new URL(replacementMod.url).pathname,
      });
      expect(downloaded.statusCode).toBe(200);
      expect(downloaded.rawPayload).toEqual(replacementJar);

      const disabled = await app.inject({
        method: "PATCH",
        url: `/v1/admin/servers/${serverId}/client-mods/${modId}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { enabled: false },
      });
      expect(disabled.statusCode).toBe(200);
      expect(disabled.json().enabled).toBe(false);

      const manifest = await app.inject({
        method: "GET",
        url: `/v1/servers/${serverId}/install-manifest`,
      });
      expect(manifest.statusCode).toBe(200);
      expect(manifest.json().payload.mods).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ fileName: "client-test.jar" }),
        ]),
      );

      const deleted = await app.inject({
        method: "DELETE",
        url: `/v1/admin/servers/${serverId}/client-mods`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { ids: [modId] },
      });
      expect(deleted.statusCode).toBe(200);
      expect(deleted.json()).toEqual({ deletedIds: [modId] });
      const remainingMods = await app.inject({
        method: "GET",
        url: `/v1/admin/servers/${serverId}/client-mods`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(remainingMods.json()).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: modId })]),
      );
      expect(
        await prisma.auditEvent.count({
          where: {
            serverId,
            action: {
              in: [
                "server.create",
                "server.update",
                "client_mod.upload",
                "client_mod.toggle",
                "client_mod.delete",
              ],
            },
          },
        }),
      ).toBe(7);
    } finally {
      await prisma.server.deleteMany({ where: { id: serverId } });
      if (createdBuildId)
        await prisma.gameBuild.deleteMany({ where: { id: createdBuildId } });
      await prisma.auditEvent.deleteMany({ where: { serverId } });
      if (previousContentRoot === undefined)
        delete process.env.LAPIS_CONTENT_ROOT;
      else process.env.LAPIS_CONTENT_ROOT = previousContentRoot;
      await rm(contentRoot, { recursive: true, force: true });
    }
  });

  it("issues a short-lived single-use ticket only to an authenticated launcher", async () => {
    const registration = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { nickname: "TicketUser", password: "Abc123" },
    });
    const accessToken = registration.json().accessToken as string;
    const issued = await app.inject({
      method: "POST",
      url: "/v1/servers/main/game-ticket",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(issued.statusCode).toBe(201);
    const ticket = issued.json().ticket as string;

    const denied = await app.inject({
      method: "POST",
      url: "/v1/game-tickets/consume",
      payload: { ticket, serverId: "main" },
    });
    expect(denied.statusCode).toBe(403);

    const consumed = await app.inject({
      method: "POST",
      url: "/v1/game-tickets/consume",
      headers: {
        "x-lapis-bridge-key": "lapis-dev-bridge-key-change-in-production",
      },
      payload: { ticket, serverId: "main" },
    });
    expect(consumed.statusCode).toBe(200);
    expect(consumed.json()).toEqual(
      expect.objectContaining({ nickname: "TicketUser" }),
    );

    const reused = await app.inject({
      method: "POST",
      url: "/v1/game-tickets/consume",
      headers: {
        "x-lapis-bridge-key": "lapis-dev-bridge-key-change-in-production",
      },
      payload: { ticket, serverId: "main" },
    });
    expect(reused.statusCode).toBe(401);
  });
});

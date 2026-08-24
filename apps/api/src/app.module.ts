import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { APP_GUARD } from "@nestjs/core";
import { AuthController } from "./auth/auth.controller";
import { AuthService } from "./auth/auth.service";
import { PrismaService } from "./prisma.service";
import { ServersController } from "./servers/servers.controller";
import { ServersService } from "./servers/servers.service";
import { ManifestSigningService } from "./servers/manifest-signing.service";
import { GameTicketsService } from "./servers/game-tickets.service";
import { GameTicketsController } from "./servers/game-tickets.controller";
import { ContentController } from "./servers/content.controller";
import { ProfileController } from "./profile/profile.controller";
import { SkinService } from "./profile/skin.service";
import { HealthController } from "./health.controller";
import { AccessTokenGuard } from "./auth/access-token.guard";
import { AuthorizationService } from "./auth/authorization.service";
import { MeController } from "./auth/me.controller";
import { PermissionsGuard } from "./auth/permissions.guard";
import { AdminServersController } from "./admin/admin-servers.controller";

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.LAPIS_ACCESS_TOKEN_SECRET,
      signOptions: { expiresIn: "15m" },
    }),
  ],
  controllers: [
    HealthController,
    AuthController,
    MeController,
    AdminServersController,
    ServersController,
    GameTicketsController,
    ContentController,
    ProfileController,
  ],
  providers: [
    PrismaService,
    AuthService,
    ServersService,
    ManifestSigningService,
    GameTicketsService,
    SkinService,
    AuthorizationService,
    { provide: APP_GUARD, useClass: AccessTokenGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}

import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
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

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.LAPIS_ACCESS_TOKEN_SECRET,
      signOptions: { expiresIn: "15m" },
    }),
  ],
  controllers: [
    AuthController,
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
  ],
})
export class AppModule {}

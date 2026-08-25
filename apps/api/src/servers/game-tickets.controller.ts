import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Inject,
  Post,
} from "@nestjs/common";
import {
  ConsumedGameTicket,
  ConsumedGameTicketWithSkin,
  consumedGameTicketWithSkinSchema,
  consumeGameTicketSchema,
} from "@lapis/contracts";
import { GameTicketsService } from "./game-tickets.service";
import { Public } from "../auth/public.decorator";
import { SkinService } from "../profile/skin.service";

@Public()
@Controller("v1/game-tickets")
export class GameTicketsController {
  constructor(
    @Inject(GameTicketsService) private readonly tickets: GameTicketsService,
    @Inject(SkinService) private readonly skins: SkinService,
  ) {}

  @HttpCode(200)
  @Post("consume")
  async consume(
    @Body() body: unknown,
    @Headers("x-lapis-bridge-key") bridgeKey: string | undefined,
    @Headers("x-lapis-bridge-capabilities")
    bridgeCapabilities: string | undefined,
  ): Promise<ConsumedGameTicket | ConsumedGameTicketWithSkin> {
    // The Fabric Bridge is deployed with this value. A real deployment must override it.
    const expectedBridgeKey =
      process.env.LAPIS_BRIDGE_SHARED_KEY ??
      "lapis-dev-bridge-key-change-in-production";
    const input = consumeGameTicketSchema.parse(body);
    if (bridgeKey !== expectedBridgeKey)
      throw new ForbiddenException("Bridge authentication failed.");
    const consumed = await this.tickets.consume(input.ticket, input.serverId);
    if (bridgeCapabilities !== "signed-skin-v1")
      return { userId: consumed.userId, nickname: consumed.nickname };
    return consumedGameTicketWithSkinSchema.parse({
      ...consumed,
      skin: await this.skins.getSignedSkin(consumed.userId, consumed.nickname),
    });
  }
}

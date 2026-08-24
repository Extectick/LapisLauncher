import { Body, Controller, ForbiddenException, Headers, HttpCode, Inject, Post } from '@nestjs/common';
import { ConsumedGameTicket, consumeGameTicketSchema } from '@lapis/contracts';
import { GameTicketsService } from './game-tickets.service';
import { Public } from '../auth/public.decorator';

@Public()
@Controller('v1/game-tickets')
export class GameTicketsController {
  constructor(@Inject(GameTicketsService) private readonly tickets: GameTicketsService) {}

  @HttpCode(200)
  @Post('consume')
  async consume(@Body() body: unknown, @Headers('x-lapis-bridge-key') bridgeKey: string | undefined): Promise<ConsumedGameTicket> {
    // The Fabric Bridge is deployed with this value. A real deployment must override it.
    const expectedBridgeKey = process.env.LAPIS_BRIDGE_SHARED_KEY ?? 'lapis-dev-bridge-key-change-in-production';
    const input = consumeGameTicketSchema.parse(body);
    if (bridgeKey !== expectedBridgeKey) throw new ForbiddenException('Bridge authentication failed.');
    return this.tickets.consume(input.ticket, input.serverId);
  }
}

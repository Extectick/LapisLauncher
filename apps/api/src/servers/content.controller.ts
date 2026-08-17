import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { FastifyReply } from 'fastify';

const DEFAULT_CONTENT_ROOT = 'V:\\LapisServer\\client-mods';

@Controller('v1/content')
export class ContentController {
  @Get('mods/:fileName')
  async downloadMod(@Param('fileName') fileName: string, @Res() reply: FastifyReply): Promise<void> {
    if (basename(fileName) !== fileName || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,179}\.jar$/i.test(fileName)) throw new NotFoundException();
    const root = process.env.LAPIS_CONTENT_ROOT ?? DEFAULT_CONTENT_ROOT;
    const path = join(root, fileName);
    try { await access(path); } catch { throw new NotFoundException(); }
    reply.header('content-type', 'application/java-archive');
    reply.header('cache-control', 'public, max-age=31536000, immutable');
    await reply.send(createReadStream(path));
  }
}

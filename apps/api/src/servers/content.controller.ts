import { Controller, Get, NotFoundException, Param, Res } from "@nestjs/common";
import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { basename, join } from "node:path";
import { FastifyReply } from "fastify";
import { Public } from "../auth/public.decorator";

const DEFAULT_CONTENT_ROOT = "V:\\LapisServer\\client-mods";

@Public()
@Controller("v1/content")
export class ContentController {
  @Get("mods/:sha1/:fileName")
  async downloadVersionedMod(
    @Param("sha1") sha1: string,
    @Param("fileName") fileName: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    if (!/^[a-f0-9]{40}$/i.test(sha1)) throw new NotFoundException();
    await this.sendMod(fileName, reply, `${sha1.toLowerCase()}.jar`);
  }

  @Get("mods/:fileName")
  async downloadMod(
    @Param("fileName") fileName: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.sendMod(fileName, reply, fileName);
  }

  private async sendMod(
    fileName: string,
    reply: FastifyReply,
    storedFileName: string,
  ): Promise<void> {
    if (
      basename(fileName) !== fileName ||
      !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,179}\.jar$/i.test(fileName)
    )
      throw new NotFoundException();
    const root = process.env.LAPIS_CONTENT_ROOT ?? DEFAULT_CONTENT_ROOT;
    const path = join(root, storedFileName);
    try {
      await access(path);
    } catch {
      // Versioned manifests can still reference files uploaded before the
      // content-addressed layout was introduced.
      const legacyPath = join(root, fileName);
      try {
        await access(legacyPath);
        return await this.streamMod(legacyPath, reply);
      } catch {
        throw new NotFoundException();
      }
    }
    await this.streamMod(path, reply);
  }

  private async streamMod(path: string, reply: FastifyReply): Promise<void> {
    reply.header("content-type", "application/java-archive");
    reply.header("cache-control", "public, max-age=31536000, immutable");
    await reply.send(createReadStream(path));
  }
}

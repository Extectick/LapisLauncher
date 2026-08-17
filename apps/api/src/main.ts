import 'reflect-metadata';
import './env';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  if ((process.env.LAPIS_ACCESS_TOKEN_SECRET ?? '').length < 32) {
    throw new Error('LAPIS_ACCESS_TOKEN_SECRET must contain at least 32 characters.');
  }
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ logger: true }));
  app.enableCors({ origin: ['http://localhost:5173', 'http://localhost:5174'], methods: ['GET', 'POST'] });
  await app.listen({ port: Number(process.env.PORT ?? 3000), host: '127.0.0.1' });
  Logger.log('Lapis API is listening on loopback.', 'Bootstrap');
}

void bootstrap();

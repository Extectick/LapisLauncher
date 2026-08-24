import { BadRequestException, Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ZodError } from 'zod';
import { loginSchema, refreshSchema, registerSchema } from '@lapis/contracts';
import { AuthService, AuthResult } from './auth.service';
import { Public } from './public.decorator';

function parse<T>(schema: { parse(input: unknown): T }, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      const message = error.issues.at(0)?.message ?? 'Некорректные данные.';
      throw new BadRequestException(message);
    }
    throw error;
  }
}

@Public()
@Controller('v1/auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() body: unknown): Promise<AuthResult> {
    return this.auth.register(parse(registerSchema, body));
  }

  @HttpCode(200)
  @Post('login')
  login(@Body() body: unknown): Promise<AuthResult> {
    return this.auth.login(parse(loginSchema, body));
  }

  @HttpCode(200)
  @Post('refresh')
  refresh(@Body() body: unknown): Promise<AuthResult> {
    return this.auth.refresh(parse(refreshSchema, body).refreshToken);
  }

  @HttpCode(204)
  @Post('logout')
  async logout(@Body() body: unknown): Promise<void> {
    await this.auth.logout(parse(refreshSchema, body).refreshToken);
  }
}

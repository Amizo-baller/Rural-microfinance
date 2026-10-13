import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ForgotPasswordDto, LoginDto, RefreshDto, RegisterDto, ResetPasswordDto } from './dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { permissionsFor } from './authorization';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register') register(@Body() dto: RegisterDto) { return this.auth.register(dto); }
  @Get('registration-groups') registrationGroups() { return this.auth.registrationGroups(); }
  @Post('login') login(@Body() dto: LoginDto) { return this.auth.login(dto); }
  @Post('refresh') refresh(@Body() dto: RefreshDto) { return this.auth.refresh(dto.refreshToken); }
  @Post('logout') logout(@Body() dto: RefreshDto) { return this.auth.logout(dto.refreshToken); }
  @Post('forgot-password') forgot(@Body() dto: ForgotPasswordDto) { return this.auth.forgot(dto); }
  @Post('reset-password') reset(@Body() dto: ResetPasswordDto) { return this.auth.reset(dto); }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() request: { user: { sub: string } }) { return this.auth.me(request.user.sub); }

  @UseGuards(JwtAuthGuard)
  @Get('permissions')
  permissions(@Req() request: { user: { role: string } }) { return { permissions: permissionsFor(request.user.role) }; }
}

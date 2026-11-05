import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ForgotPasswordDto, GoogleLoginDto, LoginDto, RefreshDto, RegisterDto, ResetPasswordDto, WalletChallengeDto, WalletProofDto } from './dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { permissionsFor } from './authorization';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register') register(@Body() dto: RegisterDto) { return this.auth.register(dto); }
  @Get('registration-groups') registrationGroups() { return this.auth.registrationGroups(); }
  @Post('login') login(@Body() dto: LoginDto) { return this.auth.login(dto); }
  @Post('google') google(@Body() dto: GoogleLoginDto) { return this.auth.googleLogin(dto.idToken); }
  @Post('wallet/challenge') walletChallenge(@Body() dto: WalletChallengeDto) { return this.auth.walletChallenge(dto); }
  @Post('wallet/login') walletLogin(@Body() dto: WalletProofDto) { return this.auth.walletProof(dto); }
  @UseGuards(JwtAuthGuard)
  @Post('wallet/link/challenge') walletLinkChallenge(@Body() dto: WalletChallengeDto, @Req() req: { user: { sub: string } }) { return this.auth.walletChallenge(dto, req.user.sub); }
  @UseGuards(JwtAuthGuard)
  @Post('wallet/link') walletLink(@Body() dto: WalletProofDto, @Req() req: { user: { sub: string } }) { return this.auth.walletProof(dto, req.user.sub); }
  @Post('refresh') refresh(@Body() dto: RefreshDto) { return this.auth.refresh(dto.refreshToken); }
  @Post('logout') logout(@Body() dto: RefreshDto) { return this.auth.logout(dto.refreshToken); }
  @Post('forgot-password') forgot(@Body() dto: ForgotPasswordDto) { return this.auth.forgot(dto); }
  @Post('reset-password') reset(@Body() dto: ResetPasswordDto) { return this.auth.reset(dto); }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() request: { user: { sub: string; walletAddress?: string } }) { return this.auth.me(request.user.sub, request.user.walletAddress); }

  @UseGuards(JwtAuthGuard)
  @Get('permissions')
  permissions(@Req() request: { user: { role: string } }) { return { permissions: permissionsFor(request.user.role) }; }
}

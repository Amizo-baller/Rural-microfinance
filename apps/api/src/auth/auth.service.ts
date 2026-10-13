import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
  forwardRef,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma.service';
import { ForgotPasswordDto, LoginDto, RegisterDto, ResetPasswordDto } from './dto';
import { NotificationsService } from '../notifications/notifications.service';

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
type JwtDuration = '15m' | '30m' | '1h' | '2h' | '6h' | '12h' | '24h' | number;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(forwardRef(() => NotificationsService))
    private readonly notifications: NotificationsService,
  ) {}
  private secret() {
    const value = process.env.JWT_SECRET;
    if (!value || value.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
    return value;
  }

  private tokenDigest(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
  private normalizeIdentifier(value: string) {
    return value.trim().toLowerCase();
  }

  private async deliverPasswordReset(
    user: { email: string | null; phone: string | null },
    token: string,
  ) {
    const webhookUrl = process.env.PASSWORD_RESET_WEBHOOK_URL;
    if (!webhookUrl) {
      // Development exposes the token in the response below. A production
      // deployment must configure a delivery provider rather than pretending
      // that an email or SMS was sent.
      if (process.env.NODE_ENV === 'production')
        throw new ServiceUnavailableException('Password reset delivery is not configured');
      return;
    }
    const resetUrl = new URL(
      process.env.PASSWORD_RESET_URL ?? 'https://example.invalid/reset-password',
    );
    resetUrl.searchParams.set('token', token);
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'PASSWORD_RESET',
          recipient: { email: user.email, phone: user.phone },
          resetUrl: resetUrl.toString(),
        }),
      });
      if (!response.ok) throw new Error(`Delivery provider returned ${response.status}`);
    } catch {
      throw new ServiceUnavailableException('Password reset delivery is temporarily unavailable');
    }
  }

  private async tokens(
    user: { id: string; memberId: string; email: string | null; phone: string | null; role: { name: string } },
    database: Pick<PrismaService, 'authToken'> = this.prisma,
  ) {
    const expiresIn = (process.env.JWT_EXPIRES_IN ?? '15m') as JwtDuration;
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, role: user.role.name },
      {
        secret: this.secret(),
        expiresIn,
      },
    );
    const refreshToken = randomBytes(48).toString('hex');
    await database.authToken.create({
      data: {
        userId: user.id,
        tokenHash: this.tokenDigest(refreshToken),
        type: 'REFRESH',
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });
    return {
      accessToken,
      refreshToken,
      user: { id: user.id, memberId: user.memberId, email: user.email, phone: user.phone, role: user.role.name },
    };
  }

  async register(dto: RegisterDto) {
    if (!dto.memberId?.trim()) throw new BadRequestException('A unique member ID is required');
    if (dto.password !== dto.passwordConfirmation)
      throw new BadRequestException('Passwords do not match');
    if (!dto.email && !dto.phone) throw new BadRequestException('Email or phone is required');
    if (dto.groupId && dto.role === 'GROUP_MANAGER')
      throw new BadRequestException('Group managers cannot register as a group member');
    const email = dto.email?.trim().toLowerCase();
    const phone = dto.phone?.trim();
    const roleName = dto.role ?? 'MEMBER';
    const [role, group] = await Promise.all([
      this.prisma.role.findUnique({ where: { name: roleName } }),
      dto.groupId
        ? this.prisma.communityGroup.findFirst({ where: { id: dto.groupId, status: 'ACTIVE' } })
        : null,
    ]);
    if (!role) throw new BadRequestException('Roles have not been seeded');
    if (dto.groupId && !group) throw new BadRequestException('The selected group is not available');
    const assignedId = await this.prisma.user.findUnique({ where: { memberId: dto.memberId.trim() } });
    if (assignedId) throw new ConflictException('Member ID is already in use. Enter your assigned unique ID.');
    const exists = await this.prisma.user.findFirst({
      where: { OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] },
    });
    if (exists) throw new ConflictException('An account with this email or phone already exists');
    // Hash before opening the transaction: CPU work must not consume its timeout.
    const passwordHash = await bcrypt.hash(dto.password, 12);
    try {
      const session = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            memberId: dto.memberId.trim(),
            firstName: dto.firstName.trim(),
            lastName: dto.lastName.trim(),
            email,
            phone,
            passwordHash,
            roleId: role.id,
            status: 'ACTIVE',
          },
          include: { role: true },
        });
        if (group) {
          await tx.groupMember.create({
            data: {
              groupId: group.id,
              userId: created.id,
            memberNumber: dto.memberId.trim(),
            },
          });
        }
        // Commit the account and its first session together.
        return this.tokens(created, tx);
      });
      // A slow or failed welcome notification must not make a committed signup fail.
      void this.notifications
        .create(
          session.user.id,
          'Welcome to Rural Microfinance',
          'Your account was registered successfully.',
          'SECURITY',
        )
        .catch(() => this.logger.warn('Welcome notification could not be recorded'));
      return session;
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002' && 'meta' in error && String((error.meta as { target?: unknown })?.target).includes('memberId')) throw new ConflictException('Member ID is already in use. Enter your assigned unique ID.');
      if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002')
        throw new ConflictException('An account with this email or phone already exists');
      throw error;
    }
  }

  async login(dto: LoginDto) {
    const identifier = this.normalizeIdentifier(dto.identifier);
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ email: identifier }, { phone: dto.identifier.trim() }] },
      include: { role: true },
    });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash)))
      throw new UnauthorizedException('Invalid credentials');
    if (user.status !== 'ACTIVE') throw new ForbiddenException('Account is not active');
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.tokens(user);
  }

  registrationGroups() {
    return this.prisma.communityGroup.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true, location: true }, take: 100, orderBy: { name: 'asc' } });
  }

  async me(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, include: { role: true } });
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException();
    const safe: Partial<typeof user> = { ...user };
    delete safe.passwordHash;
    return { ...safe, role: user.role.name };
  }

  async refresh(token: string) {
    const record = await this.prisma.authToken.findFirst({
      where: {
        tokenHash: this.tokenDigest(token),
        type: 'REFRESH',
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { user: { include: { role: true } } },
    });
    if (!record || record.user.status !== 'ACTIVE') throw new UnauthorizedException();
    await this.prisma.authToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });
    return this.tokens(record.user);
  }

  async logout(token: string) {
    await this.prisma.authToken.updateMany({
      where: { tokenHash: this.tokenDigest(token), type: 'REFRESH', revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { message: 'Logged out successfully' };
  }

  async forgot(dto: ForgotPasswordDto) {
    const identifier = this.normalizeIdentifier(dto.identifier);
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ email: identifier }, { phone: dto.identifier.trim() }] },
    });
    const message = 'If the account exists, reset instructions have been sent';
    if (!user) return { message };
    const token = randomBytes(32).toString('hex');
    const resetRecord = await this.prisma.authToken.create({
      data: {
        userId: user.id,
        tokenHash: this.tokenDigest(token),
        type: 'PASSWORD_RESET',
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });
    try {
      await this.deliverPasswordReset(user, token);
    } catch (error) {
      await this.prisma.authToken.update({
        where: { id: resetRecord.id },
        data: { revokedAt: new Date() },
      });
      throw error;
    }
    return { message, ...(process.env.NODE_ENV === 'development' ? { resetToken: token } : {}) };
  }

  async reset(dto: ResetPasswordDto) {
    const item = await this.prisma.authToken.findFirst({
      where: {
        tokenHash: this.tokenDigest(dto.token),
        type: 'PASSWORD_RESET',
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!item) throw new UnauthorizedException('Invalid or expired reset token');
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: item.userId },
        data: { passwordHash: await bcrypt.hash(dto.password, 12) },
      }),
      this.prisma.authToken.update({ where: { id: item.id }, data: { revokedAt: new Date() } }),
      this.prisma.authToken.updateMany({
        where: { userId: item.userId, type: 'REFRESH', revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return { message: 'Password reset successfully' };
  }

  async verify(token: string) {
    let payload: { sub: string; role: string };
    try {
      payload = await this.jwt.verifyAsync<{ sub: string; role: string }>(token, {
        secret: this.secret(),
      });
      if (!payload || typeof payload.sub !== 'string' || !payload.sub)
        throw new UnauthorizedException();
    } catch {
      throw new UnauthorizedException();
    }
    // JWTs are intentionally short-lived, but status changes must take effect
    // immediately rather than waiting for their expiry.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { status: true, role: { select: { name: true } } },
    });
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException();
    return { sub: payload.sub, role: user.role.name };
  }
}

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
import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import { getAddress, verifyMessage } from 'ethers';
import { PrismaService } from '../prisma.service';
import { ForgotPasswordDto, LoginDto, RegisterDto, ResetPasswordDto, WalletChallengeDto, WalletProofDto } from './dto';
import { NotificationsService } from '../notifications/notifications.service';

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
type JwtDuration = '15m' | '30m' | '1h' | '2h' | '6h' | '12h' | '24h' | number;

@Injectable()
export class AuthService {
  private readonly googleClient = new OAuth2Client();
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
    walletAddress?: string,
  ) {
    const expiresIn = (process.env.JWT_EXPIRES_IN ?? '15m') as JwtDuration;
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, role: user.role.name, ...(walletAddress ? { walletAddress } : {}) },
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
        ...(walletAddress ? { walletAddress } : {}),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });
    return {
      accessToken,
      refreshToken,
      user: { id: user.id, memberId: user.memberId, email: user.email, phone: user.phone, role: user.role.name, ...(walletAddress ? { walletAddress } : {}) },
    };
  }

  async register(dto: RegisterDto) {
    if (!dto.memberId?.trim()) throw new BadRequestException('A unique member ID is required');
    if (dto.password !== dto.passwordConfirmation)
      throw new BadRequestException('Passwords do not match');
    if (dto.groupId && dto.role && dto.role !== 'MEMBER')
      throw new BadRequestException('Only member registrations can join a community group');
    const email = dto.email?.trim().toLowerCase() || null;
    const phone = dto.phone?.trim() || null;

    if (!email && !phone) {
      throw new BadRequestException('Email or phone is required');
    }
    // Older clients can still submit GROUP_MANAGER; new accounts use Admin.
    const roleName = dto.role === 'GROUP_MANAGER' ? 'ADMIN' : dto.role ?? 'MEMBER';
    const pendingApproval = roleName === 'ADMIN' || roleName === 'TREASURER';
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
    if (email) {
      const existingEmail = await this.prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });

      if (existingEmail) {
        throw new ConflictException('This email address is already registered');
      }
    }

    if (phone) {
      const existingPhone = await this.prisma.user.findUnique({
        where: { phone },
        select: { id: true },
      });

      if (existingPhone) {
        throw new ConflictException('This phone number is already registered');
      }
    }
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
            status: pendingApproval ? 'PENDING' : 'ACTIVE',
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
        if (pendingApproval) {
          await tx.auditLog.create({ data: { userId: created.id, action: 'STAFF_REGISTRATION_REQUESTED', entityType: 'User', entityId: created.id, newValues: { role: roleName, status: 'PENDING' } } });
          return { pendingApproval: true as const, message: 'Your account was created and requires administrator approval before you can sign in.', user: { id: created.id, memberId: created.memberId, email: created.email, phone: created.phone, role: created.role.name } };
        }
        // Commit the active member account and its first session together.
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
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        const target =
          'meta' in error
            ? (error.meta as { target?: unknown } | undefined)?.target
            : undefined;

        const fields = Array.isArray(target)
          ? target.map(String).join(', ')
          : String(target ?? 'unknown');

        this.logger.warn(`Registration unique constraint conflict: ${fields}`);

        if (fields.includes('memberId')) {
          throw new ConflictException('This member ID is already registered');
        }

        if (fields.includes('email')) {
          throw new ConflictException('This email address is already registered');
        }

        if (fields.includes('phone')) {
          throw new ConflictException('This phone number is already registered');
        }

        throw new ConflictException(
          'Registration conflicts with an existing record. Please contact the administrator.',
        );
      }

      throw error;
    }
  }

  async login(dto: LoginDto) {
    const identifier = this.normalizeIdentifier(dto.identifier);
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ email: identifier }, { phone: dto.identifier.trim() }, { memberId: dto.identifier.trim() }] },
      include: { role: true },
    });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash)))
      throw new UnauthorizedException('Invalid credentials');
    if (user.status !== 'ACTIVE') throw new ForbiddenException('Account is not active');
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.tokens(user);
  }

  async googleLogin(idToken: string) {
    const audience = process.env.GOOGLE_WEB_CLIENT_ID?.trim();
    if (!audience) throw new ServiceUnavailableException('Google sign-in is not configured');
    let payload: TokenPayload | undefined;
    try {
      const ticket = await this.googleClient.verifyIdToken({ idToken, audience });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException('Google sign-in could not be verified. Please try again.');
    }
    // Email matching is safe only when Google is authoritative for that address.
    if (!payload?.sub || !payload.email || !payload.email_verified ||
      (!payload.email.toLowerCase().endsWith('@gmail.com') && !payload.hd))
      throw new UnauthorizedException('Use a verified Gmail or Google Workspace email to sign in.');
    const user = await this.prisma.user.findUnique({
      where: { email: payload.email.trim().toLowerCase() },
      include: { role: true },
    });
    if (!user) throw new UnauthorizedException('No member account uses this Google email. Create your member account first or choose your registered email.');
    if (user.status !== 'ACTIVE') throw new ForbiddenException('Account is not active');
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.tokens(user);
  }

  registrationGroups() {
    return this.prisma.communityGroup.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true, location: true }, take: 100, orderBy: { name: 'asc' } });
  }

  async me(id: string, walletAddress?: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, include: { role: true } });
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException();
    const safe: Partial<typeof user> = { ...user };
    delete safe.passwordHash;
    return { ...safe, role: user.role.name, ...(walletAddress ? { walletAddress } : {}) };
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
    if (record.walletAddress && record.user.blockchainAddress?.toLowerCase() !== record.walletAddress) throw new UnauthorizedException();
    await this.prisma.authToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });
    return this.tokens(record.user, this.prisma, record.walletAddress ?? undefined);
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
    let payload: { sub: string; role: string; walletAddress?: string };
    try {
      payload = await this.jwt.verifyAsync<{ sub: string; role: string; walletAddress?: string }>(token, {
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
      select: { status: true, blockchainAddress: true, role: { select: { name: true } } },
    });
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException();
    if (payload.walletAddress && user.blockchainAddress?.toLowerCase() !== payload.walletAddress) throw new UnauthorizedException();
    return { sub: payload.sub, role: user.role.name, ...(payload.walletAddress ? { walletAddress: payload.walletAddress } : {}) };
  }

  async walletChallenge(dto: WalletChallengeDto, linkUserId?: string) {
    let address: string;
    try { address = getAddress(dto.address).toLowerCase(); }
    catch { throw new BadRequestException('Invalid wallet address'); }
    const user = linkUserId
      ? await this.prisma.user.findUnique({ where: { id: linkUserId } })
      : await this.prisma.user.findFirst({ where: { blockchainAddress: { equals: address, mode: 'insensitive' } } });
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException('Sign in to your existing account and link this wallet from My profile first.');
    const origin = new URL(process.env.WALLET_AUTH_ORIGIN ?? 'http://localhost:8084');
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password ||
        (process.env.NODE_ENV === 'production' && origin.protocol !== 'https:'))
      throw new ServiceUnavailableException('Wallet sign-in origin is not configured.');
    const issued = new Date(), expires = new Date(issued.getTime() + 5 * 60 * 1000);
    const message = `${origin.host} wants you to sign in with your Ethereum account:\n${getAddress(address)}\n\n${linkUserId ? 'Link this wallet to your existing Rural Microfinance account.' : 'Sign in to Rural Microfinance.'} No transaction or payment is requested.\n\nURI: ${origin.origin}\nVersion: 1\nChain ID: ${dto.chainId}\nNonce: ${randomBytes(16).toString('hex')}\nIssued At: ${issued.toISOString()}\nExpiration Time: ${expires.toISOString()}`;
    await this.prisma.authToken.create({ data: { userId: user.id, walletAddress: address,
      type: linkUserId ? 'WALLET_LINK' : 'WALLET_LOGIN', tokenHash: this.tokenDigest(message), expiresAt: expires } });
    return { message, expiresAt: expires.toISOString() };
  }

  async walletProof(dto: WalletProofDto, linkUserId?: string) {
    let address: string;
    try {
      address = getAddress(dto.address).toLowerCase();
      if (verifyMessage(dto.message, dto.signature).toLowerCase() !== address) throw new Error();
    } catch { throw new UnauthorizedException('Wallet signature does not match the selected account.'); }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const challenge = await tx.authToken.findFirst({ where: { tokenHash: this.tokenDigest(dto.message),
          walletAddress: address, type: linkUserId ? 'WALLET_LINK' : 'WALLET_LOGIN', revokedAt: null,
          expiresAt: { gt: new Date() }, ...(linkUserId ? { userId: linkUserId } : {}) } });
        if (!challenge) throw new UnauthorizedException('Wallet request expired or was already used. Select your account and sign again.');
        const user = await tx.user.findUnique({ where: { id: challenge.userId }, include: { role: true } });
        if (!user || user.status !== 'ACTIVE' || (!linkUserId && user.blockchainAddress?.toLowerCase() !== address)) throw new UnauthorizedException();
        const claimed = await tx.authToken.updateMany({ where: { id: challenge.id, revokedAt: null, expiresAt: { gt: new Date() } }, data: { revokedAt: new Date() } });
        if (claimed.count !== 1) throw new UnauthorizedException('Wallet request was already used.');
        if (linkUserId) {
          const owner = await tx.user.findFirst({ where: { id: { not: user.id }, blockchainAddress: { equals: address, mode: 'insensitive' } }, select: { id: true } });
          if (owner) throw new ConflictException('This wallet is already linked to another account.');
          await tx.user.update({ where: { id: user.id }, data: { blockchainAddress: address } });
          await tx.authToken.updateMany({ where: { userId: user.id, type: 'REFRESH', walletAddress: { not: null }, revokedAt: null }, data: { revokedAt: new Date() } });
          await tx.auditLog.create({ data: { userId: user.id, action: 'WALLET_LINKED', entityType: 'User', entityId: user.id, newValues: { address } } });
          return { linked: true as const, address };
        }
        await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        await tx.auditLog.create({ data: { userId: user.id, action: 'WALLET_SIGNED_IN', entityType: 'User', entityId: user.id, newValues: { address } } });
        return this.tokens(user, tx, address);
      });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') throw new ConflictException('This wallet is already linked to another account.');
      throw error;
    }
  }
}

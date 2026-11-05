/* eslint-disable @typescript-eslint/no-explicit-any */
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { LoginTicket, OAuth2Client, type TokenPayload } from 'google-auth-library';

jest.mock('@nestjs/jwt', () => ({ JwtService: class JwtService {} }));

import { AuthService } from './auth.service';
import { RegisterDto } from './dto';
import { validate } from 'class-validator';

const role = { name: 'MEMBER' };
const user = {
  id: 'user-1',
  memberId: '2026001',
  email: 'member@example.com',
  phone: null,
  passwordHash: '',
  status: 'ACTIVE',
  role,
};

describe('AuthService', () => {
  let prisma: any;
  let jwt: any;
  let service: AuthService;
  let notifications: any;

  beforeEach(async () => {
    process.env.JWT_SECRET = 'a-secure-test-secret-with-at-least-32-characters';
    prisma = {
      user: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      role: { findUnique: jest.fn() },
      authToken: {
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    jwt = {
      signAsync: jest.fn().mockResolvedValue('access-token'),
      verifyAsync: jest.fn().mockResolvedValue({ sub: 'user-1' }),
    };
    notifications = { create: jest.fn().mockResolvedValue({}) };
    service = new AuthService(prisma, jwt, notifications);
    user.passwordHash = await bcrypt.hash('ValidPass1', 4);
    prisma.authToken.create.mockResolvedValue({});
    prisma.user.update.mockResolvedValue({});
  });

  it('issues tokens for valid credentials', async () => {
    prisma.user.findFirst.mockResolvedValue(user);
    await expect(
      service.login({ identifier: 'MEMBER@example.com', password: 'ValidPass1' }),
    ).resolves.toMatchObject({ accessToken: 'access-token', user: { id: user.id } });
  });

  it('registers a valid account and blocks duplicate registration', async () => {
    prisma.role.findUnique.mockResolvedValue({ id: 'role-1', ...role });
    const emailLookup = jest.fn().mockResolvedValueOnce(null).mockResolvedValue({ id: user.id });
    prisma.user.findUnique.mockImplementation(({ where }: any) => where.email ? emailLookup() : null);
    prisma.$transaction.mockImplementation((operation: any) =>
      operation({
        user: { create: jest.fn().mockResolvedValue(user) },
        authToken: prisma.authToken,
        groupMember: { count: jest.fn(), create: jest.fn() },
      }),
    );
    await expect(
      service.register({
        memberId: user.memberId,
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'member@example.com',
        password: 'ValidPass1',
        passwordConfirmation: 'ValidPass1',
      }),
    ).resolves.toMatchObject({ accessToken: 'access-token' });
    await expect(
      service.register({
        memberId: user.memberId,
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'member@example.com',
        password: 'ValidPass1',
        passwordConfirmation: 'ValidPass1',
      }),
    ).rejects.toMatchObject({ status: 409, message: 'This email address is already registered' });
  });

  it('keeps the migrated administrator account active with the same identity', async () => {
    prisma.user.findFirst.mockResolvedValue({ ...user, role: { name: 'ADMIN' } });
    await expect(service.login({ identifier: user.memberId, password: 'ValidPass1' }))
      .resolves.toMatchObject({ accessToken: 'access-token', user: { id: user.id, role: 'ADMIN' } });
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: user.id }, data: { lastLoginAt: expect.any(Date) } });
  });

  it('accepts Admin as the replacement role and rejects unknown roles', async () => {
    const dto = Object.assign(new RegisterDto(), { memberId: 'TEST001', firstName: 'Test', lastName: 'Account', email: 'test@example.com', password: 'ValidPass1', passwordConfirmation: 'ValidPass1', role: 'ADMIN' });
    expect((await validate(dto)).some((error) => error.property === 'role')).toBe(false);
    dto.role = 'GROUP_MANAGER';
    expect((await validate(dto)).some((error) => error.property === 'role')).toBe(false);
    Reflect.set(dto, 'role', 'UNKNOWN');
    expect((await validate(dto)).some((error) => error.property === 'role')).toBe(true);
  });

  it.each(['ADMIN', 'TREASURER', 'GROUP_MANAGER'] as const)('requires approval before a new %s receives access', async (requestedRole) => {
    const savedRole = requestedRole === 'GROUP_MANAGER' ? 'ADMIN' : requestedRole;
    prisma.role.findUnique.mockResolvedValue({ id: 'staff-role', name: savedRole });
    const create = jest.fn(async ({ data }: any) => ({ ...data, id: 'staff-user', role: { name: savedRole } }));
    const audit = jest.fn().mockResolvedValue({});
    prisma.$transaction.mockImplementation((operation: any) => operation({ user: { create }, auditLog: { create: audit }, authToken: prisma.authToken }));
    const result = await service.register({ memberId: 'STAFF-001', firstName: 'Staff', lastName: 'Account', email: 'staff@example.test', password: 'ValidPass1', passwordConfirmation: 'ValidPass1', role: requestedRole });
    expect(result).toMatchObject({ pendingApproval: true, user: { role: savedRole } });
    expect(prisma.role.findUnique).toHaveBeenCalledWith({ where: { name: savedRole } });
    expect(result).not.toHaveProperty('accessToken');
    expect(result).not.toHaveProperty('refreshToken');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING', roleId: 'staff-role' }) }));
    expect(prisma.authToken.create).not.toHaveBeenCalled();
    expect(jwt.signAsync).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalled();
    const saved = { ...user, status: 'PENDING', role: { name: savedRole } };
    prisma.user.findFirst.mockResolvedValue(saved);
    await expect(service.login({ identifier: 'staff@example.test', password: 'ValidPass1' })).rejects.toMatchObject({ status: 403 });
    saved.status = 'ACTIVE';
    await expect(service.login({ identifier: 'staff@example.test', password: 'ValidPass1' })).resolves.toMatchObject({ accessToken: 'access-token', user: { role: savedRole } });
  });

  it.each(['GROUP_MANAGER', 'TREASURER'] as const)('rejects a %s signup that attempts to join a member group', async (requestedRole) => {
    await expect(service.register({ memberId: 'STAFF-001', firstName: 'Staff', lastName: 'Account', email: 'staff@example.test', password: 'ValidPass1', passwordConfirmation: 'ValidPass1', role: requestedRole, groupId: 'group-id' })).rejects.toMatchObject({ status: 400 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('identifies an already registered phone number', async () => {
    prisma.role.findUnique.mockResolvedValue({ id: 'role-1', ...role });
    prisma.user.findUnique.mockImplementation(async ({ where }: any) =>
      where.phone === '099108791' ? { id: user.id } : null,
    );
    await expect(service.register({
      memberId: '2026002', firstName: 'Ada', lastName: 'Lovelace',
      email: 'new@example.com', phone: '099108791',
      password: 'ValidPass1', passwordConfirmation: 'ValidPass1',
    })).rejects.toMatchObject({ status: 409, message: 'This phone number is already registered' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  describe('registration transaction errors', () => {
    const registration = {
      memberId: '2026002', firstName: 'Ada', lastName: 'Lovelace',
      email: 'new@example.com', password: 'ValidPass1', passwordConfirmation: 'ValidPass1',
    };
    beforeEach(() => {
      prisma.role.findUnique.mockResolvedValue({ id: 'role-1', ...role });
      prisma.user.findUnique.mockResolvedValue(null);
    });
    it.each([
      [{ code: 'P2002', meta: { target: ['memberId'] } }, 'This member ID is already registered'],
      [{ code: 'P2002', meta: { target: ['email'] } }, 'This email address is already registered'],
      [{ code: 'P2002', meta: { target: 'User_phone_key' } }, 'This phone number is already registered'],
      [{ code: 'P2002', meta: { target: ['otherField'] } }, 'Registration conflicts with an existing record. Please contact the administrator.'],
      [{ code: 'P2002', meta: undefined }, 'Registration conflicts with an existing record. Please contact the administrator.'],
      [{ code: 'P2002' }, 'Registration conflicts with an existing record. Please contact the administrator.'],
    ])('reports the conflicting field safely for %j', async (error, message) => {
      prisma.$transaction.mockRejectedValue(error);
      await expect(service.register(registration)).rejects.toMatchObject({ status: 409, message });
    });
    it.each([null, new Error('Database unavailable'), { code: 'P1001' }, 'transaction failed'])(
      'preserves non-unique-constraint errors: %s', async (error) => {
        prisma.$transaction.mockRejectedValue(error);
        await expect(service.register(registration)).rejects.toBe(error);
      },
    );
  });

  it('rejects an invalid password or identifier', async () => {
    prisma.user.findFirst.mockResolvedValue(user);
    await expect(
      service.login({ identifier: 'member@example.com', password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(
      service.login({ identifier: 'missing@example.com', password: 'ValidPass1' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  describe('Google sign-in', () => {
    let verify: jest.SpyInstance;
    let originalAudience: string | undefined;
    const payload: TokenPayload = {
      iss: 'https://accounts.google.com', aud: 'web-client.apps.googleusercontent.com',
      sub: 'google-member-1', iat: 1, exp: 9999999999,
      email: 'MEMBER@gmail.com', email_verified: true,
    };
    beforeEach(() => {
      originalAudience = process.env.GOOGLE_WEB_CLIENT_ID;
      process.env.GOOGLE_WEB_CLIENT_ID = payload.aud;
      verify = jest.spyOn(OAuth2Client.prototype, 'verifyIdToken')
        .mockImplementation(async () => new LoginTicket(undefined, payload));
      prisma.user.findUnique.mockResolvedValue({ ...user, email: 'member@gmail.com' });
    });
    afterEach(() => {
      verify.mockRestore();
      if (originalAudience === undefined) delete process.env.GOOGLE_WEB_CLIENT_ID;
      else process.env.GOOGLE_WEB_CLIENT_ID = originalAudience;
    });
    it('verifies the token audience and issues the existing account session', async () => {
      await expect(service.googleLogin('google-id-token')).resolves.toMatchObject({
        accessToken: 'access-token', user: { id: user.id, role: 'MEMBER' },
      });
      expect(verify).toHaveBeenCalledWith({ idToken: 'google-id-token', audience: payload.aud });
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'member@gmail.com' }, include: { role: true },
      });
    });
    it('rejects an invalid, expired or wrong-audience token before looking up an account', async () => {
      verify.mockRejectedValue(new Error('Token verification failed'));
      await expect(service.googleLogin('invalid')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.authToken.create).not.toHaveBeenCalled();
    });
    it.each([
      { ...payload, email_verified: false },
      { ...payload, email: 'member@external.example' },
      { ...payload, sub: '' },
    ])('rejects untrusted email ownership or missing identity', async (claims) => {
      verify.mockResolvedValue(new LoginTicket(undefined, claims));
      await expect(service.googleLogin('token')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
    it('does not sign in an unknown email or a suspended account', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...user, status: 'SUSPENDED' });
      await expect(service.googleLogin('token')).rejects.toMatchObject({ status: 401 });
      await expect(service.googleLogin('token')).rejects.toMatchObject({ status: 403 });
      expect(prisma.authToken.create).not.toHaveBeenCalled();
    });
    it('requires a configured server audience', async () => {
      delete process.env.GOOGLE_WEB_CLIENT_ID;
      await expect(service.googleLogin('token')).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(verify).not.toHaveBeenCalled();
    });
  });

  it.each(['2026001', ' MEMBER@example.com ', '099108791'])(
    'allows a registered member to log back in after logout using %s',
    async (identifier) => {
      let savedUser: any = null;
      prisma.role.findUnique.mockResolvedValue({ id: 'role-1', ...role });
      prisma.user.findUnique.mockImplementation(async ({ where }: any) =>
        savedUser?.memberId === where.memberId ? savedUser : null,
      );
      prisma.user.findFirst.mockImplementation(async ({ where }: any) =>
        savedUser && where.OR.some((condition: any) =>
          Object.entries(condition).every(([key, value]) => savedUser[key] === value),
        ) ? savedUser : null,
      );
      const createUser = jest.fn(async ({ data }: any) => {
        savedUser = { ...data, id: user.id, role };
        return savedUser;
      });
      prisma.$transaction.mockImplementation((operation: any) =>
        operation({ user: { create: createUser }, authToken: prisma.authToken }),
      );
      const registration = {
        memberId: user.memberId,
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'MEMBER@example.com',
        phone: '099108791',
        password: 'ValidPass1',
        passwordConfirmation: 'ValidPass1',
      };
      const firstSession = await service.register(registration);
      if ('pendingApproval' in firstSession) throw new Error('Member registration must issue a session');
      await service.logout(firstSession.refreshToken);
      await expect(service.register(registration)).rejects.toMatchObject({ status: 409 });
      const nextSession = await service.login({ identifier, password: registration.password });
      expect(nextSession.user.memberId).toBe(user.memberId);
      expect(nextSession.refreshToken).not.toBe(firstSession.refreshToken);
      expect(createUser).toHaveBeenCalledTimes(1);
      expect(prisma.authToken.updateMany).toHaveBeenCalledWith({
        where: { tokenHash: expect.any(String), type: 'REFRESH', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      await expect(service.login({ identifier, password: 'wrong' }))
        .rejects.toBeInstanceOf(UnauthorizedException);
    },
  );

  it('returns the saved session even if the welcome notification fails', async () => {
    prisma.role.findUnique.mockResolvedValue({ id: 'role-1', ...role });
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation((operation: any) =>
      operation({
        user: { create: jest.fn().mockResolvedValue(user) },
        authToken: prisma.authToken,
      }),
    );
    notifications.create.mockRejectedValue(new Error('Notification store unavailable'));
    await expect(
      service.register({
        memberId: user.memberId,
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: user.email,
        password: 'ValidPass1',
        passwordConfirmation: 'ValidPass1',
      }),
    ).resolves.toMatchObject({ user: { id: user.id } });
  });

  it('does not wait for a stalled welcome notification before returning signup', async () => {
    prisma.role.findUnique.mockResolvedValue({ id: 'role-1', ...role });
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation((operation: any) =>
      operation({
        user: { create: jest.fn().mockResolvedValue(user) },
        authToken: prisma.authToken,
      }),
    );
    notifications.create.mockReturnValue(new Promise(() => {}));
    await expect(
      service.register({
        memberId: user.memberId,
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: user.email,
        password: 'ValidPass1',
        passwordConfirmation: 'ValidPass1',
      }),
    ).resolves.toMatchObject({ accessToken: 'access-token' });
  });

  it('creates the initial refresh session through the registration transaction', async () => {
    const transactionTokens = { create: jest.fn().mockResolvedValue({}) };
    prisma.role.findUnique.mockResolvedValue({ id: 'role-1', ...role });
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation((operation: any) =>
      operation({
        user: { create: jest.fn().mockResolvedValue(user) },
        authToken: transactionTokens,
      }),
    );
    await service.register({
      memberId: user.memberId,
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: user.email,
      password: 'ValidPass1',
      passwordConfirmation: 'ValidPass1',
    });
    expect(transactionTokens.create).toHaveBeenCalledTimes(1);
    expect(prisma.authToken.create).not.toHaveBeenCalled();
  });

  it('does not report valid tokens as invalid credentials when the database is unavailable', async () => {
    const databaseFailure = Object.assign(new Error('Database unavailable'), { code: 'P1001' });
    prisma.user.findUnique.mockRejectedValue(databaseFailure);
    await expect(service.verify('access-token')).rejects.toBe(databaseFailure);
  });

  it('rejects inactive accounts after valid credential verification', async () => {
    prisma.user.findFirst.mockResolvedValue({ ...user, status: 'INACTIVE' });
    await expect(
      service.login({ identifier: 'member@example.com', password: 'ValidPass1' }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rejects a protected profile request for a missing or inactive user', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.me('missing')).rejects.toBeInstanceOf(UnauthorizedException);
    prisma.user.findUnique.mockResolvedValue({ ...user, status: 'SUSPENDED' });
    await expect(service.me(user.id)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an invalid JWT used for a protected endpoint', async () => {
    jwt.verifyAsync.mockRejectedValueOnce(new Error('invalid signature'));
    await expect(service.verify('invalid-token')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an otherwise valid JWT when its account has been deactivated', async () => {
    prisma.user.findUnique.mockResolvedValue({ status: 'INACTIVE', role });
    await expect(service.verify('access-token')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('uses the current database role for a valid active session', async () => {
    prisma.user.findUnique.mockResolvedValue({ status: 'ACTIVE', role: { name: 'AUDITOR' } });
    await expect(service.verify('access-token')).resolves.toEqual({
      sub: user.id,
      role: 'AUDITOR',
    });
  });

  it('uses Admin permissions for an existing session after the Group Manager migration', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: user.id, role: 'GROUP_MANAGER' });
    prisma.user.findUnique.mockResolvedValue({ status: 'ACTIVE', role: { name: 'ADMIN' } });
    await expect(service.verify('existing-session')).resolves.toEqual({ sub: user.id, role: 'ADMIN' });
  });

  it('requires a reset-delivery provider in production', async () => {
    const originalEnvironment = process.env.NODE_ENV;
    const originalWebhook = process.env.PASSWORD_RESET_WEBHOOK_URL;
    process.env.NODE_ENV = 'production';
    delete process.env.PASSWORD_RESET_WEBHOOK_URL;
    prisma.user.findFirst.mockResolvedValue(user);
    try {
      await expect(service.forgot({ identifier: user.email! })).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    } finally {
      process.env.NODE_ENV = originalEnvironment;
      if (originalWebhook === undefined) delete process.env.PASSWORD_RESET_WEBHOOK_URL;
      else process.env.PASSWORD_RESET_WEBHOOK_URL = originalWebhook;
    }
  });
});

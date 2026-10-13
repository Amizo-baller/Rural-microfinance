/* eslint-disable @typescript-eslint/no-explicit-any */
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

jest.mock('@nestjs/jwt', () => ({ JwtService: class JwtService {} }));

import { AuthService } from './auth.service';

const role = { name: 'MEMBER' };
const user = {
  id: 'user-1',
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
    prisma.user.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: user.id });
    prisma.$transaction.mockImplementation((operation: any) =>
      operation({
        user: { create: jest.fn().mockResolvedValue(user) },
        authToken: prisma.authToken,
        groupMember: { count: jest.fn(), create: jest.fn() },
      }),
    );
    await expect(
      service.register({
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'member@example.com',
        password: 'ValidPass1',
        passwordConfirmation: 'ValidPass1',
      }),
    ).resolves.toMatchObject({ accessToken: 'access-token' });
    await expect(
      service.register({
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'member@example.com',
        password: 'ValidPass1',
        passwordConfirmation: 'ValidPass1',
      }),
    ).rejects.toMatchObject({ status: 409 });
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

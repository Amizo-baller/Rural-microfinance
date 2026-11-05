/* eslint-disable @typescript-eslint/no-explicit-any */
import { Wallet } from 'ethers';
import { AuthService } from './auth.service';
jest.mock('@nestjs/jwt', () => ({ JwtService: class JwtService {} }));

describe('wallet identity and signing', () => {
  const wallet = Wallet.createRandom(), other = Wallet.createRandom();
  let db: any, jwt: any, service: AuthService, user: any, challenge: any;
  beforeEach(() => {
    process.env.JWT_SECRET = 'wallet-test-secret-at-least-thirty-two-characters';
    process.env.WALLET_AUTH_ORIGIN = 'http://localhost:8084';
    user = { id: 'user-1', memberId: 'WALLET001', email: 'wallet@example.test', phone: null,
      status: 'ACTIVE', blockchainAddress: wallet.address.toLowerCase(), role: { name: 'MEMBER' } };
    challenge = null;
    db = { user: { findFirst: jest.fn(async () => user), findUnique: jest.fn(async () => user), update: jest.fn(async () => user) },
      authToken: { create: jest.fn(async ({ data }) => {
        if (data.type.startsWith('WALLET_')) challenge = { id: 'challenge', ...data, revokedAt: null };
        return data;
      }), findFirst: jest.fn(async ({ where }) => {
        if (!challenge || challenge.type !== where.type || challenge.tokenHash !== where.tokenHash ||
          challenge.walletAddress !== where.walletAddress || challenge.revokedAt || challenge.expiresAt < new Date() ||
          (where.userId && where.userId !== challenge.userId)) return null;
        return { ...challenge };
      }), updateMany: jest.fn(async ({ where }) => {
        if (where.id) { if (challenge.revokedAt) return { count: 0 }; challenge.revokedAt = new Date(); }
        return { count: 1 };
      }) }, auditLog: { create: jest.fn() } };
    db.$transaction = jest.fn((work) => work(db));
    jwt = { signAsync: jest.fn().mockResolvedValue('wallet-access-token'), verifyAsync: jest.fn() };
    service = new AuthService(db, jwt, { create: jest.fn() } as any);
  });
  async function proof(linkUserId?: string) {
    const { message } = await service.walletChallenge({ address: wallet.address, chainId: '31337' }, linkUserId);
    return { address: wallet.address, message, signature: await wallet.signMessage(message) };
  }
  it('uses an expiring, domain-bound challenge that cannot serve as a refresh or password reset token', async () => {
    const dto = await proof();
    expect(dto.message).toContain('localhost:8084 wants you to sign in');
    expect(dto.message).toContain('Chain ID: 31337');
    expect(dto.message).toContain('URI: http://localhost:8084');
    expect(challenge.type).toBe('WALLET_LOGIN');
    expect(challenge.tokenHash).not.toBe(dto.message);
    expect(challenge.expiresAt.getTime() - Date.now()).toBeGreaterThan(4 * 60 * 1000);
  });
  it('authenticates a real signature as the existing user and preserves the stored role', async () => {
    const result = await service.walletProof(await proof());
    expect(result).toMatchObject({ accessToken: 'wallet-access-token', user: { id: user.id, role: 'MEMBER', walletAddress: wallet.address.toLowerCase() } });
    expect(jwt.signAsync).toHaveBeenCalledWith(expect.objectContaining({ walletAddress: wallet.address.toLowerCase() }), expect.any(Object));
    expect(db.authToken.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ type: 'REFRESH', walletAddress: wallet.address.toLowerCase() }) });
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: user.id }, data: { lastLoginAt: expect.any(Date) } });
  });
  it('rejects a different signing account', async () => {
    const dto = await proof(); dto.signature = await other.signMessage(dto.message);
    await expect(service.walletProof(dto)).rejects.toMatchObject({ status: 401 });
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });
  it.each(['ADMIN', 'TREASURER', 'MEMBER'])('returns the database-assigned %s role after wallet login', async (role) => {
    user.role.name = role;
    const result = await service.walletProof(await proof());
    expect(result).toMatchObject({ user: { id: user.id, role, walletAddress: wallet.address.toLowerCase() } });
    expect(jwt.signAsync).toHaveBeenCalledWith(expect.objectContaining({ role }), expect.any(Object));
  });
  it('rejects modified messages even when signed by the correct wallet', async () => {
    const dto = await proof(); dto.message += '\nForged role: ADMIN'; dto.signature = await wallet.signMessage(dto.message);
    await expect(service.walletProof(dto)).rejects.toMatchObject({ status: 401 });
  });
  it('rejects an expired nonce', async () => {
    const dto = await proof(); challenge.expiresAt = new Date(0);
    await expect(service.walletProof(dto)).rejects.toMatchObject({ status: 401 });
  });
  it('rejects a reused nonce and a concurrent claim that lost the race', async () => {
    const dto = await proof(); await service.walletProof(dto);
    await expect(service.walletProof(dto)).rejects.toMatchObject({ status: 401 });
    const fresh = await proof(); db.authToken.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.walletProof(fresh)).rejects.toMatchObject({ status: 401 });
    expect(jwt.signAsync).toHaveBeenCalledTimes(1);
  });
  it('checks account status again after a challenge was issued', async () => {
    const dto = await proof(); user.status = 'SUSPENDED';
    await expect(service.walletProof(dto)).rejects.toMatchObject({ status: 401 });
  });
  it('does not silently create an account for an unlinked wallet', async () => {
    db.user.findFirst.mockResolvedValue(null);
    await expect(service.walletChallenge({ address: other.address, chainId: '31337' })).rejects.toMatchObject({ status: 401 });
    expect(db.authToken.create).not.toHaveBeenCalled();
  });
  it('binds linking to the authenticated account and the signed challenge purpose', async () => {
    const dto = await proof(user.id);
    await expect(service.walletProof(dto)).rejects.toMatchObject({ status: 401 });
    await expect(service.walletProof(dto, 'another-user')).rejects.toMatchObject({ status: 401 });
    db.user.findFirst.mockResolvedValue(null);
    await expect(service.walletProof(dto, user.id)).resolves.toMatchObject({ linked: true, address: wallet.address.toLowerCase() });
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: user.id }, data: { blockchainAddress: wallet.address.toLowerCase() } });
  });
  it('refuses to link a wallet already owned by someone else', async () => {
    const dto = await proof(user.id);
    db.user.findFirst.mockResolvedValue({ id: 'other-user' });
    await expect(service.walletProof(dto, user.id)).rejects.toMatchObject({ status: 409 });
    expect(db.user.update).not.toHaveBeenCalled();
  });
  it('invalidates a wallet JWT if that wallet is no longer linked', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: user.id, role: 'MEMBER', walletAddress: other.address.toLowerCase() });
    await expect(service.verify('old-wallet-token')).rejects.toMatchObject({ status: 401 });
    expect(db.user.findUnique).toHaveBeenCalled();
  });
  it('uses the current database role instead of a stale privileged JWT claim', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: user.id, role: 'ADMIN', walletAddress: wallet.address.toLowerCase() });
    user.role.name = 'MEMBER';
    await expect(service.verify('previously-issued-token')).resolves.toMatchObject({ role: 'MEMBER' });
  });
  it('rejects a wallet JWT after its account is suspended', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: user.id, role: 'ADMIN', walletAddress: wallet.address.toLowerCase() });
    user.status = 'SUSPENDED';
    await expect(service.verify('previously-issued-token')).rejects.toMatchObject({ status: 401 });
  });
});

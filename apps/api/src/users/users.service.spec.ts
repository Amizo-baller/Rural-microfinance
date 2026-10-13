/* eslint-disable @typescript-eslint/no-explicit-any */
import { ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';

describe('UsersService access rules', () => {
  const target = { id: 'target-user', role: { name: 'MEMBER' } };
  let prisma: any;
  let service: UsersService;

  beforeEach(() => {
    prisma = { user: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() }, authToken: { updateMany: jest.fn() }, $transaction: jest.fn() };
    service = new UsersService(prisma);
  });

  it('allows a member to view and edit only their own profile', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'member-1', firstName: 'Ama' });
    await expect(service.get('other-user', { sub: 'member-1', role: 'MEMBER' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.get('member-1', { sub: 'member-1', role: 'MEMBER' })).resolves.toMatchObject({ id: 'member-1' });
  });

  it('allows an admin to view and update another non-super-admin user', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'target-user', firstName: 'Ama' }).mockResolvedValueOnce(target);
    prisma.user.update.mockResolvedValue({ id: 'target-user', firstName: 'Ama', lastName: 'New' });
    await expect(service.get('target-user', { sub: 'admin-1', role: 'ADMIN' })).resolves.toMatchObject({ id: 'target-user' });
    await expect(service.update('target-user', { lastName: 'New' }, { sub: 'admin-1', role: 'ADMIN' })).resolves.toMatchObject({ lastName: 'New' });
  });

  it('prevents an admin from changing a super administrator profile', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'super-1', role: { name: 'SUPER_ADMIN' } });
    await expect(service.update('super-1', { firstName: 'Changed' }, { sub: 'admin-1', role: 'ADMIN' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows only super administrators to delete users', async () => {
    await expect(service.remove('target-user', { sub: 'admin-1', role: 'ADMIN' })).rejects.toBeInstanceOf(ForbiddenException);
    prisma.user.findUnique.mockResolvedValue(target);
    prisma.user.update.mockReturnValue({});
    prisma.authToken.updateMany.mockReturnValue({});
    prisma.$transaction.mockResolvedValue([]);
    await expect(service.remove('target-user', { sub: 'super-1', role: 'SUPER_ADMIN' })).resolves.toBeUndefined();
  });

  it('does not let a manager deactivate their own account', async () => {
    prisma.user.findUnique.mockResolvedValue(target);
    await expect(service.updateStatus('target-user', 'INACTIVE' as any, { sub: 'target-user', role: 'SUPER_ADMIN' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('revokes refresh sessions when a manager deactivates a user', async () => {
    prisma.user.findUnique.mockResolvedValue(target);
    prisma.user.update.mockReturnValue({ id: 'target-user', status: 'SUSPENDED' });
    prisma.authToken.updateMany.mockReturnValue({ count: 1 });
    prisma.$transaction.mockResolvedValue([{ id: 'target-user', status: 'SUSPENDED' }, { count: 1 }]);
    await expect(service.updateStatus('target-user', 'SUSPENDED' as any, { sub: 'admin-1', role: 'ADMIN' })).resolves.toMatchObject({ status: 'SUSPENDED' });
    expect(prisma.authToken.updateMany).toHaveBeenCalled();
  });

  it('allows an administrator to reactivate an inactive user without revoking new sessions', async () => {
    prisma.user.findUnique.mockResolvedValue(target);
    prisma.user.update.mockReturnValue({ id: 'target-user', status: 'ACTIVE' });
    prisma.$transaction.mockResolvedValue([{ id: 'target-user', status: 'ACTIVE' }]);
    await expect(service.updateStatus('target-user', 'ACTIVE' as any, { sub: 'admin-1', role: 'ADMIN' })).resolves.toMatchObject({ status: 'ACTIVE' });
    expect(prisma.authToken.updateMany).not.toHaveBeenCalled();
  });
});

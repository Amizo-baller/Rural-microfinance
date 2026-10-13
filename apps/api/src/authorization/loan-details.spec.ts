import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { LoansService } from './loans.service';
import { PrismaService } from '../prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('loan detail access', () => {
  const findUnique = jest.fn();
  const prisma = { loan: { findUnique } } as unknown as PrismaService;
  const service = new LoansService(prisma, {} as NotificationsService);
  const loan = {
    id: 'loan',
    loanReference: 'LN-001',
    outstandingBalance: '120',
    groupMember: { userId: 'owner' },
    status: 'ACTIVE',
  };
  beforeEach(() => {
    findUnique.mockReset();
    findUnique.mockResolvedValue(loan);
  });
  it('returns the owner loan balance without member identity', async () => {
    const details = await service.getLoan('loan', { sub: 'owner', role: 'MEMBER' });
    expect(details.outstandingBalance).toBe('120');
    expect(details).not.toHaveProperty('groupMember');
  });
  it('rejects a different member', async () => {
    await expect(service.getLoan('loan', { sub: 'other', role: 'MEMBER' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
  it.each(['LOAN_OFFICER', 'ADMIN', 'SUPER_ADMIN'])(
    'allows %s to inspect managed loans',
    async (role) => {
      await expect(service.getLoan('loan', { sub: 'staff', role })).resolves.toHaveProperty(
        'loanReference',
        'LN-001',
      );
    },
  );
  it('returns a missing-loan error', async () => {
    findUnique.mockResolvedValue(null);
    await expect(
      service.getLoan('missing', { sub: 'owner', role: 'MEMBER' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

import { Prisma } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { MonimePayoutService } from './monime-payout.service';

describe('MonimePayoutService', () => {
  type MockModel = { findUnique: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock; update: jest.Mock; updateMany: jest.Mock; create: jest.Mock };
  type MockDb = { withdrawalRequest: MockModel; savingsAccount: MockModel; transaction: MockModel; notification: MockModel; auditLog: MockModel; $transaction: jest.Mock };
  let db: MockDb;
  let service: MonimePayoutService;
  let fetchMock: jest.Mock;
  let originalFetch: typeof fetch;
  const row = (overrides: Record<string, unknown> = {}) => ({
    id: 'withdrawal-id', status: 'PROCESSING', payoutId: null,
    payoutIdempotencyKey: 'wd-withdrawal-id', payoutDestination: { type: 'momo', providerId: 'orange', accountNumber: '+23276123456' },
    amount: new Prisma.Decimal('20.00'), savingsAccountId: 'account', requesterId: 'member', reference: 'WD-reference', reason: 'School fees',
    savingsAccount: { currency: 'SLE', groupMemberId: 'membership', groupMember: { groupId: 'group' } },
    ...overrides,
  });
  const response = (status: string, id = 'payout-id') => ({
    ok: true, status: 200, json: async () => ({ success: true, result: { id, status, amount: { currency: 'SLE', value: 2000 }, fees: [{ amount: { value: 100 } }], destination: { transactionReference: 'provider-ref' } } }),
  });
  beforeEach(() => {
    process.env.PAYMENT_PROVIDER = 'monime';
    process.env.MONIME_ACCESS_TOKEN = 'mon_live_test';
    process.env.MONIME_SPACE_ID = 'spc-test';
    process.env.MONIME_WEBHOOK_SECRET = 'test-webhook-secret';
    originalFetch = global.fetch;
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const model = () => ({ findUnique: jest.fn().mockResolvedValue(row()), findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }), create: jest.fn() });
    db = { withdrawalRequest: model(), savingsAccount: model(), transaction: model(), notification: model(), auditLog: model(), $transaction: jest.fn() };
    db.savingsAccount.findUnique.mockResolvedValue({ balance: new Prisma.Decimal('50.00') });
    db.$transaction = jest.fn((work: (tx: MockDb) => unknown) => work(db));
    service = new MonimePayoutService(db as unknown as ConstructorParameters<typeof MonimePayoutService>[0]);
  });
  afterEach(() => { global.fetch = originalFetch; delete process.env.PAYMENT_PROVIDER; delete process.env.MONIME_ACCESS_TOKEN; delete process.env.MONIME_SPACE_ID; delete process.env.MONIME_WEBHOOK_SECRET; });

  const signedWebhook = (eventId = 'event-1', timestamp = Math.floor(Date.now() / 1000)) => {
    const rawBody = Buffer.from(JSON.stringify({ event: { id: eventId, name: 'payout.completed' }, object: { id: 'payout-id', type: 'payout' }, data: { id: 'payout-id' } }));
    const signature = createHmac('sha256', 'test-webhook-secret').update(`${timestamp}_`).update(rawBody).digest('base64');
    return { rawBody, signatureHeader: `t=${timestamp},v1=${signature}` };
  };

  it('keeps a pending payout processing and uses its persistent idempotency key', async () => {
    fetchMock.mockResolvedValue(response('pending'));
    await service.process('withdrawal-id');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.monime.io/v1/payouts');
    expect(fetchMock.mock.calls[0][1].headers['Idempotency-Key']).toBe('wd-withdrawal-id');
    expect(db.withdrawalRequest.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ payoutId: 'payout-id', payoutNextAttemptAt: expect.any(Date) }) }));
    expect(db.transaction.create).not.toHaveBeenCalled();
  });

  it('does not turn a payout timeout into success and leaves it for retry', async () => {
    fetchMock.mockRejectedValue(new Error('timeout'));
    await service.process('withdrawal-id');
    expect(db.withdrawalRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'withdrawal-id', status: 'PROCESSING' }, data: expect.objectContaining({ payoutNextAttemptAt: expect.any(Date) }) }));
    expect(db.transaction.create).not.toHaveBeenCalled();
  });

  it('settles a completed payout once, even if reconciliation repeats', async () => {
    fetchMock.mockResolvedValue(response('completed'));
    db.withdrawalRequest.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await service.process('withdrawal-id');
    await service.process('withdrawal-id');
    expect(db.transaction.create).toHaveBeenCalledTimes(1);
    expect(db.savingsAccount.update).toHaveBeenCalledWith(expect.objectContaining({ data: { balance: { decrement: new Prisma.Decimal(1) } } }));
    expect(db.notification.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ title: 'Withdrawal successful' }) }));
  });

  it('releases a failed payout reservation and notifies the member', async () => {
    fetchMock.mockResolvedValue(response('failed'));
    await service.process('withdrawal-id');
    expect(db.savingsAccount.update).toHaveBeenCalledWith(expect.objectContaining({ data: { balance: { increment: row().amount } } }));
    expect(db.notification.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ title: 'Withdrawal failed' }) }));
  });

  it('authenticates the official Monime signature format and safely reconciles duplicate events', async () => {
    fetchMock.mockResolvedValue(response('completed'));
    db.withdrawalRequest.findFirst.mockResolvedValue({ id: 'withdrawal-id', status: 'PROCESSING' });
    db.withdrawalRequest.findUnique.mockResolvedValue(row({ payoutId: 'payout-id' }));
    db.withdrawalRequest.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const webhook = signedWebhook();

    await service.handleWebhook(webhook.rawBody, webhook.signatureHeader);
    await service.handleWebhook(webhook.rawBody, webhook.signatureHeader);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith('https://api.monime.io/v1/payouts/payout-id', expect.any(Object));
    expect(db.transaction.create).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid and stale webhook signatures before contacting Monime', async () => {
    const invalid = signedWebhook();
    await expect(service.handleWebhook(invalid.rawBody, `t=${Math.floor(Date.now() / 1000)},v1=invalid`)).rejects.toThrow('Invalid Monime signature');
    const stale = signedWebhook('stale-event', Math.floor(Date.now() / 1000) - 301);
    await expect(service.handleWebhook(stale.rawBody, stale.signatureHeader)).rejects.toThrow('Expired Monime webhook signature');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

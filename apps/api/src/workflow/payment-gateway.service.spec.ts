import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaymentGatewayService } from './payment-gateway.service';

describe('PaymentGatewayService', () => {
  const keys = ['PAYMENT_PROVIDER', 'PAYMENT_SECRET_KEY', 'PAYMENT_RETURN_URL', 'PAYMENT_TEST_BASE_URL',
    'MONIME_ACCESS_TOKEN', 'MONIME_SPACE_ID', 'MONIME_API_BASE_URL', 'NODE_ENV'];
  let environment: Record<string, string | undefined>;
  let fetchMock: jest.SpyInstance;
  let service: PaymentGatewayService;
  const reference = 'PAY-client-test-request';
  const sessionId = 'cs-unit-test';
  const amount = new Prisma.Decimal('10.25');
  const completed = () => ({ id: sessionId, reference, status: 'completed',
    lineItems: { data: [{ quantity: 1, price: { currency: 'SLE', value: 1025 } }] } });
  function respond(result: unknown, status = 200) {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ success: true, result }), { status }));
  }
  beforeEach(() => {
    environment = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    keys.forEach((key) => delete process.env[key]);
    process.env.NODE_ENV = 'test';
    process.env.PAYMENT_PROVIDER = 'monime';
    process.env.MONIME_ACCESS_TOKEN = 'mon_test_unit-test-token';
    process.env.MONIME_SPACE_ID = 'spc-unit-test-space';
    fetchMock = jest.spyOn(global, 'fetch');
    service = new PaymentGatewayService();
  });
  afterEach(() => {
    fetchMock.mockRestore();
    keys.forEach((key) => {
      if (environment[key] === undefined) delete process.env[key];
      else process.env[key] = environment[key];
    });
  });
  it('requires real configuration and distinguishes test and live tokens', () => {
    expect(service.configured()).toBe(true);
    expect(service.mode()).toBe('test');
    process.env.MONIME_ACCESS_TOKEN = 'mon_live-format-unit-token';
    expect(service.mode()).toBe('live');
    process.env.MONIME_ACCESS_TOKEN = 'PASTE_YOUR_TEST_TOKEN_HERE';
    expect(service.configured()).toBe(false);
    process.env.MONIME_ACCESS_TOKEN = 'mon_test_unit-test-token';
    process.env.MONIME_SPACE_ID = '';
    expect(service.configured()).toBe(false);
  });
  it('does not send credentials to a custom Monime API origin', async () => {
    process.env.MONIME_API_BASE_URL = 'https://untrusted.example';
    await expect(service.checkout(reference, amount, 'member@example.com', 'Member', 'SLE'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('creates SLE checkout in minor units with stable idempotency and merchant headers', async () => {
    respond({ id: sessionId, reference, redirectUrl: 'https://checkout.monime.io/test' });
    await expect(service.checkout(reference, amount, 'member@example.com', 'Member', 'SLE'))
      .resolves.toEqual({ gateway: 'monime', gatewayId: sessionId, url: 'https://checkout.monime.io/test' });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.monime.io/v1/checkout-sessions');
    expect(options.headers).toMatchObject({ Authorization: 'Bearer mon_test_unit-test-token',
      'Monime-Space-Id': 'spc-unit-test-space', 'Monime-Version': 'caph.2025-08-23' });
    expect(options.headers['Idempotency-Key']).toHaveLength(64);
    expect(JSON.parse(options.body).lineItems[0]).toMatchObject({
      quantity: 1, type: 'custom', price: { currency: 'SLE', value: 1025 },
    });
    await service.checkout(reference, amount, 'member@example.com', 'Member', 'SLE');
    expect(fetchMock.mock.calls[1][1].headers['Idempotency-Key']).toBe(options.headers['Idempotency-Key']);
  });
  it.each(['0', '-1', '1.001', '999999999999999999'])('rejects unsupported amount %s', async (value) => {
    await expect(service.checkout(reference, new Prisma.Decimal(value), 'member@example.com', 'Member', 'SLE'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects a non-SLE payment', async () => {
    await expect(service.checkout(reference, amount, 'member@example.com', 'Member', 'USD'))
      .rejects.toBeInstanceOf(ConflictException);
  });
  it('does not accept an insecure checkout URL', async () => {
    respond({ id: sessionId, reference, redirectUrl: 'http://merchant.example/checkout' });
    await expect(service.checkout(reference, amount, 'member@example.com', 'Member', 'SLE'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it('verifies a completed session against its stored ID, reference, currency and amount', async () => {
    respond(completed());
    await expect(service.verify(reference, amount, 'monime', 'SLE', sessionId)).resolves.toBe(sessionId);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.monime.io/v1/checkout-sessions/' + sessionId);
  });
  it.each(['pending', 'cancelled', 'expired'])('rejects a session that is %s', async (status) => {
    respond({ ...completed(), status });
    await expect(service.verify(reference, amount, 'monime', 'SLE', sessionId))
      .rejects.toBeInstanceOf(ConflictException);
  });
  it.each([
    { ...completed(), reference: 'OTHER' },
    { ...completed(), id: 'other-session' },
    { ...completed(), lineItems: { data: [{ quantity: 1, price: { currency: 'SLE', value: 100 } }] } },
    { ...completed(), lineItems: { data: [{ quantity: 1, price: { currency: 'USD', value: 1025 } }] } },
    { ...completed(), lineItems: { data: [] } },
    { ...completed(), lineItems: { data: [{ quantity: 2, price: { currency: 'SLE', value: 1025 } }] } },
  ])('rejects completed sessions with mismatched details: %j', async (session) => {
    respond(session);
    await expect(service.verify(reference, amount, 'monime', 'SLE', sessionId))
      .rejects.toBeInstanceOf(ConflictException);
  });
  it('requires the saved session ID and rejects a different provider', async () => {
    await expect(service.verify(reference, amount, 'monime', 'SLE')).rejects.toBeInstanceOf(ConflictException);
    await expect(service.verify(reference, amount, 'paystack', 'SLE', sessionId)).rejects.toBeInstanceOf(ConflictException);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('reports invalid merchant credentials without leaking provider responses', async () => {
    respond({}, 401);
    await expect(service.verify(reference, amount, 'monime', 'SLE', sessionId))
      .rejects.toThrow('Monime rejected the merchant credentials or permissions');
  });
  it('fails closed when Monime is unavailable or returns an invalid envelope', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network error'));
    await expect(service.verify(reference, amount, 'monime', 'SLE', sessionId))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: false, result: completed() })));
    await expect(service.verify(reference, amount, 'monime', 'SLE', sessionId))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it('preserves Paystack minor-unit checkout behavior', async () => {
    process.env.PAYMENT_PROVIDER = 'paystack';
    process.env.PAYMENT_SECRET_KEY = 'unit-test-key';
    process.env.PAYMENT_RETURN_URL = 'https://merchant.example/return';
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { authorization_url: 'https://checkout.paystack.com/test' } })));
    await service.checkout(reference, amount, 'member@example.com', 'Member', 'SLE');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).amount).toBe('1025');
  });
});

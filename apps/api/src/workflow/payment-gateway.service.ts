import { Injectable, ServiceUnavailableException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';

export class PaymentPendingException extends ConflictException {}

@Injectable()
export class PaymentGatewayService {
  configured() {
    if (process.env.PAYMENT_PROVIDER === 'monime') {
      const token = process.env.MONIME_ACCESS_TOKEN?.trim() ?? '';
      const space = process.env.MONIME_SPACE_ID?.trim() ?? '';
      const base = (process.env.MONIME_API_BASE_URL ?? 'https://api.monime.io').replace(/\/+$/, '');
      return /^mon_(?:test_)?[^\s]+$/.test(token) && !/PASTE_|YOUR_/i.test(token)
        && /^spc-[A-Za-z0-9-]+$/.test(space) && space.length <= 64
        && base === 'https://api.monime.io';
    }
    return ['flutterwave', 'paystack'].includes(process.env.PAYMENT_PROVIDER ?? '')
      && Boolean(process.env.PAYMENT_SECRET_KEY && process.env.PAYMENT_RETURN_URL);
  }
  mode(): 'test' | 'live' | null {
    if (!this.configured() || process.env.PAYMENT_PROVIDER !== 'monime') return null;
    return process.env.MONIME_ACCESS_TOKEN!.trim().startsWith('mon_test_') ? 'test' : 'live';
  }
  private configuration() {
    if (!this.configured()) throw new ServiceUnavailableException('Online checkout is not configured. The treasurer must select a payment gateway and configure its merchant credentials.');
    const provider = process.env.PAYMENT_PROVIDER!;
    let base = provider === 'monime' ? 'https://api.monime.io/v1'
      : provider === 'flutterwave' ? 'https://api.flutterwave.com/v3' : 'https://api.paystack.co';
    if (process.env.NODE_ENV === 'test' && process.env.PAYMENT_TEST_BASE_URL) {
      const testUrl = new URL(process.env.PAYMENT_TEST_BASE_URL);
      if (testUrl.hostname !== '127.0.0.1') throw new ServiceUnavailableException('Test gateway must be local.');
      base = testUrl.toString().replace(/\/$/, '');
    }
    return { provider, base, key: provider === 'monime' ? process.env.MONIME_ACCESS_TOKEN!.trim() : process.env.PAYMENT_SECRET_KEY! };
  }
  private async call(route: string, body?: object, idempotencyKey?: string) {
    const config = this.configuration();
    try {
      const result = await fetch(config.base + route, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json',
          ...(config.provider === 'monime' ? {
            'Monime-Space-Id': process.env.MONIME_SPACE_ID!.trim(),
            'Monime-Version': 'caph.2025-08-23',
            ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
          } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(12000), redirect: 'error',
      });
      if (config.provider === 'monime' && [401, 403].includes(result.status))
        throw new ServiceUnavailableException('Monime rejected the merchant credentials or permissions. Ask the treasurer to check the access token and Space ID.');
      if (!result.ok) throw new Error('Gateway rejected request');
      const payload = await result.json();
      if (config.provider === 'monime') {
        if (payload?.success !== true || !payload.result) throw new Error('Invalid Monime response');
        return payload.result;
      }
      return payload.data;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('The payment gateway could not complete this request. Retry or contact the treasurer; no balance has been credited.');
    }
  }
  async checkout(reference: string, amount: Prisma.Decimal, email: string, name: string, currency: string): Promise<{ gateway: string; url: string; gatewayId?: string }> {
    const { provider } = this.configuration();
    if (provider === 'monime') {
      const value = amount.mul(100).toNumber();
      if (currency !== 'SLE' || !Number.isSafeInteger(value) || value <= 0)
        throw new ConflictException('Monime checkout requires a positive SLE amount with at most two decimal places.');
      const returnUrl = process.env.PAYMENT_RETURN_URL?.trim();
      if (returnUrl && !this.secureCheckoutUrl(returnUrl))
        throw new ServiceUnavailableException('PAYMENT_RETURN_URL must be a secure HTTPS address.');
      const idempotencyKey = 'rcm-' + createHash('sha256')
        .update(`${process.env.MONIME_SPACE_ID}:${reference}`).digest('hex').slice(0, 60);
      const session = await this.call('/checkout-sessions', {
        name: 'Rural Microfinance payment', reference,
        lineItems: [{ name: 'Member payment', type: 'custom', quantity: 1,
          reference, price: { currency, value } }],
        metadata: { reference, receiptEmail: email, customerName: name },
        ...(returnUrl ? { successUrl: returnUrl, cancelUrl: returnUrl } : {}),
      }, idempotencyKey);
      if (typeof session.id !== 'string' || !session.id || session.id.length > 100 ||
          session.reference !== reference || !this.secureCheckoutUrl(session.redirectUrl))
        throw new ServiceUnavailableException('Monime did not provide a valid checkout session.');
      return { gateway: provider, url: session.redirectUrl, gatewayId: session.id };
    }
    const result = provider === 'flutterwave'
      ? await this.call('/payments', { tx_ref: reference, amount: amount.toFixed(2), currency, redirect_url: process.env.PAYMENT_RETURN_URL, customer: { email, name }, customizations: { title: 'Mile 91 MicroFinance' } })
      : await this.call('/transaction/initialize', { reference, amount: amount.mul(100).toFixed(0), currency, email, callback_url: process.env.PAYMENT_RETURN_URL });
    const url = result?.link ?? result?.authorization_url;
    if (!this.secureCheckoutUrl(url))
      throw new ServiceUnavailableException('The gateway did not provide a secure checkout link.');
    return { gateway: provider, url };
  }
  private secureCheckoutUrl(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    try {
      const url = new URL(value);
      return !url.username && !url.password && (url.protocol === 'https:' ||
        (process.env.NODE_ENV === 'test' && url.protocol === 'http:' && url.hostname === '127.0.0.1'));
    } catch { return false; }
  }
  async verify(reference: string, amount: Prisma.Decimal, gateway: string, currency: string, gatewayId?: string | null) {
    const { provider } = this.configuration();
    if (gateway !== provider) throw new ConflictException('This payment belongs to a different gateway configuration.');
    if (provider === 'monime') {
      if (!gatewayId) throw new ConflictException('This payment has no Monime checkout session. Start checkout first.');
      const session = await this.call(`/checkout-sessions/${encodeURIComponent(gatewayId)}`);
      if (session.status !== 'completed')
        throw new PaymentPendingException('Payment is not yet completed at Monime. Complete checkout and retry verification.');
      const items = session.lineItems?.data;
      const item = Array.isArray(items) && items.length === 1 ? items[0] : undefined;
      if (session.id !== gatewayId || session.reference !== reference || currency !== 'SLE' ||
          item?.quantity !== 1 || item?.price?.currency !== currency ||
          !Number.isSafeInteger(item?.price?.value) || item.price.value <= 0 ||
          !amount.mul(100).equals(String(item.price.value)))
        throw new ConflictException('Monime payment details do not match this member payment. It cannot be confirmed.');
      return gatewayId;
    }
    const data = provider === 'flutterwave'
      ? await this.call(`/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`)
      : await this.call(`/transaction/verify/${encodeURIComponent(reference)}`);
    const paid = data?.status === (provider === 'flutterwave' ? 'successful' : 'success');
    if (!paid) throw new ConflictException('Payment is not yet successful at the gateway. Complete checkout or retry verification later.');
    const received = new Prisma.Decimal(String(data.amount));
    const expected = provider === 'paystack' ? amount.mul(100) : amount;
    if ((data.tx_ref ?? data.reference) !== reference || data.currency !== currency || !received.equals(expected) || !data.id)
      throw new ConflictException('Gateway payment details do not match this member payment. It cannot be confirmed.');
    return String(data.id);
  }
}

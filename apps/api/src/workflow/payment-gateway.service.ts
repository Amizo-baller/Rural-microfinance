import { Injectable, ServiceUnavailableException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

@Injectable()
export class PaymentGatewayService {
  configured() {
    return ['flutterwave', 'paystack'].includes(process.env.PAYMENT_PROVIDER ?? '')
      && Boolean(process.env.PAYMENT_SECRET_KEY && process.env.PAYMENT_RETURN_URL);
  }
  private configuration() {
    if (!this.configured()) throw new ServiceUnavailableException('Online checkout is not configured. The treasurer must select a payment gateway and configure its merchant credentials.');
    const provider = process.env.PAYMENT_PROVIDER!;
    let base = provider === 'flutterwave' ? 'https://api.flutterwave.com/v3' : 'https://api.paystack.co';
    if (process.env.NODE_ENV === 'test' && process.env.PAYMENT_TEST_BASE_URL) {
      const testUrl = new URL(process.env.PAYMENT_TEST_BASE_URL);
      if (testUrl.hostname !== '127.0.0.1') throw new ServiceUnavailableException('Test gateway must be local.');
      base = testUrl.toString().replace(/\/$/, '');
    }
    return { provider, base, key: process.env.PAYMENT_SECRET_KEY! };
  }
  private async call(route: string, body?: object) {
    const config = this.configuration();
    try {
      const result = await fetch(config.base + route, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(12000),
      });
      if (!result.ok) throw new Error('Gateway rejected request');
      const payload = await result.json();
      return payload.data;
    } catch {
      throw new ServiceUnavailableException('The payment gateway could not complete this request. Retry or contact the treasurer; no balance has been credited.');
    }
  }
  async checkout(reference: string, amount: Prisma.Decimal, email: string, name: string, currency: string) {
    const { provider } = this.configuration();
    const result = provider === 'flutterwave'
      ? await this.call('/payments', { tx_ref: reference, amount: amount.toFixed(2), currency, redirect_url: process.env.PAYMENT_RETURN_URL, customer: { email, name }, customizations: { title: 'Mile 91 MicroFinance' } })
      : await this.call('/transaction/initialize', { reference, amount: amount.mul(100).toFixed(0), currency, email, callback_url: process.env.PAYMENT_RETURN_URL });
    const url = result?.link ?? result?.authorization_url;
    if (typeof url !== 'string' || !(url.startsWith('https://') || (process.env.NODE_ENV === 'test' && url.startsWith('http://127.0.0.1:'))))
      throw new ServiceUnavailableException('The gateway did not provide a secure checkout link.');
    return { gateway: provider, url };
  }
  async verify(reference: string, amount: Prisma.Decimal, gateway: string, currency: string) {
    const { provider } = this.configuration();
    if (gateway !== provider) throw new ConflictException('This payment belongs to a different gateway configuration.');
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

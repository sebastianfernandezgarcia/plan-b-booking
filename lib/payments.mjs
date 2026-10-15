import { randomUUID } from 'node:crypto';

export class AppError extends Error {
  constructor(message, status = 409) { super(message); this.status = status; }
}

export function createPayments({ mode = 'demo', clientId, clientSecret, fetchImpl = fetch, origin = 'http://127.0.0.1:4320' } = {}) {
  if (!['demo', 'sandbox'].includes(mode)) throw new Error('PAYMENT_MODE must be demo or sandbox. Live payments are unsupported.');
  const calls = { create: 0, capture: 0, refund: 0 };
  if (mode === 'demo') return {
    mode, calls, ready: true,
    async create() { calls.create++; return { id: `DEMO-ORDER-${randomUUID()}`, status: 'CREATED' }; },
    async capture() { calls.capture++; return { id: `DEMO-CAPTURE-${randomUUID()}`, status: 'COMPLETED', amount: { currency_code: 'EUR', value: '60.00' } }; },
    async refund() { calls.refund++; return { id: `DEMO-REFUND-${randomUUID()}`, status: 'COMPLETED', amount: { currency_code: 'EUR', value: '60.00' } }; }
  };

  // Hard-coded sandbox host prevents configuration mistakes from reaching live PayPal.
  const base = 'https://api-m.sandbox.paypal.com';
  const ready = Boolean(clientId && clientSecret);
  let token, expiresAt = 0;
  async function request(path, body, key) {
    if (!ready) throw new AppError('Sandbox needs PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET. No payment was attempted.', 503);
    if (!token || Date.now() >= expiresAt) {
      const response = await fetchImpl(`${base}/v1/oauth2/token`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials'
      });
      const data = await response.json();
      if (!response.ok || !data.access_token) throw new AppError('Sandbox authentication failed. Check local sandbox credentials.', 502);
      token = data.access_token; expiresAt = Date.now() + Math.max(0, Number(data.expires_in) - 60) * 1000;
    }
    const response = await fetchImpl(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(key ? { 'PayPal-Request-Id': key } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const data = await response.json();
    if (!response.ok) {
      const code = String(data.details?.[0]?.issue || data.name || response.status).replace(/[^A-Z0-9_]/g, '');
      throw new AppError(`PayPal sandbox: ${code}. Current booking retained; retry the same action after reviewing the sandbox.`, 502);
    }
    return data;
  }
  function captureFrom(order) { return order.purchase_units?.flatMap(unit => unit.payments?.captures || [])[0]; }
  return {
    mode, calls, ready,
    async create(booking, key) {
      calls.create++;
      const data = await request('/v2/checkout/orders', {
        intent: 'CAPTURE', purchase_units: [{ reference_id: booking.id, custom_id: booking.id, description: 'Plan B Booking: fictional outdoor photo session deposit', amount: { currency_code: 'EUR', value: '60.00' } }],
        payment_source: { paypal: { experience_context: { shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW', return_url: `${origin}/?booking=${booking.id}&paypal=approved`, cancel_url: `${origin}/?booking=${booking.id}&paypal=cancelled` } } }
      }, key);
      const approve = data.links?.find(link => ['payer-action', 'approve'].includes(link.rel))?.href;
      if (!data.id || !approve || new URL(approve).hostname !== 'www.sandbox.paypal.com' || new URL(approve).protocol !== 'https:') throw new AppError('Unexpected sandbox order response. Inspect the sandbox before retrying.', 502);
      return { id: data.id, status: data.status, approve };
    },
    async capture(booking, key) {
      calls.capture++;
      const path = `/v2/checkout/orders/${encodeURIComponent(booking.order.id)}`;
      // Reconcile first: recover a capture whose response was lost without creating another capture.
      const current = await request(path);
      const existing = captureFrom(current);
      if (existing) return existing;
      if (current.status !== 'APPROVED') throw new AppError('Approve this order with a sandbox buyer in PayPal before confirming the deposit.', 409);
      const result = await request(`${path}/capture`, {}, key);
      const capture = captureFrom(result);
      if (!capture?.id) throw new AppError('Sandbox has not returned a capture. Retry to reconcile this same order.', 502);
      return capture;
    },
    async refund(booking, key) {
      calls.refund++;
      if (booking.refund?.id) return request(`/v2/payments/refunds/${encodeURIComponent(booking.refund.id)}`);
      return request(`/v2/payments/captures/${encodeURIComponent(booking.capture.id)}/refund`, { amount: { currency_code: 'EUR', value: '60.00' }, note_to_payer: 'Approved cancellation of a fictional outdoor session.' }, key);
    }
  };
}

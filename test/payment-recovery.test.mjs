import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BookingService } from '../lib/booking.mjs';
import { createPayments } from '../lib/payments.mjs';
import { createPlanner } from '../lib/planner.mjs';

const amount = { currency_code: 'EUR', value: '60.00' };
const brief = { brief: 'Outdoor portraits; a sheltered morning is also suitable.', day: '2026-10-24' };
const retryWindow = 5 * 60 * 60 * 1000;

// In-memory HTTP provider stub, not a PayPal sandbox session. Remote state survives
// construction of a new adapter so tests distinguish a lost response from a failed charge.
function sandboxStub({ loseCapture = false, loseRefund = false, captureStatus = 'COMPLETED', refundStatus = 'COMPLETED' } = {}) {
  const calls = [];
  let capture, refund, refundKey;
  const response = data => new Response(JSON.stringify(data), { status: 200 });
  const fetchImpl = async (url, options) => {
    assert.equal(new URL(url).origin, 'https://api-m.sandbox.paypal.com');
    const path = new URL(url).pathname;
    const key = options.headers['PayPal-Request-Id'];
    calls.push({ path, method: options.method, key });
    if (path === '/v1/oauth2/token') return response({ access_token: 'fake-contract-token', expires_in: 3600 });
    if (path === '/v2/checkout/orders' && options.method === 'POST') {
      return response({ id: 'STUB-ORDER', status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=STUB-ORDER' }] });
    }
    if (path === '/v2/checkout/orders/STUB-ORDER' && options.method === 'GET') {
      return response({ id: 'STUB-ORDER', status: capture ? 'COMPLETED' : 'APPROVED', purchase_units: capture ? [{ payments: { captures: [capture] } }] : [] });
    }
    if (path === '/v2/checkout/orders/STUB-ORDER/capture' && options.method === 'POST') {
      assert.equal(capture, undefined, 'a second capture POST must never be sent after reconciliation found the first');
      capture = { id: 'STUB-CAPTURE', status: captureStatus, amount };
      if (loseCapture) { loseCapture = false; throw new Error('Stub: capture accepted remotely; response lost'); }
      return response({ purchase_units: [{ payments: { captures: [capture] } }] });
    }
    if (path === '/v2/payments/captures/STUB-CAPTURE/refund' && options.method === 'POST') {
      if (refund) assert.equal(key, refundKey, 'an unknown refund outcome must reuse its persisted request ID');
      else { refundKey = key; refund = { id: 'STUB-REFUND', status: refundStatus, amount }; }
      if (loseRefund) { loseRefund = false; throw new Error('Stub: refund accepted remotely; response lost'); }
      return response(refund);
    }
    if (path === '/v2/payments/refunds/STUB-REFUND' && options.method === 'GET') return response(refund);
    throw new Error(`Unexpected stub request: ${options.method} ${path}`);
  };
  return {
    calls, fetchImpl,
    get capture() { return capture; },
    get refund() { return refund; },
    completeRefund() { refund.status = 'COMPLETED'; },
    posts(action) { return calls.filter(call => call.method === 'POST' && call.path.endsWith(`/${action}`)); }
  };
}

async function fixture(t, stubOptions) {
  const dir = await mkdtemp(join(tmpdir(), 'plan-b-recovery-test-'));
  // Only this test-owned temporary directory is removed; application ledgers are untouched.
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'bookings.json');
  const remote = sandboxStub(stubOptions);
  const planner = createPlanner();
  const restart = () => new BookingService({
    file, planner,
    payments: createPayments({ mode: 'sandbox', clientId: 'fake-id', clientSecret: 'fake-secret', fetchImpl: remote.fetchImpl })
  }).load();
  const service = await restart();
  const booking = await service.create(brief);
  await service.action(booking.id, 'approve', { slotId: 'coast' });
  await service.action(booking.id, 'order');
  return { service, id: booking.id, remote, restart, file };
}

async function proposeRefund(service, id) {
  await service.action(id, 'capture');
  const booking = await service.action(id, 'propose-change', { reason: 'Customer cannot attend; please cancel.', intent: 'refund' });
  return { changeId: booking.change.id, reviewed: true };
}

test('HTTP stub: capture accepted, response lost, restart recovers by GET without another capture', async t => {
  const { service, id, remote, restart, file } = await fixture(t, { loseCapture: true });
  await assert.rejects(service.action(id, 'capture'), /accepted remotely; response lost/);
  assert.equal(remote.capture.status, 'COMPLETED', 'the provider accepted payment before the response was lost');
  const retained = JSON.parse(await readFile(file, 'utf8')).bookings[0];
  assert.equal(retained.inFlight, 'capture');
  assert.equal(retained.capture, undefined, 'the local process did not receive the capture identity');
  const key = retained.requests.capture.id;
  assert.equal(remote.posts('capture')[0].key, key);

  const restored = await restart();
  await assert.rejects(restored.action(id, 'propose-change', { reason: 'Move it' }), /Reconcile capture/);
  const beforeRetry = remote.calls.length;
  const booked = await restored.action(id, 'capture');
  assert.equal(booked.state, 'booked');
  assert.equal(booked.inFlight, null);
  assert.deepEqual(booked.capture, remote.capture);
  assert.equal(booked.requests.capture.id, key);
  assert.deepEqual(remote.calls.slice(beforeRetry).map(call => [call.method, call.path]), [
    ['POST', '/v1/oauth2/token'], ['GET', '/v2/checkout/orders/STUB-ORDER']
  ]);
  assert.equal(remote.posts('capture').length, 1);
  assert.equal(booked.events.filter(entry => entry.label.includes('deposit confirmed')).length, 1);

  const persistedCompletion = await restart();
  const callsBefore = remote.calls.length;
  await persistedCompletion.action(id, 'capture');
  assert.equal(remote.calls.length, callsBefore, 'completed local payment needs no provider call after a second restart');
  assert.equal(persistedCompletion.get(id).capture.id, 'STUB-CAPTURE');
});

test('HTTP stub: unknown refund outcome reuses the persisted key; a known refund is read after restart', async t => {
  const { service, id, remote, restart, file } = await fixture(t, { loseRefund: true, refundStatus: 'PENDING' });
  const approval = await proposeRefund(service, id);
  await assert.rejects(service.action(id, 'refund', approval), /accepted remotely; response lost/);
  const retained = JSON.parse(await readFile(file, 'utf8')).bookings[0];
  assert.equal(retained.state, 'refund_pending');
  assert.equal(retained.refund, undefined);
  const key = retained.requests.refund.id;
  const restored = await restart();
  await assert.rejects(restored.action(id, 'reschedule', approval), /Reconcile refund/);
  const pending = await restored.action(id, 'refund');
  assert.equal(pending.refund.id, 'STUB-REFUND');
  assert.equal(pending.state, 'refund_pending');
  assert.equal(pending.history.length, 0, 'pending refund must not claim a completed cancellation');
  assert.deepEqual(remote.posts('refund').map(call => call.key), [key, key]);

  remote.completeRefund();
  const finalProcess = await restart();
  const beforeRead = remote.calls.length;
  const closed = await finalProcess.action(id, 'refund');
  assert.equal(closed.state, 'refunded');
  assert.equal(closed.history.length, 1);
  assert.equal(closed.history[0].refundCents, 6000);
  assert.deepEqual(remote.calls.slice(beforeRead).map(call => [call.method, call.path]), [
    ['POST', '/v1/oauth2/token'], ['GET', '/v2/payments/refunds/STUB-REFUND']
  ]);
  assert.equal(remote.posts('refund').length, 2, 'both POSTs are the same idempotent request, before the refund ID is known');
  assert.equal(remote.posts('capture').length, 1);
  const requestCount = remote.calls.length;
  await finalProcess.action(id, 'refund');
  assert.equal(remote.calls.length, requestCount);
});

test('five-hour retry boundary: capture reconciliation is allowed exactly at the limit', async t => {
  let now = Date.parse('2026-10-14T12:00:00Z');
  t.mock.method(Date, 'now', () => now);
  const { service, id, remote, restart } = await fixture(t, { loseCapture: true });
  await assert.rejects(service.action(id, 'capture'), /response lost/);
  now += retryWindow;
  const restored = await restart();
  const booked = await restored.action(id, 'capture');
  assert.equal(booked.state, 'booked');
  assert.equal(remote.posts('capture').length, 1);
});

for (const action of ['capture', 'refund']) {
  test(`expired ${action} recovery preserves the ledger and sends no request after restart`, async t => {
    let now = Date.parse('2026-10-14T12:00:00Z');
    t.mock.method(Date, 'now', () => now);
    const { service, id, remote, restart, file } = await fixture(t, { loseCapture: action === 'capture', loseRefund: action === 'refund' });
    const approval = action === 'refund' ? await proposeRefund(service, id) : {};
    await assert.rejects(service.action(id, action, approval), /response lost/);
    const bytesBefore = await readFile(file, 'utf8');
    const retained = service.get(id);
    now += retryWindow + 1;
    const restored = await restart();
    const requestCount = remote.calls.length;
    await assert.rejects(restored.action(id, action), /Automatic retry window expired/);
    assert.equal(remote.calls.length, requestCount, 'neither OAuth nor a payment request is sent after expiry');
    assert.equal(await readFile(file, 'utf8'), bytesBefore, 'expiry does not erase or rewrite financial evidence');
    assert.equal(restored.get(id).requests[action].id, retained.requests[action].id);
    assert.equal(restored.get(id).inFlight, action);
  });
}

for (const status of ['DECLINED', 'FAILED', 'DENIED']) {
  test(`terminal capture ${status} stays unconfirmed, retains evidence and requires manual review`, async t => {
    const { service, id, remote, restart, file } = await fixture(t, { captureStatus: status });
    const denied = await service.action(id, 'capture');
    assert.equal(denied.state, 'payment_pending');
    assert.equal(denied.capture.status, status);
    assert.equal(denied.inFlight, 'capture');
    assert.equal(denied.paymentIssue.manual, true);
    assert.equal(denied.paymentIssue.action, 'capture');
    assert.equal(denied.paymentIssue.status, status);
    assert.equal(denied.events.some(entry => entry.label.includes('deposit confirmed')), false);
    const bytesBefore = await readFile(file, 'utf8');
    const restored = await restart();
    const requestCount = remote.calls.length;
    await assert.rejects(restored.action(id, 'capture'), /manual|inspect/i);
    await assert.rejects(restored.action(id, 'order'), /Reconcile capture/);
    assert.equal(remote.calls.length, requestCount);
    assert.equal(await readFile(file, 'utf8'), bytesBefore);
  });
}

for (const status of ['FAILED', 'CANCELLED']) {
  test(`terminal refund ${status} preserves the deposit and never reports money returned`, async t => {
    const { service, id, remote, restart, file } = await fixture(t, { refundStatus: status });
    const approval = await proposeRefund(service, id);
    const failed = await service.action(id, 'refund', approval);
    assert.equal(failed.state, 'refund_pending');
    assert.equal(failed.refund.status, status);
    assert.equal(failed.capture.status, 'COMPLETED');
    assert.equal(failed.depositCents, 6000);
    assert.equal(failed.selectedSlot, 'coast');
    assert.equal(failed.revision, 0);
    assert.equal(failed.history.length, 0);
    assert.equal(failed.paymentIssue.manual, true);
    assert.equal(failed.paymentIssue.action, 'refund');
    assert.equal(failed.paymentIssue.status, status);
    assert.equal(failed.events.some(entry => entry.label.includes('EUR60 returned')), false);
    const bytesBefore = await readFile(file, 'utf8');
    const restored = await restart();
    const requestCount = remote.calls.length;
    await assert.rejects(restored.action(id, 'refund'), /manual|inspect/i);
    assert.equal(remote.calls.length, requestCount);
    assert.equal(await readFile(file, 'utf8'), bytesBefore);
  });
}

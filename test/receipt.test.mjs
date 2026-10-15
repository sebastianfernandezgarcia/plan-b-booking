import test from 'node:test';
import assert from 'node:assert/strict';
import { financials, changeEffects } from '../lib/finance.mjs';
import { renderReceipt } from '../lib/receipt.mjs';

const booking = () => ({
  id: 'example-id', sessionName: 'Portrait session', state: 'booked', paymentMode: 'demo', revision: 1,
  totalCents: 18000, depositCents: 6000, selectedSlot: 'garden', slots: [{ id:'garden', day:'2026-10-24', time:'10:00', place:'Garden' }],
  brief: 'Sheltered morning portrait', proposal: {source:'rules-preview',reason:'Synthetic option'},
  capture: {id:'DEMO-CAPTURE',status:'COMPLETED'}, events:[{at:'2026-10-12T12:00:00Z',label:'Approved fictional session.',revision:0}]
});

test('pending capture and refund are excluded from completed funds and outstanding balance remains honest', () => {
  const b = booking(); b.state = 'payment_pending'; b.capture.status = 'PENDING';
  assert.equal(financials(b).heldCents,0); assert.equal(financials(b).depositDueCents,6000); assert.equal(financials(b).outstandingCents,18000);
  b.capture.status='COMPLETED'; b.state='refund_pending'; b.refund={id:'PENDING-REFUND',status:'PENDING'};
  assert.equal(financials(b).heldCents,6000); assert.equal(financials(b).refundedCents,0); assert.equal(financials(b).outstandingCents,12000);
  b.refund.status='COMPLETED'; b.state='refunded';
  assert.equal(financials(b).heldCents,0); assert.equal(financials(b).refundedCents,6000); assert.equal(financials(b).outstandingCents,0);
});

test('review projections express zero additional charge, retained deposit or full cancellation effect without changing booking', () => {
  const b = booking(), original = structuredClone(b);
  const move = changeEffects(b,'reschedule'), cancel = changeEffects(b,'refund');
  assert.deepEqual([move.heldBeforeCents,move.heldAfterCents,move.outstandingAfterCents,move.additionalChargeCents,move.refundCents],[6000,6000,12000,0,0]);
  assert.deepEqual([cancel.heldBeforeCents,cancel.heldAfterCents,cancel.outstandingAfterCents,cancel.additionalChargeCents,cancel.refundCents],[6000,0,0,0,6000]);
  assert.deepEqual(b,original);
});

test('printable record escapes customer content and includes source, mode, timestamp and financial limits', () => {
  const b = booking(); b.sessionName='<script>alert(1)</script>'; b.brief='A & B <img src=x onerror=alert(1)>'; b.events[0].label='"Quoted" <approval>';
  const html = renderReceipt(b,'2026-10-12T13:01:00.000Z');
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<img ')); assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('A &amp; B &lt;img')); assert.ok(html.includes('&quot;Quoted&quot; &lt;approval&gt;'));
  assert.match(html,/SIMULATED PAYMENTS/); assert.match(html,/Deterministic rules preview, not AI/); assert.match(html,/2026-10-12T13:01:00.000Z/);
  assert.match(html,/@media print/); assert.match(html,/not a financial receipt/); assert.match(html,/has not been collected/); assert.ok(!html.includes('src="https://'));
});

test('printable record omits ungrounded legacy model claims without changing the saved record', () => {
  const b = booking(); b.proposal = { source: 'ollama', model: 'old:local', reason: 'Guaranteed wheelchair access on 2025-10-22 and completed refund.' };
  const original = structuredClone(b), html = renderReceipt(b);
  assert.match(html, /Legacy model wording is omitted/); assert.match(html, /2026-10-24/);
  assert.doesNotMatch(html, /Guaranteed wheelchair|2025-10-22|completed refund\.<\/p>/);
  assert.deepEqual(b, original);
});

test('printable record distinguishes AI selection, fixture explanation, policy and deterministic checks', () => {
  const b = booking();
  b.proposal = { source: 'ollama', model: 'test:local', reason: 'Garden · 2026-10-24 · 10:00. Synthetic session.', explanationSource: 'verified-fixtures' };
  let html = renderReceipt(b); assert.match(html, /Local AI/); assert.match(html, /explanation comes from the supplied session data/);
  b.proposal.explanationSource = 'application-policy'; html = renderReceipt(b); assert.match(html, /does not confirm a completed action/);
  b.proposal = { source: 'constraint-check', reason: 'No synthetic session matches the required date.' };
  html = renderReceipt(b); assert.match(html, /Deterministic constraint check, not AI/); assert.doesNotMatch(html, /Local AI/);
});

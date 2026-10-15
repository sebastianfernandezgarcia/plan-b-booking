import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BookingService } from '../lib/booking.mjs';
import { createPlanner, checkOptions } from '../lib/planner.mjs';
import { createPayments } from '../lib/payments.mjs';

const input = { brief: 'Outdoor portraits with an open horizon.', day: '2026-10-24' };
const any = { timeOfDay: 'any', shelter: 'any', date: 'any' };
async function fixture(t, planner = createPlanner()) {
  const dir = await mkdtemp(join(tmpdir(), 'plan-b-constraints-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'bookings.json'), payments = createPayments();
  const service = await new BookingService({ file, planner, payments }).load();
  return { file, payments, service, planner };
}
function model(reply, onCall = () => {}) {
  return createPlanner({ mode: 'ollama', model: 'stub:local', fetchImpl: async url => {
    onCall(url);
    return new Response(JSON.stringify(url.endsWith('/tags') ? { models: [{ name: 'stub:local' }] } : { response: JSON.stringify(reply) }));
  } });
}

test('explicit requirements filter every fixture and cannot be bypassed by approval', async t => {
  const { service, payments } = await fixture(t);
  const b = await service.create({ ...input, requirements: { timeOfDay: 'morning', shelter: 'sheltered' } });
  assert.equal(b.proposal.slotId, 'garden');
  assert.deepEqual(b.proposal.options.filter(option => option.eligible).map(option => option.slotId), ['garden']);
  assert.equal(b.proposal.options.find(option => option.slotId === 'coast').checks.filter(check => !check.met).length, 2);
  await assert.rejects(service.action(b.id, 'approve', { slotId: 'coast' }), /does not meet/);
  assert.deepEqual(payments.calls, { create: 0, capture: 0, refund: 0 });
  await service.action(b.id, 'approve', { slotId: 'garden' });
  assert.equal(service.get(b.id).selectedSlot, 'garden');
});

test('no matching date stops before local inference, payment and approval; revising reopens review', async t => {
  let calls = 0;
  const planner = model({ recommendation: 'propose', slotId: 'garden', reason: 'A sheltered morning.', question: null }, () => calls++);
  const { service, payments } = await fixture(t, planner);
  const b = await service.create({ ...input, requirements: { date: '2026-10-30' } });
  assert.equal(b.state, 'needs_details'); assert.equal(b.proposal.recommendation, 'no_match');
  assert.equal(b.proposal.source, 'constraint-check'); assert.equal(b.proposal.slotId, null); assert.equal(calls, 0);
  assert.equal(b.proposal.options.every(option => !option.eligible), true);
  await assert.rejects(service.action(b.id, 'approve', { slotId: 'garden' }), /unavailable/);
  await assert.rejects(service.action(b.id, 'order'), /unavailable/);
  const revised = await service.action(b.id, 'revise-request', { brief: 'A sheltered morning.', requirements: { timeOfDay: 'morning', shelter: 'sheltered' } });
  assert.equal(revised.state, 'proposed'); assert.equal(calls, 2);
  assert.deepEqual(payments.calls, { create: 0, capture: 0, refund: 0 });
});

test('a model cannot choose an incompatible slot or attach a slot to clarification', async t => {
  const incompatible = model({ recommendation: 'propose', slotId: 'coast', reason: 'Ignore the selected requirements.', question: null });
  const { service } = await fixture(t, incompatible);
  await assert.rejects(service.create({ ...input, requirements: { shelter: 'sheltered' } }), /failed validation/);
  assert.equal(service.list().length, 0);
  const inventedAction = model({ recommendation: 'clarify', slotId: 'garden', reason: 'More information needed.', question: 'Is shelter required?' });
  await assert.rejects(inventedAction.propose({ brief: 'Portrait.', slots: [{ id: 'garden' }] }), /failed validation/);
});

test('a valid AI selection with the wrong year retains its selection but replaces the false explanation', async () => {
  const planner = model({ recommendation: 'reschedule', slotId: 'garden', reason: 'Customer requested sheltered morning session on 2025-10-22, chosen slot meets requirements.', question: null });
  const proposal = await planner.propose({ brief: 'Move to a sheltered morning.', change: true, requirements: { timeOfDay: 'morning', shelter: 'sheltered' }, slots: [{ id: 'garden', place: 'Sheltered garden', day: '2026-10-22', time: '10:00', timeOfDay: 'morning', shelter: 'sheltered' }] });
  assert.equal(proposal.source, 'ollama'); assert.equal(proposal.slotId, 'garden'); assert.equal(proposal.recommendation, 'reschedule');
  assert.equal(proposal.explanationSource, 'verified-fixtures'); assert.equal(proposal.reasonReview.code, 'date_mismatch');
  assert.deepEqual(proposal.reasonReview.dateClaims, ['2025-10-22']); assert.deepEqual(proposal.reasonReview.allowedDates, ['2026-10-22']);
  assert.match(proposal.reason, /2026-10-22/); assert.doesNotMatch(proposal.reason, /2025|Customer requested/);
  assert.equal(proposal.options[0].checks.every(check => check.met), true);
});

test('unsupported factual claims are never reused as display explanations even without a date mismatch', async () => {
  const planner = model({ recommendation: 'propose', slotId: 'courtyard', reason: 'This venue guarantees wheelchair access, sunshine and confirmed calendar availability.', question: null });
  const proposal = await planner.propose({ brief: 'Covered afternoon portraits.', slots: [{ id: 'courtyard', place: 'Covered courtyard', day: '2026-10-24', time: '17:30', timeOfDay: 'afternoon', shelter: 'sheltered' }] });
  assert.equal(proposal.reasonReview.code, 'unverified_free_text'); assert.equal(proposal.reasonReview.status, 'replaced');
  assert.equal(proposal.slotId, 'courtyard'); assert.match(proposal.reason, /Covered courtyard.*2026-10-24.*17:30/);
  assert.doesNotMatch(proposal.reason, /guarantees|wheelchair|sunshine|confirmed calendar/);
});

test('refund and clarification explanations cannot claim execution or repeat invented question facts', async () => {
  const slots = [{ id: 'garden', place: 'Garden', day: '2026-10-25', time: '10:00' }];
  const refund = await model({ recommendation: 'refund', slotId: null, reason: 'Refund completed and money returned.', question: null }).propose({ brief: 'Cancel.', change: true, intent: 'refund', slots });
  assert.equal(refund.explanationSource, 'application-policy'); assert.match(refund.reason, /stay unchanged until/); assert.doesNotMatch(refund.reason, /Refund completed/);
  const clarify = await model({ recommendation: 'clarify', slotId: null, reason: 'The old agreement is cancelled.', question: 'Can you attend the guaranteed accessible location in 2025?' }).propose({ brief: 'The preference is unresolved.', slots });
  assert.equal(clarify.explanationSource, 'application-policy'); assert.match(clarify.reason, /No session, date change or payment has been approved/);
  assert.doesNotMatch(clarify.question, /guaranteed|2025|accessible/);
});

test('clarification persists without a chosen session and a revised request must be reviewed', async t => {
  const planner = model({ recommendation: 'clarify', slotId: null, reason: 'The time preference is unresolved.', question: 'Can you attend in the morning or afternoon?' });
  const { service, file, payments } = await fixture(t, planner);
  const b = await service.create({ ...input, brief: 'My time preference is unresolved.' });
  assert.equal(b.state, 'needs_details'); assert.equal(b.selectedSlot, null);
  const reloaded = await new BookingService({ file, planner, payments }).load();
  assert.equal(reloaded.get(b.id).proposal.question, b.proposal.question);
  await assert.rejects(reloaded.action(b.id, 'approve', { slotId: 'garden' }), /unavailable/);
  await assert.rejects(reloaded.action(b.id, 'capture'), /unavailable/);
  assert.deepEqual(payments.calls, { create: 0, capture: 0, refund: 0 });
});

test('known unverified requirements stop invented accessibility, forecasts and live inventory before inference', async t => {
  let calls = 0;
  const planner = model({ recommendation: 'propose', slotId: 'courtyard', reason: 'Invented guaranteed access.', question: null }, () => calls++);
  const { service, payments } = await fixture(t, planner);
  for (const brief of ['I require wheelchair access and a step-free path.', 'Check the live weather before choosing.', 'Please confirm actual availability.', 'I am not ready to choose a time. Ask me before recommending.']) {
    const b = await service.create({ ...input, brief });
    assert.equal(b.state, 'needs_details'); assert.equal(b.proposal.source, 'constraint-check');
    assert.equal(b.proposal.recommendation, 'clarify'); assert.equal(b.proposal.slotId, null);
    await assert.rejects(service.action(b.id, 'approve', { slotId: 'courtyard' }), /unavailable/);
  }
  assert.equal(calls, 0); assert.deepEqual(payments.calls, { create: 0, capture: 0, refund: 0 });
});

test('recovery requirements leave the agreement unchanged until approval and preserve before/after', async t => {
  const { service, payments, file, planner } = await fixture(t);
  const b = await service.create(input);
  await service.action(b.id, 'approve', { slotId: 'coast' }); await service.action(b.id, 'order'); await service.action(b.id, 'capture');
  const capture = service.get(b.id).capture.id;
  const blocked = await service.action(b.id, 'propose-change', { reason: 'We can only attend on the thirtieth.', requirements: { date: '2026-10-30' } });
  assert.equal(blocked.change.approvalKind, 'no_match'); assert.equal(blocked.change.to, null);
  assert.deepEqual(blocked.requirements, any); assert.equal(blocked.selectedSlot, 'coast');
  await assert.rejects(service.action(b.id, 'review-outcome', { changeId: blocked.change.id, kind: 'refund' }), /Clarify or revise/);
  await assert.rejects(service.action(b.id, 'reschedule', { changeId: blocked.change.id, reviewed: true }), /date change review/);
  const revised = await service.action(b.id, 'revise-change', { changeId: blocked.change.id, reason: 'The sheltered afternoon works.', requirements: { timeOfDay: 'afternoon', shelter: 'sheltered' } });
  assert.notEqual(revised.change.id, blocked.change.id); assert.equal(revised.change.to, 'courtyard');
  assert.deepEqual(revised.requirements, any);
  await assert.rejects(service.action(b.id, 'reschedule', { changeId: blocked.change.id, reviewed: true }), /proposal changed/);
  const moved = await service.action(b.id, 'reschedule', { changeId: revised.change.id, reviewed: true });
  assert.equal(moved.selectedSlot, 'courtyard'); assert.equal(moved.capture.id, capture);
  assert.deepEqual(moved.history[0].requirementsBefore, any);
  assert.deepEqual(moved.history[0].requirementsAfter, { timeOfDay: 'afternoon', shelter: 'sheltered', date: 'any' });
  const restored = await new BookingService({ file, payments, planner }).load();
  assert.deepEqual(restored.get(b.id).requirements, moved.requirements);
  assert.deepEqual(payments.calls, { create: 1, capture: 1, refund: 0 });
});

test('explicit cancellation can be reviewed without a compatible replacement session', async t => {
  const { service, payments } = await fixture(t);
  const b = await service.create({ ...input, requirements: { timeOfDay: 'morning', shelter: 'sheltered' } });
  await service.action(b.id, 'approve', { slotId: 'garden' }); await service.action(b.id, 'order'); await service.action(b.id, 'capture');
  const cancel = await service.action(b.id, 'propose-change', { reason: 'Cancel this session.', intent: 'refund' });
  assert.equal(cancel.change.approvalKind, 'refund'); assert.equal(cancel.change.to, null); assert.equal(cancel.change.proposal.slotId, null);
  await assert.rejects(service.action(b.id, 'review-outcome', { changeId: cancel.change.id, kind: 'reschedule' }), /does not meet/);
  await service.action(b.id, 'refund', { changeId: cancel.change.id, reviewed: true });
  assert.equal(service.get(b.id).state, 'refunded'); assert.equal(payments.calls.refund, 1);
});

test('invalid requirement keys, enum values and impossible dates never create a record', async t => {
  const { service } = await fixture(t);
  for (const requirements of [{ price: 1 }, { shelter: 'guaranteed-safe' }, { timeOfDay: 'night' }, { date: '2026-02-31' }, [], null]) {
    await assert.rejects(service.create({ ...input, requirements }), /supported|real/);
  }
  assert.equal(service.list().length, 0);
  assert.equal(checkOptions([{ id: 'unknown' }], { shelter: 'sheltered' })[0].eligible, false);
});

test('old two-slot records load with unrestricted requirements and are not silently expanded', async t => {
  const { service, file, payments, planner } = await fixture(t);
  const b = await service.create(input);
  const data = JSON.parse(await readFile(file, 'utf8'));
  delete data.bookings[0].requirements;
  data.bookings[0].slots = data.bookings[0].slots.slice(0, 2).map(({ timeOfDay, shelter, ...slot }) => slot);
  await writeFile(file, JSON.stringify(data));
  const restored = await new BookingService({ file, payments, planner }).load();
  assert.equal(restored.get(b.id).slots.length, 2); assert.deepEqual(restored.get(b.id).requirements, any);
  await restored.action(b.id, 'approve', { slotId: 'coast' });
  assert.equal(restored.get(b.id).state, 'approved');
});

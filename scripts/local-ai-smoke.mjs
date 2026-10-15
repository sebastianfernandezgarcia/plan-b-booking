import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPlanner } from '../lib/planner.mjs';
import { createPayments } from '../lib/payments.mjs';
import { BookingService } from '../lib/booking.mjs';

// Explicitly invoked only; regular npm test remains provider-independent.
const model = process.env.OLLAMA_MODEL || 'qwen3-vl:8b';
const planner = createPlanner({ mode: 'ollama', model });
const payments = createPayments({ mode: 'demo' });
const dir = await mkdtemp(join(tmpdir(), 'plan-b-real-ai-'));
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const observations = [];
const artifact = join(root, 'artifacts', 'local-ai-requirements-smoke-2026-10-14.json');
let passed = false, failure = null, finalState = null;
function observed(stage, started, proposal) {
  observations.push({ stage, elapsedMs: Date.now() - started, proposal });
  console.log(`${stage}: ${proposal.recommendation} / ${proposal.slotId || 'no session selected'} / ${proposal.source}`);
}
try {
  const service = await new BookingService({ file: join(dir, 'smoke.json'), planner, payments }).load();
  let start = Date.now();
  const b = await service.create({ brief: 'I prefer an open horizon by the coast in the afternoon, rather than a covered courtyard.', day: '2026-10-24', requirements: { timeOfDay: 'afternoon' } });
  observed('rank two compatible synthetic sessions', start, b.proposal);
  assert.equal(b.proposal.source, 'ollama'); assert.equal(b.proposal.slotId, 'coast');
  assert.equal(b.proposal.options.filter(option => option.eligible).length, 2);
  await service.action(b.id, 'approve', { slotId: 'coast' }); await service.action(b.id, 'order'); await service.action(b.id, 'capture');
  const captureId = service.get(b.id).capture.id;
  start = Date.now();
  const noMatch = await service.action(b.id, 'propose-change', { reason: 'I can attend only on October thirtieth.', requirements: { date: '2026-10-30' } });
  observed('no compatible date, deterministic guard', start, noMatch.change.proposal);
  assert.equal(noMatch.change.proposal.recommendation, 'no_match'); assert.equal(noMatch.change.proposal.source, 'constraint-check');
  assert.equal(noMatch.capture.id, captureId); assert.equal(noMatch.selectedSlot, 'coast');
  start = Date.now();
  const change = await service.action(b.id, 'revise-change', { changeId: noMatch.change.id, reason: 'I can attend October twenty-fifth after all. Please move to a sheltered morning session instead of the coast.', requirements: { timeOfDay: 'morning', shelter: 'sheltered' } });
  observed('revised request, compatible recovery', start, change.change.proposal);
  assert.equal(change.change.proposal.recommendation, 'reschedule'); assert.equal(change.change.to, 'garden');
  assert.equal(change.requirements.timeOfDay, 'afternoon');
  await service.action(b.id, 'reschedule', { changeId: change.change.id, reviewed: true }); await service.action(b.id, 'capture');
  assert.equal(service.get(b.id).capture.id, captureId); assert.equal(payments.calls.capture, 1);
  start = Date.now();
  const clarify = await service.action(b.id, 'propose-change', { reason: 'Please find a replacement venue with guaranteed wheelchair access and a step-free path. I do not know which of these places has that access.', requirements: {} });
  observed('adversarial unknown accessibility, deterministic guard', start, clarify.change.proposal);
  assert.equal(clarify.change.proposal.recommendation, 'clarify'); assert.equal(clarify.change.to, null);
  assert.equal(clarify.change.proposal.source, 'constraint-check');
  assert.equal(clarify.selectedSlot, 'garden'); assert.equal(clarify.capture.id, captureId);
  await assert.rejects(service.action(b.id, 'reschedule', { changeId: clarify.change.id, reviewed: true }), /date change review/);
  await service.action(b.id, 'keep', { changeId: clarify.change.id });
  start = Date.now();
  const undecided = await service.action(b.id, 'propose-change', { reason: 'I am not ready to choose a time. Please ask whether I can attend in the morning or afternoon before suggesting a replacement session.', requirements: {} });
  observed('explicit request to clarify, deterministic guard', start, undecided.change.proposal);
  assert.equal(undecided.change.proposal.source, 'constraint-check'); assert.equal(undecided.change.proposal.recommendation, 'clarify');
  assert.equal(undecided.change.to, null); assert.equal(undecided.capture.id, captureId);
  await service.action(b.id, 'keep', { changeId: undecided.change.id });
  start = Date.now();
  const cancel = await service.action(b.id, 'propose-change', { reason: 'Please cancel and refund. Neither date works anymore.', intent: 'refund' });
  observed('explicit cancellation without forced replacement', start, cancel.change.proposal);
  assert.equal(cancel.change.proposal.recommendation, 'refund');
  assert.equal(cancel.change.proposal.slotId, null);
  await service.action(b.id, 'refund', { changeId: cancel.change.id, reviewed: true });
  assert.equal(service.get(b.id).state, 'refunded');
  assert.deepEqual(payments.calls, { create: 1, capture: 1, refund: 1 });
  finalState = service.get(b.id).state; passed = true;
} catch (error) {
  failure = error.message; throw error;
} finally {
  const evidence = { at: new Date().toISOString(), node: process.version, passed, failure, ai: 'REAL LOCAL INFERENCE for ranking, rescheduling and explicit cancellation. No-match, known unverified requirements and explicit clarification requests use deterministic guards without inference. The conservative keyword guard does not understand every unsupported request.', observedModelLimitations: ['The first attempt exhausted 512 output tokens when asked about unknown accessibility.', 'A diagnostic model response invented guaranteed wheelchair access at the courtyard.', 'The second attempt selected a slot despite an explicit request to ask a question first. Known patterns are now guarded before inference; this is not a claim of general semantic reliability.'], model, payments: 'OFFLINE DEMO SIMULATION. NOT PAYPAL SANDBOX.', observations, paymentAdapterCalls: payments.calls, finalState };
  await mkdir(join(root, 'artifacts'), { recursive: true });
  await writeFile(artifact, JSON.stringify(evidence, null, 2));
  console.log(`Evidence saved: ${artifact}; passed=${passed}`);
  await rm(dir, { recursive: true, force: true });
}

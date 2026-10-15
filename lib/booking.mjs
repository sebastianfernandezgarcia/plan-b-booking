import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { AppError } from './payments.mjs';
import { normaliseRequirements, checkOptions } from './planner.mjs';

const needsDetails = proposal => ['clarify', 'no_match'].includes(proposal.recommendation);
function syntheticSlots(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T12:00:00Z`)) || new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) !== day) throw new AppError('Use a real date in YYYY-MM-DD format.', 400);
  const nextDay = new Date(Date.parse(`${day}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  return [
    { id: 'coast', day, time: '17:30', timeOfDay: 'afternoon', shelter: 'exposed', place: 'Coast path', note: 'Open horizon · 60 min · exposed to wind' },
    { id: 'garden', day: nextDay, time: '10:00', timeOfDay: 'morning', shelter: 'sheltered', place: 'Sheltered garden', note: 'Soft morning light · 60 min · sheltered spot' },
    { id: 'courtyard', day, time: '17:30', timeOfDay: 'afternoon', shelter: 'sheltered', place: 'Covered courtyard', note: 'Covered setting · 60 min · sheltered spot' },
    { id: 'meadow', day: nextDay, time: '10:00', timeOfDay: 'morning', shelter: 'exposed', place: 'Open meadow', note: 'Open morning setting · 60 min · exposed to wind' }
  ];
}
function requireCompatible(b, slotId, requirements = b.requirements) {
  if (!checkOptions(b.slots, requirements).some(option => option.slotId === slotId && option.eligible)) throw new AppError('This session does not meet the explicit requirements. Revise and review the request first.');
}
function terminalPaymentIssue(b, action, status) {
  const terminal = action === 'capture' ? ['DECLINED', 'DENIED', 'FAILED'] : ['FAILED', 'CANCELLED'];
  if (!terminal.includes(status)) return;
  b.paymentIssue = { action, status, manual: true, message: `PayPal reported ${status} for this ${action}. Inspect this existing transaction in the sandbox. Automatic retries and other changes are paused; do not create a replacement charge or reset the booking.` };
  event(b, `${action} requires manual sandbox reconciliation after ${status}. No completed funds recorded for this operation.`);
}

function requireState(booking, states) {
  if (!states.includes(booking.state)) throw new AppError(`Action unavailable while booking is ${booking.state}.`);
}
function text(value, label, max = 1200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new AppError(`${label} is required and must be under ${max} characters.`, 400);
  return value.trim();
}
function event(booking, label) {
  const at = new Date().toISOString();
  booking.updatedAt = at;
  booking.events.push({ at, label, revision: booking.revision });
}
function requireReview(b, input, kind) {
  if (input.changeId !== b.change.id) throw new AppError('This proposal changed. Review the current proposal first.');
  if (b.change.approvalKind !== kind) throw new AppError(`Open the ${kind === 'refund' ? 'cancellation' : 'date change'} review before approving this outcome.`);
  if (input.reviewed !== true) throw new AppError('Review and acknowledge the effect on the session and deposit before approving.');
}
function changeRecord(b, kind) {
  return {
    id: b.change.id, kind, at: new Date().toISOString(), revision: b.revision + 1,
    reason: b.change.reason, before: structuredClone(b.slots.find(s => s.id === b.change.from)),
    after: kind === 'refund' ? null : structuredClone(b.slots.find(s => s.id === b.change.to)),
    depositBeforeCents: b.depositCents, depositAfterCents: kind === 'refund' ? 0 : b.depositCents,
    balanceBeforeCents: b.totalCents - b.depositCents, balanceAfterCents: kind === 'refund' ? 0 : b.totalCents - b.depositCents,
    additionalChargeCents: 0, refundCents: kind === 'refund' ? b.depositCents : 0,
    requirementsBefore: structuredClone(b.requirements), requirementsAfter: kind === 'refund' ? null : structuredClone(b.change.requirements),
    proposalSource: b.change.proposal.source, model: b.change.proposal.model || null
  };
}
function verifyAmount(result) {
  if (!result?.id || result.amount?.currency_code !== 'EUR' || result.amount?.value !== '60.00') throw new AppError('Payment amount or identity did not match. Booking remains unconfirmed; inspect the sandbox.', 502);
}

export class BookingService {
  constructor({ file, payments, planner }) { this.file = file; this.payments = payments; this.planner = planner; this.data = { version: 1, bookings: [] }; this.queue = Promise.resolve(); }
  async load() {
    try { this.data = JSON.parse(await readFile(this.file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!Array.isArray(this.data.bookings) || this.data.version !== 1) throw new Error('Invalid data file. Refusing to replace existing bookings.');
    if (this.data.bookings.some(b => b.paymentMode !== this.payments.mode)) throw new Error('Data contains another payment mode. Use separate data files.');
    for (const b of this.data.bookings) {
      b.sessionName ||= 'Outdoor portrait session';
      b.createdAt ||= b.events[0]?.at || null;
      b.updatedAt ||= b.events.at(-1)?.at || b.createdAt;
      b.history ||= [];
      b.requirements = normaliseRequirements(b.requirements);
      if (b.change) { b.change.approvalKind ||= b.change.proposal.recommendation; b.change.createdAt ||= b.updatedAt; b.change.requirements = normaliseRequirements(b.change.requirements || b.requirements); }
    }
    return this;
  }
  async save() {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(`${this.file}.tmp`, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    await rename(`${this.file}.tmp`, this.file);
  }
  serial(fn) {
    const next = this.queue.then(fn); this.queue = next.catch(() => {}); return next;
  }
  list() { return structuredClone(this.data.bookings); }
  get(id) { const b = this.data.bookings.find(item => item.id === id); if (!b) throw new AppError('Booking not found.', 404); return b; }
  async create(input) {
    return this.serial(async () => {
      const brief = text(input.brief, 'Brief');
      const sessionName = input.sessionName === undefined ? 'Outdoor portrait session' : text(input.sessionName, 'Session name', 80);
      const slots = syntheticSlots(text(input.day, 'Date', 10)), requirements = normaliseRequirements(input.requirements);
      const proposal = await this.planner.propose({ brief, slots, requirements });
      const booking = { id: randomUUID(), sessionName, createdAt: new Date().toISOString(), state: needsDetails(proposal) ? 'needs_details' : 'proposed', paymentMode: this.payments.mode, brief, slots, requirements, proposal, selectedSlot: null, depositCents: 6000, totalCents: 18000, currency: 'EUR', revision: 0, events: [], history: [], requests: {} };
      event(booking, `${needsDetails(proposal) ? 'Request needs clarification' : 'Synthetic session options proposed'} (${proposal.source}). No payment created.`);
      this.data.bookings.unshift(booking); await this.save(); return structuredClone(booking);
    });
  }
  async action(id, action, input = {}) {
    return this.serial(async () => {
      const b = this.get(id);
      // Once a remote outcome is uncertain, only retry that same action.
      if (b.inFlight && b.inFlight !== action) throw new AppError(`Reconcile ${b.inFlight} first. Other actions are locked to preserve the payment.`);
      if (action === 'revise-request') {
        requireState(b, ['proposed', 'needs_details']);
        const brief = text(input.brief, 'Brief'), requirements = normaliseRequirements(input.requirements === undefined ? b.requirements : input.requirements);
        const slots = input.day === undefined ? b.slots : syntheticSlots(input.day);
        const proposal = await this.planner.propose({ brief, slots, requirements });
        b.brief = brief; b.requirements = requirements; b.slots = slots; b.proposal = proposal;
        b.state = needsDetails(proposal) ? 'needs_details' : 'proposed';
        event(b, `Request revised (${proposal.source}). No session or payment approved.`);
      } else if (action === 'approve') {
        requireState(b, ['proposed']);
        if (!b.slots.some(s => s.id === input.slotId)) throw new AppError('Choose one of the proposed sessions.', 400);
        if (needsDetails(b.proposal)) throw new AppError('Clarify the request before approving a session.');
        requireCompatible(b, input.slotId);
        b.selectedSlot = input.slotId; b.state = 'approved'; event(b, 'Customer approved the session and example deposit policy.');
      } else if (action === 'order') {
        if (b.order) return structuredClone(b);
        requireState(b, ['approved']);
        const key = await this.begin(b, action);
        b.order = await this.payments.create(b, key); b.inFlight = null; b.state = 'payment_pending';
        event(b, `Deposit order created (${b.paymentMode}). Awaiting buyer approval and capture.`);
      } else if (action === 'capture') {
        if (b.capture?.status === 'COMPLETED') return structuredClone(b);
        requireState(b, ['payment_pending']);
        const key = await this.begin(b, action);
        const capture = await this.payments.capture(b, key); verifyAmount(capture);
        b.capture = { id: capture.id, status: capture.status, amount: capture.amount };
        if (capture.status === 'COMPLETED') { b.state = 'booked'; b.inFlight = null; event(b, `EUR60 deposit confirmed (${b.paymentMode}). Exactly one completed deposit recorded.`); }
        else { event(b, `Capture status is ${capture.status}. Booking is not confirmed; reconcile this payment.`); terminalPaymentIssue(b, 'capture', capture.status); }
      } else if (action === 'propose-change' || action === 'revise-change') {
        requireState(b, action === 'revise-change' ? ['change_proposed'] : ['booked']);
        if (action === 'revise-change' && input.changeId !== b.change.id) throw new AppError('This proposal changed. Review the current proposal first.');
        const reason = text(input.reason, 'Change reason');
        const intent = input.intent || 'suggest';
        if (!['suggest', 'reschedule', 'refund'].includes(intent)) throw new AppError('Choose a supported recovery intent.', 400);
        const requirements = normaliseRequirements(input.requirements === undefined ? (action === 'revise-change' ? b.change.requirements : b.requirements) : input.requirements);
        const alternatives = b.slots.filter(s => s.id !== b.selectedSlot);
        const proposal = await this.planner.propose({ brief: b.brief, latestRequest: reason, slots: alternatives, change: true, requirements, intent });
        const alternative = checkOptions(alternatives, requirements).find(option => option.eligible)?.slotId || null;
        b.change = { id: randomUUID(), createdAt: new Date().toISOString(), reason, intent, requirements, approvalKind: needsDetails(proposal) || intent === 'suggest' ? proposal.recommendation : intent, proposal, from: b.selectedSlot, to: needsDetails(proposal) ? null : proposal.slotId || alternative };
        b.state = 'change_proposed'; event(b, `Recovery proposed (${proposal.source}). Deposit unchanged; waiting for customer approval.`);
      } else if (action === 'review-outcome') {
        requireState(b, ['change_proposed']);
        if (input.changeId !== b.change.id) throw new AppError('This proposal changed. Review the current proposal first.');
        if (needsDetails(b.change.proposal)) throw new AppError('Clarify or revise this request before choosing a recovery outcome.');
        if (!['reschedule', 'refund'].includes(input.kind)) throw new AppError('Choose a date change or cancellation review.', 400);
        if (input.kind === 'reschedule') requireCompatible(b, b.change.to, b.change.requirements);
        if (b.change.approvalKind !== input.kind) {
          b.change.approvalKind = input.kind;
          b.change.id = randomUUID();
          b.change.createdAt = new Date().toISOString();
          event(b, `Customer opened ${input.kind === 'refund' ? 'cancellation and refund' : 'date change'} review. No payment or session change executed.`);
        }
      } else if (action === 'keep') {
        requireState(b, ['change_proposed']);
        if (input.changeId !== b.change.id) throw new AppError('This proposal changed. Review the current proposal first.');
        b.change = null; b.state = 'booked'; event(b, 'Customer declined the change; original session retained.');
      } else if (action === 'reschedule') {
        requireState(b, ['change_proposed']);
        requireReview(b, input, 'reschedule');
        requireCompatible(b, b.change.to, b.change.requirements);
        b.history.push(changeRecord(b, 'reschedule'));
        b.selectedSlot = b.change.to; b.requirements = b.change.requirements; b.change = null; b.state = 'booked'; b.revision++;
        event(b, 'Customer approved the new session. Existing EUR60 deposit retained. Additional charge: EUR0.');
      } else if (action === 'refund') {
        if (b.state === 'refunded') return structuredClone(b);
        requireState(b, ['change_proposed', 'refund_pending']);
        if (!b.requests.refund) {
          requireReview(b, input, 'refund');
          event(b, 'Customer approved cancellation and a full EUR60 refund under the example policy.');
        }
        const key = await this.begin(b, action); b.state = 'refund_pending'; await this.save();
        const refund = await this.payments.refund(b, key); verifyAmount(refund);
        b.refund = { id: refund.id, status: refund.status, amount: refund.amount };
        if (refund.status === 'COMPLETED') { b.history.push(changeRecord(b, 'refund')); b.revision++; b.state = 'refunded'; b.inFlight = null; event(b, `Approved cancellation: EUR60 returned (${b.paymentMode}). No additional payment.`); }
        else { event(b, `Refund is ${refund.status}. Not yet marked as returned; reconcile this refund.`); terminalPaymentIssue(b, 'refund', refund.status); }
      } else throw new AppError('Unknown booking action.', 404);
      await this.save(); return structuredClone(b);
    });
  }
  async begin(b, action) {
    if (b.paymentIssue?.manual) throw new AppError(b.paymentIssue.message);
    if (this.payments.mode === 'sandbox' && !this.payments.ready) throw new AppError('Sandbox credentials are missing. No payment was attempted.', 503);
    const request = b.requests[action];
    // Conservative automatic retry window is shorter than Orders API's documented 6h retention.
    // After expiry, preserve the evidence and require manual sandbox reconciliation.
    if (request && Date.now() - request.at > 5 * 3600000) throw new AppError('Automatic retry window expired. Inspect this existing transaction in the sandbox before changing local data.');
    b.requests[action] ||= { id: randomUUID(), at: Date.now() };
    b.inFlight = action; await this.save(); return b.requests[action].id;
  }
}

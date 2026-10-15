import { financials, changeEffects, euro } from '/finance.js';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const stateLabels = { needs_details: 'Brief needs attention', proposed: 'Choose a session', approved: 'Deposit not started', payment_pending: 'Deposit pending', booked: 'Confirmed session', change_proposed: 'Change needs review', refund_pending: 'Refund pending', refunded: 'Cancelled & refunded' };
let config, bookings = [], busy = false, filter = 'all', view = 'workspace', editingId = null;
let activeId = new URLSearchParams(location.search).get('booking') || localStorage.getItem('plan-b-active');
const drafts = new Map();
const today = new Date(); today.setDate(today.getDate() + 7); $('day').value = today.toISOString().slice(0, 10);
const stamp = value => value ? new Date(value).toLocaleString('en-GB', { timeZone: 'Atlantic/Canary', dateStyle: 'medium', timeStyle: 'short' }) : 'Not recorded';
const dateParts = day => {
  const date = new Date(`${day}T12:00:00Z`);
  return { number: date.getUTCDate(), month: date.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }), weekday: date.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }), long: date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) };
};
const chosenSlot = b => b.slots.find(s => s.id === b.selectedSlot);
const slotText = s => s ? `${s.place} · ${dateParts(s.day).long} · ${s.time}` : 'No session approved';
const source = p => p.source === 'constraint-check' ? 'REQUIREMENTS CHECK' : p.source === 'ollama' ? `LOCAL AI / ${esc(p.model)}` : 'RULES PREVIEW / NOT AI';
const paymentWord = b => b.paymentMode === 'demo' ? 'simulated' : 'sandbox';
const isPaid = b => b.capture?.status === 'COMPLETED';

async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Plan-B': 'local' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The request failed. Existing booking retained.');
  return data;
}
function showStatus(message, pending = false) {
  $('status').textContent = message; $('status').hidden = !message; $('status').classList.toggle('busy', pending);
}
function setBusy(value) {
  busy = value; $('workspace').setAttribute('aria-busy', String(value));
  document.querySelectorAll('button,input,textarea,select').forEach(element => element.disabled = value);
}
async function run(fn, { message = 'Saving the current decision…', success = '', focus = false } = {}) {
  if (busy) return;
  $('error').hidden = true; $('dialog-error').hidden = true; setBusy(true); showStatus(message, true);
  const oldCreateText = $('create').textContent;
  if ($('new-dialog').open) $('create').textContent = 'Preparing options on this device…';
  try { await fn(); showStatus(success); }
  catch (error) {
    showStatus(''); const target = $('new-dialog').open ? $('dialog-error') : $('error'); target.textContent = error.message; target.hidden = false;
  } finally {
    try { bookings = await api('/api/bookings'); } catch { $('error').textContent = 'Connection to the local workspace was lost. Existing data has not been reset. Start the server and refresh.'; $('error').hidden = false; }
    setBusy(false); $('create').textContent = oldCreateText; render();
    if (focus && !$('new-dialog').open) $('workspace').focus({ preventScroll: true });
  }
}
function selectBooking(id) {
  activeId = id; localStorage.setItem('plan-b-active', id); view = 'workspace';
  history.replaceState(null, '', `/?booking=${encodeURIComponent(id)}`); render();
}
function statusPill(b) { return `<span class="status-pill ${b.state === 'booked' ? 'green' : b.state === 'change_proposed' ? 'blue' : ''}">${stateLabels[b.state]}</span>`; }
function renderRail() {
  $('booking-count').textContent = bookings.length;
  const query = $('search').value.toLowerCase();
  const shown = bookings.filter(b => (filter === 'all' || (filter === 'closed') === (b.state === 'refunded')) && `${b.sessionName} ${b.brief}`.toLowerCase().includes(query));
  $('booking-list').innerHTML = shown.length ? shown.map(b => `<button class="booking-item ${b.id === activeId ? 'active' : ''}" data-select="${b.id}" ${b.id === activeId ? 'aria-current="true"' : ''}><strong>${esc(b.sessionName || 'Outdoor portrait session')}</strong><span class="rail-meta"><span>${chosenSlot(b)?.day || b.slots[0].day}</span><span>REV ${b.revision}</span></span><span class="rail-state ${b.state === 'booked' ? 'confirmed' : ''}">${stateLabels[b.state]}</span></button>`).join('') : `<p class="rail-empty">${bookings.length ? 'No sessions match this filter.' : 'Your first agreement starts with a session request.'}</p>`;
}
function ledger(b) {
  const f = financials(b);
  return `<aside class="ledger" aria-label="Current agreement balance"><div class="ledger-head"><span class="eyebrow">DEPOSIT CURRENTLY HELD</span><strong class="ledger-amount">${euro(f.heldCents)}</strong><span class="small">${b.state === 'refund_pending' ? 'Refund pending. Funds are not yet marked returned.' : f.cancelled ? 'Deposit returned. Agreement closed.' : isPaid(b) ? 'Stays with the booking when the date moves.' : 'No completed deposit recorded yet.'}</span></div><div class="ledger-body"><div class="ledger-row"><span>Example session price</span><strong>${euro(f.priceCents)}</strong></div><div class="ledger-row"><span>Deposit confirmed</span><strong>${euro(f.capturedCents)}</strong></div><div class="ledger-row"><span>Deposit returned</span><strong>${euro(f.refundedCents)}</strong></div><div class="ledger-row"><span>Additional charges</span><strong>${euro(f.additionalChargeCents)}</strong></div><div class="ledger-row total"><span>Outstanding balance</span><strong>${euro(f.outstandingCents)}</strong></div><div class="ledger-note">${f.cancelled ? 'The cancellation closes the session and waives its remaining balance.' : f.depositDueCents ? `${euro(f.depositDueCents)} deposit still to confirm. ${euro(f.balanceAfterDepositCents)} would remain after it is confirmed.` : `${euro(f.balanceAfterDepositCents)} remains for the session. This prototype has not collected it.`}</div><details class="policy-details"><summary>View the example policy</summary><p>Session €180. Deposit €60. An approved date change keeps the same deposit. An approved cancellation returns €60 and waives the €120 session balance. No partial refunds or extra charges.</p></details></div><div class="ledger-mode">${b.paymentMode === 'demo' ? 'SIMULATED PAYMENTS / NO PAYPAL CALLS' : 'PAYPAL SANDBOX / NO REAL MONEY'}</div></aside>`;
}
function agreementCard(b) {
  const s = chosenSlot(b); if (!s) return '';
  const d = dateParts(s.day);
  return `<div class="agreement-card"><div class="date-block"><strong>${d.number}</strong><span>${d.month.toUpperCase()} ${s.day.slice(0,4)}</span></div><div><h3>${esc(s.place)}</h3><div class="session-time">${d.weekday} · ${s.time}–${s.time === '17:30' ? '18:30' : '11:00'} · Atlantic/Canary</div><p class="small muted">${esc(s.note)}</p></div></div>`;
}
const requirementDefaults = { timeOfDay: 'any', shelter: 'any', date: 'any' };
const requirementsOf = value => ({ ...requirementDefaults, ...value });
const requiresDetails = proposal => ['clarify', 'no_match'].includes(proposal?.recommendation);
function requirementChips(value) {
  const r = requirementsOf(value);
  return `<div class="constraint-chips"><span class="constraint-chip">${r.timeOfDay === 'any' ? 'Either time' : r.timeOfDay === 'morning' ? 'Morning only' : 'Afternoon only'}</span><span class="constraint-chip">${r.shelter === 'sheltered' ? 'Shelter required' : 'Either location type'}</span><span class="constraint-chip">${r.date === 'any' ? 'Either date' : esc(dateParts(r.date).long) + ' only'}</span></div>`;
}
function requirementFields(prefix, value) {
  const r = requirementsOf(value);
  return `<fieldset class="constraint-fields"><legend>Requirements the next session must meet</legend><div class="field-grid"><div><label for="${prefix}-time">Time of day</label><select id="${prefix}-time">${[['any','Either time works'],['morning','Morning only'],['afternoon','Afternoon only']].map(([key,label]) => `<option value="${key}" ${r.timeOfDay === key ? 'selected' : ''}>${label}</option>`).join('')}</select></div><div><label for="${prefix}-shelter">Shelter</label><select id="${prefix}-shelter"><option value="any" ${r.shelter === 'any' ? 'selected' : ''}>Exposed or sheltered</option><option value="sheltered" ${r.shelter === 'sheltered' ? 'selected' : ''}>Sheltered location only</option></select></div><div><label for="${prefix}-date">Only this date (optional)</label><input id="${prefix}-date" type="date" value="${r.date === 'any' ? '' : esc(r.date)}"></div></div><p class="input-hint">Firm requirements are checked against the available examples. Clear the date to allow either day.</p></fieldset>`;
}
function readRequirements(prefix) {
  return { timeOfDay: $(`${prefix}-time`).value, shelter: $(`${prefix}-shelter`).value, date: $(`${prefix}-date`).value || 'any' };
}
function plannerNote(p) {
  const verified = ['verified-fixtures', 'application-policy'].includes(p.explanationSource);
  const note = p.source === 'ollama' && !verified
    ? 'This earlier AI suggestion has no verified explanation. Review the checked session details above.'
    : p.reason;
  const explanationLabel = p.explanationSource === 'verified-fixtures' ? ' · EXPLANATION FROM SESSION DATA' : p.explanationSource === 'application-policy' ? ' · EXAMPLE POLICY' : '';
  return `<div class="planner-note"><div class="source">${source(p)}${explanationLabel}</div><p>${esc(note)}</p></div>`;
}
function depositProof(b) {
  if (!isPaid(b)) return '';
  return `<section class="deposit-proof" aria-label="Deposit evidence"><div class="deposit-proof-top"><span class="proof-mark" aria-hidden="true">✓</span><div><strong>One confirmed deposit · ${euro(b.depositCents)}</strong><p>${b.state === 'refunded' ? 'Returned under the approved cancellation.' : 'The same deposit stays attached when this booking moves.'} Additional charges recorded: €0.00.</p></div></div><details><summary>Inspect the payment reference</summary><p class="provider-ref">${b.paymentMode === 'demo' ? 'SIMULATED' : 'SANDBOX'} CAPTURE<br>${esc(b.capture.id)}<br>STATUS / ${esc(b.capture.status)}</p><p class="small muted">This reference comes from the saved booking record. ${b.paymentMode === 'demo' ? 'It is a simulation, not a PayPal transaction.' : 'It identifies the sandbox deposit, not a live payment.'}</p></details></section>`;
}
function reconciliationIssue(b) {
  if (b.paymentIssue?.manual) return b.paymentIssue;
  const request = b.inFlight && b.requests?.[b.inFlight];
  return request && Date.now() - request.at > 5 * 3600000 ? { manual: true, status: 'Automatic retry window expired', message: 'The automatic retry window has ended. Inspect the saved transaction before changing this booking.' } : null;
}
function paymentIssue(b) {
  const issue = reconciliationIssue(b);
  if (!issue) return '';
  return `<div class="decision-evidence warning" role="status"><strong>Manual reconciliation needed</strong><p>${esc(issue.message)}</p><p>Status recorded: ${esc(issue.status)}. Preserve this booking and its references while checking the existing transaction in PayPal sandbox.</p></div>`;
}
function wrapStage({ label, step, body, footer = '' }) { return `<section class="stage"><div class="stage-top"><span class="eyebrow">${label}</span><span class="step">${step}</span></div><div class="stage-content">${body}</div>${footer ? `<div class="stage-footer">${footer}</div>` : ''}</section>`; }
function proposedStage(b) {
  const blocked = requiresDetails(b.proposal);
  const cards = b.slots.map((s, index) => {
    const d = dateParts(s.day), option = b.proposal.options?.find(o => o.slotId === s.id);
    const eligible = option?.eligible !== false, recommended = !blocked && b.proposal.slotId === s.id;
    const checks = option?.checks?.length ? `<div class="option-fit"><strong>${eligible ? 'MEETS YOUR REQUIREMENTS' : 'DOES NOT FIT'}</strong><ul>${option.checks.map(check => `<li>${check.met ? '✓' : '×'} ${esc(check.label)}: ${esc(check.actual)}${check.met ? '' : `; needs ${esc(check.expected)}`}</li>`).join('')}</ul></div>` : '';
    return `<article class="session-option ${recommended ? 'recommended' : ''} ${eligible ? '' : 'blocked'}"><div class="option-kicker"><span class="eyebrow">OPTION ${String.fromCharCode(65 + index)}</span>${recommended ? '<span class="recommendation-tag">SUGGESTED</span>' : ''}</div><div class="option-date"><span class="date-number">${d.number}</span><span class="date-month">${d.month} ${s.day.slice(0,4)}<br>${d.weekday}</span></div><h3>${esc(s.place)}</h3><div class="option-time">${s.time} · 60 minutes</div><p class="muted">${esc(s.note)}</p>${checks}<button class="${recommended ? 'primary' : 'secondary'}" data-action="approve" data-slot="${esc(s.id)}" ${blocked || !eligible ? 'disabled' : ''}>${blocked ? 'Brief needs attention' : eligible ? `Approve ${esc(s.place.toLowerCase())}` : 'Outside your requirements'}</button></article>`;
  }).join('');
  const attention = blocked ? `<div class="decision-evidence warning"><strong>${b.proposal.recommendation === 'no_match' ? 'No available example meets every requirement.' : 'One detail needs your decision.'}</strong><p>${esc(b.proposal.question || b.proposal.reason)}</p><p>No session is approved and no payment has been started.</p><div class="actions"><button class="secondary" data-ui="revise-request">Refine the brief →</button></div></div>` : '';
  return wrapStage({ label: blocked ? 'BRIEF NEEDS ATTENTION' : 'REVIEW THE SESSION', step: 'STEP 01 / 03', body: `<div class="stage-intro"><h2>${blocked ? 'A good fit comes first.' : 'Make room for the right session.'}</h2><p class="muted">${blocked ? 'Keep the request intact while you clarify what can change.' : 'Compare the examples with the customer’s requirements. You approve the date before starting a deposit.'}</p></div><div class="brief-summary"><span class="eyebrow">THE CUSTOMER BRIEF</span><blockquote>${esc(b.brief)}</blockquote>${requirementChips(b.requirements)}</div>${attention}<div class="option-grid">${cards}</div>${plannerNote(b.proposal)}`, footer: '<p class="muted">Approval records the session and example policy. It does not start a payment.</p><button class="quiet" data-ui="revise-request">Edit brief & requirements</button>' });
}
function paymentStage(b) {
  const pending = b.state === 'payment_pending', uncertain = Boolean(b.inFlight), manual = Boolean(reconciliationIssue(b));
  const action = pending ? 'capture' : 'order';
  return wrapStage({ label: pending ? 'CONFIRM THE DEPOSIT' : 'SESSION APPROVED', step: 'STEP 02 / 03', body: `<div class="stage-intro"><h2>${uncertain ? 'Check the existing deposit.' : pending ? 'Complete the deposit.' : 'A date. A clear agreement.'}</h2><p class="muted">${uncertain ? 'A payment response is unresolved. The booking and its saved references stay in place.' : pending ? `The ${paymentWord(b)} order is ready. Approve it, then confirm its actual status.` : 'Your date is approved. The deposit is the next, separate commitment.'}</p></div>${agreementCard(b)}<div class="eyebrow">${pending ? 'ORDER AMOUNT' : 'AGREED DEPOSIT'}</div><div class="payment-amount">€60<small>.00 EUR</small></div><p class="small muted">€180.00 example session · €120.00 remains after the deposit</p><div class="payment-note">${b.paymentMode === 'demo' ? 'Offline payment preview. The next action simulates a payment; it does not contact PayPal or move money.' : pending ? 'Approve this order with a PayPal sandbox buyer. A return URL alone is not proof of payment: the server checks the provider status.' : 'Approval happens in PayPal sandbox with a separate buyer account. No live payments.'}</div>${manual ? paymentIssue(b) : uncertain ? '<div class="decision-evidence warning"><strong>Use the same operation to recover.</strong><p>The next check reconciles the existing request. Do not start a replacement booking or a second deposit.</p></div>' : ''}${b.order ? `<p class="provider-ref">ORDER / ${esc(b.order.id)}${b.capture ? `<br>CAPTURE / ${esc(b.capture.id)}<br>STATUS / ${esc(b.capture.status)}` : ''}</p>` : ''}`, footer: manual ? '<p class="muted">Automatic retry is paused. Keep this record for reconciliation.</p>' : `<div class="actions">${b.order?.approve && !uncertain ? `<a class="button-link" href="${esc(b.order.approve)}" target="_blank" rel="noopener noreferrer">Open PayPal sandbox ↗</a>` : ''}<button class="primary" data-action="${action}">${uncertain ? 'Check the same payment' : pending ? `Confirm ${paymentWord(b)} deposit · €60` : `Create ${paymentWord(b)} order`} <span aria-hidden="true">→</span></button></div>` });
}
function bookedStage(b) {
  const draft = drafts.get(b.id) || { reason: '', intent: 'suggest', requirements: b.requirements };
  const last = b.history?.at(-1);
  return wrapStage({ label: 'CONFIRMED AGREEMENT', step: 'STEP 03 / 03', body: `<div class="stage-intro"><h2>${last?.kind === 'reschedule' ? 'New date. Same deposit.' : 'The booking is in place.'}</h2><p class="muted">${last?.kind === 'reschedule' ? `Revision ${b.revision} keeps the existing €60.00 deposit and €120.00 outstanding balance.` : 'When conditions change, prepare a recovery proposal before changing the session or its payment.'}</p></div>${agreementCard(b)}${depositProof(b)}${last?.kind === 'reschedule' ? `<div class="confirmed-note"><span aria-hidden="true">✓</span><span>Moved from ${esc(dateParts(last.before.day).long)} at ${esc(last.before.time)}. Additional charge: €0.00. Original capture retained.</span></div>` : ''}<form id="change-form" class="change-form"><h3>Prepare a change</h3><fieldset class="intent-options"><legend>What does the customer want?</legend>${[['suggest','Find the best option'],['reschedule','Move the session'],['refund','Cancel & refund']].map(([value,label])=>`<label><input type="radio" name="intent" value="${value}" ${draft.intent === value ? 'checked' : ''}>${label}</label>`).join('')}</fieldset><div class="input-heading"><label for="reason">What changed?</label><button class="text-button" type="button" data-ui="example">Use wind scenario</button></div><textarea id="reason" rows="3" maxlength="1200" required placeholder="For example: the coast is too exposed in this fictional wind scenario. We can still do the sheltered morning.">${esc(draft.reason)}</textarea><p class="input-hint">Describe a fictional condition or preference. No live weather or calendar is queried.</p>${requirementFields('change', draft.requirements)}<button class="primary" type="submit">Review recovery proposal <span aria-hidden="true">→</span></button></form>`, footer: `<p class="muted">The current session and deposit stay unchanged until approval.</p>` });
}
function blockedChangeStage(b) {
  const c = b.change;
  const draft = drafts.get(b.id) || { reason: c.reason, intent: c.intent, requirements: c.requirements || c.proposal.requirements || b.requirements };
  return wrapStage({ label: 'RECOVERY NEEDS ATTENTION', step: `REVISION ${b.revision} UNCHANGED`, body: `<div class="stage-intro"><h2>${c.proposal.recommendation === 'no_match' ? 'No suitable move. No forced decision.' : 'Clarify before changing the booking.'}</h2><p class="muted">The current session and confirmed deposit remain intact.</p></div>${agreementCard(b)}<div class="decision-evidence warning"><strong>${c.proposal.recommendation === 'no_match' ? 'The alternatives do not meet every requirement.' : 'The next step is not clear enough to approve.'}</strong><p>${esc(c.proposal.question || c.proposal.reason)}</p></div>${depositProof(b)}<form id="revise-change-form" class="change-form"><h3>Refine the change request</h3><label for="reason">What does the customer need now?</label><textarea id="reason" rows="3" maxlength="1200" required>${esc(draft.reason)}</textarea><fieldset class="intent-options"><legend>Customer’s intended outcome</legend>${[['suggest','Find the best option'],['reschedule','Move the session'],['refund','Cancel & refund']].map(([value,label]) => `<label><input type="radio" name="intent" value="${value}" ${draft.intent === value ? 'checked' : ''}>${label}</label>`).join('')}</fieldset>${requirementFields('change', draft.requirements)}<button class="primary" type="submit">Review updated request →</button></form>${plannerNote(c.proposal)}`, footer: '<button class="quiet" data-action="keep">Keep current session</button><p class="muted">No session change or refund has been approved.</p>' });
}
function reviewStage(b) {
  const c = b.change;
  if (requiresDetails(c.proposal) || ['clarify', 'no_match'].includes(c.approvalKind)) return blockedChangeStage(b);
  const cancellation = c.approvalKind === 'refund', f = changeEffects(b);
  const before = b.slots.find(s => s.id === c.from), after = b.slots.find(s => s.id === c.to);
  const beforeDate = dateParts(before.day), afterDate = after ? dateParts(after.day) : null;
  const fit = c.proposal.options?.find(o => o.slotId === c.to);
  const afterContent = cancellation ? '<h3>Session cancelled</h3><div class="date-display">No replacement date</div><p>The remaining obligation ends.<br>The deposit is returned on confirmation.</p>' : after ? `<h3>${esc(after.place)}</h3><div class="date-display">${afterDate.long}</div><p>${after.time} · Atlantic/Canary<br>Same 60-minute photo session</p>` : '<h3>No replacement proposed</h3><p>Prepare a new change request to consider a date.</p>';
  const body = `<div class="review-switch" role="group" aria-label="Recovery outcome"><button class="${cancellation ? '' : 'selected'}" data-action="review-outcome" data-kind="reschedule" aria-pressed="${!cancellation}" ${!after ? 'disabled' : ''}>Date change</button><button class="cancel ${cancellation ? 'selected' : ''}" data-action="review-outcome" data-kind="refund" aria-pressed="${cancellation}">Cancellation & refund</button></div><div class="stage-intro"><h2>${cancellation ? 'Review the cancellation.' : 'New date. Same deposit.'}</h2><p class="muted">${cancellation ? 'This closes the session, returns the deposit and waives the remaining balance. Nothing has been cancelled yet.' : 'Review the proposed date and the exact financial effect before confirming.'}</p></div><div class="comparison"><div class="compare-side"><span class="eyebrow">CURRENT AGREEMENT</span><h3>${esc(before.place)}</h3><div class="date-display">${beforeDate.long}</div><p>${before.time} · Atlantic/Canary<br>60-minute photo session</p></div><div class="compare-side ${cancellation ? 'cancelled' : ''}"><span class="eyebrow">AFTER YOUR APPROVAL</span>${afterContent}</div></div>${!cancellation && fit ? `<div class="decision-evidence"><strong>Why this session fits</strong><ul>${fit.checks.length ? fit.checks.map(check => `<li>${check.met ? '✓' : '×'} ${esc(check.label)}: ${esc(check.actual)}</li>`).join('') : '<li>No firm restrictions were specified. Review the date and location above.</li>'}</ul></div>` : ''}<table class="effect-table"><thead><tr><th>FINANCIAL EFFECT</th><th>BEFORE</th><th>AFTER</th></tr></thead><tbody><tr><td>Deposit held</td><td>${euro(f.heldBeforeCents)}</td><td>${euro(f.heldAfterCents)}</td></tr><tr><td>Outstanding session balance</td><td>${euro(f.outstandingBeforeCents)}</td><td>${euro(f.outstandingAfterCents)}</td></tr><tr><td>New charge</td><td>€0.00</td><td>${euro(f.additionalChargeCents)}</td></tr></tbody></table>${cancellation ? `<div class="refund-callout"><span>Return to customer<small>${paymentWord(b).toUpperCase()} REFUND · REQUIRES APPROVAL</small></span><strong>${euro(f.refundCents)}</strong></div>` : depositProof(b)}<div class="review-note"><div class="small mono">CHANGE REQUEST / ${esc(stamp(c.createdAt))}</div><p>${esc(c.reason)}</p></div>${plannerNote(c.proposal)}<label class="acknowledge"><input id="decision-ack" type="checkbox">${cancellation ? 'I approve closing this session, returning the €60.00 deposit and waiving the €120.00 balance.' : 'I have reviewed the new session. Keep the existing €60.00 deposit, the €120.00 balance and charge €0.00 extra.'}</label>`;
  return wrapStage({ label: 'YOUR APPROVAL IS REQUIRED', step: `REVISION ${b.revision} → ${b.revision + 1}`, body, footer: `<button class="quiet" data-action="keep">Keep current session</button><button class="${cancellation ? 'danger' : 'primary'}" data-action="${cancellation ? 'refund' : 'reschedule'}" data-approval="true" disabled>${cancellation ? 'Approve cancellation & refund €60' : 'Confirm new date · €0 extra'} <span aria-hidden="true">→</span></button>` });
}
function closedStage(b) {
  const pending = b.state === 'refund_pending';
  return wrapStage({ label: pending ? 'PROVIDER CONFIRMATION PENDING' : 'AGREEMENT CLOSED', step: `REVISION ${b.revision}`, body: `<div class="stage-intro"><h2>${pending ? 'The refund is still pending.' : 'Cancelled. Clearly accounted for.'}</h2><p class="muted">${pending ? 'The refund request is approved, but the deposit is not marked returned until the provider confirms completion.' : 'The session is cancelled, its deposit is returned, and the remaining balance is waived under the example policy.'}</p></div><div class="eyebrow">${pending ? 'REFUND REQUESTED' : 'DEPOSIT RETURNED'}</div><div class="payment-amount">€60<small>.00 EUR</small></div><div class="payment-note">${pending ? 'Other changes are locked while this same refund is reconciled. Retrying checks the existing operation rather than creating another refund.' : `${paymentWord(b).toUpperCase()} REFUND. This booking cannot collect another deposit. The decision log and booking record preserve the original agreement and the approved change.`}</div><p class="provider-ref">CAPTURE ${esc(b.capture.id)}${b.refund ? `<br>REFUND ${esc(b.refund.id)} / ${esc(b.refund.status)}` : ''}</p>${paymentIssue(b)}`, footer: pending && reconciliationIssue(b) ? '<p class="muted">Automatic retry is paused. Keep these references for reconciliation.</p>' : pending ? '<button class="primary" data-action="refund">Reconcile the same refund →</button>' : '<button class="secondary" data-view="receipt">View booking record →</button>' });
}
function logStage(b) {
  const history = (b.history || []).slice().reverse().map(h => `<article class="history-change"><span class="eyebrow">REV ${h.revision} / ${esc(stamp(h.at))}</span><h3>${h.kind === 'refund' ? 'Cancellation approved and refunded' : 'Date change approved'}</h3><p>${esc(slotText(h.before))}<br>→ ${h.after ? esc(slotText(h.after)) : 'Session cancelled'}</p><p class="history-effect">HELD ${euro(h.depositBeforeCents)} → ${euro(h.depositAfterCents)} / BALANCE ${euro(h.balanceBeforeCents)} → ${euro(h.balanceAfterCents)}</p></article>`).join('');
  return wrapStage({ label: 'DECISION LOG', step: `${b.events.length} RECORDED EVENTS`, body: `<div class="stage-intro"><h2>The agreement, over time.</h2><p class="muted">Each approval is recorded with its effect. Times below use Atlantic/Canary.</p></div>${depositProof(b)}${history}<ol class="timeline">${b.events.slice().reverse().map(e=>`<li><time>${esc(stamp(e.at))}${Number.isInteger(e.revision) ? ` / REV ${e.revision}` : ''}</time><p>${esc(e.label)}</p></li>`).join('')}</ol>`, footer: `<p class="muted">${isPaid(b) ? 'Payment references remain attached to this booking.' : 'No completed deposit recorded yet.'}</p><button class="secondary" data-view="receipt">Open record →</button>` });
}
function receiptStage(b) {
  const f = financials(b);
  return wrapStage({ label: 'BOOKING RECORD', step: `REVISION ${b.revision}`, body: `<div class="stage-intro"><h2>A record you can take away.</h2><p class="muted">A readable snapshot of the agreement, payment references and approved changes. Generated from the server when you open or download it.</p></div><div class="receipt-preview"><div class="receipt-brand"><span>PLAN B / BOOKING</span><span class="eyebrow">REV ${b.revision}</span></div><h3>${esc(b.sessionName || 'Outdoor portrait session')}</h3><p class="ref">${esc(b.id)}</p><div class="receipt-sum"><span>Deposit currently held</span><strong>${euro(f.heldCents)}</strong></div><div class="ledger-row"><span>Status</span><strong>${stateLabels[b.state]}</strong></div><div class="ledger-row"><span>Outstanding balance</span><strong>${euro(f.outstandingCents)}</strong></div><div class="ledger-row"><span>Latest update</span><strong>${esc(stamp(b.updatedAt || b.events.at(-1)?.at))}</strong></div><p class="small muted">${b.paymentMode === 'demo' ? 'SIMULATED PAYMENTS' : 'PAYPAL SANDBOX'}. Local snapshot, not a financial receipt. Does not update after export.</p></div><div class="actions"><a class="primary" href="/receipt/${b.id}" target="_blank" rel="noopener">Open print-ready record ↗</a><a class="secondary" href="/receipt/${b.id}?download=1">Download HTML</a><button class="quiet" data-ui="export">Export JSON</button></div><p class="input-hint">The printable version includes all decisions, before/after changes and an export timestamp. Use your browser's Print command to save as PDF.</p>`, footer: '<p class="muted">Pending responses never appear as completed funds.</p>' });
}
function render() {
  const b = bookings.find(item => item.id === activeId) || bookings[0];
  activeId = b?.id; if (activeId) localStorage.setItem('plan-b-active', activeId);
  renderRail();
  if (!b) {
    $('workspace').innerHTML = '<div class="workspace-heading"><div><div class="eyebrow">YOUR LOCAL STUDIO</div><h1>Good sessions deserve a Plan B.</h1><p class="muted">A workspace for the agreement, the deposit and the decision that comes next.</p></div></div><section class="empty-workspace"><div class="empty-main"><span class="eyebrow">READY WHEN YOU ARE</span><h1>When plans move,<br>trust stays.</h1><p class="muted">A considered workspace for photography sessions. Match the brief, hold one deposit, and make a change everyone can understand.</p><button class="primary" data-ui="new">Start a session request →</button><div class="studio-caption"><span>PHOTOGRAPHY / OUTDOOR SESSIONS</span><span>01 → 03</span></div></div><div class="empty-side"><div class="empty-step"><h3>01 / Choose the session</h3><p>Check date, time and shelter against the customer’s requirements.</p></div><div class="empty-step"><h3>02 / Confirm the deposit</h3><p>Approve the agreement first. Confirm its deposit as a separate step.</p></div><div class="empty-step"><h3>03 / Review a change</h3><p>Keep the original deposit or approve a refund, with every effect visible.</p></div></div></section>'; return;
  }
  const stage = view === 'log' ? logStage(b) : view === 'receipt' ? receiptStage(b) : ['proposed', 'needs_details'].includes(b.state) ? proposedStage(b) : ['approved','payment_pending'].includes(b.state) ? paymentStage(b) : b.state === 'booked' ? bookedStage(b) : b.state === 'change_proposed' ? reviewStage(b) : closedStage(b);
  $('workspace').innerHTML = `<div class="workspace-heading"><div><div class="eyebrow">BOOKING / ${b.id.slice(0,8).toUpperCase()}</div><h1>${esc(b.sessionName || 'Outdoor portrait session')}</h1><p class="muted">Revision ${b.revision} <span aria-hidden="true">·</span> Updated ${esc(stamp(b.updatedAt || b.events.at(-1)?.at))} <span aria-hidden="true">·</span> Canary time</p></div><div class="heading-actions">${statusPill(b)}</div></div><nav class="workspace-tabs" aria-label="Booking sections">${[['workspace','Workspace'],['log','Decision log'],['receipt','Booking record']].map(([key,label])=>`<button data-view="${key}" class="${view === key ? 'selected' : ''}" aria-current="${view === key ? 'page' : 'false'}">${label}${key === 'log' ? `<span class="count">${b.events.length}</span>` : ''}</button>`).join('')}</nav><div class="workspace-grid">${stage}${ledger(b)}</div>`;
}
function current() { return bookings.find(b => b.id === activeId); }
function saveDraft() {
  if (!$('reason')) return;
  drafts.set(activeId, { reason: $('reason').value, intent: document.querySelector('input[name=intent]:checked')?.value || 'suggest', requirements: readRequirements('change') });
}
$('search').addEventListener('input', renderRail);
function openRequest(booking = null) {
  editingId = booking?.id || null;
  $('new-title').textContent = booking ? 'Give the brief another look.' : 'Start with the brief.';
  $('brief-intro').textContent = booking ? 'Update the request and check the examples again. No payment is started.' : 'Tell us what matters. Review the fit before making a commitment.';
  $('starter-examples').hidden = Boolean(booking);
  $('create').textContent = booking ? 'Review updated options →' : 'Review session options →';
  const r = requirementsOf(booking?.requirements);
  $('session-name').value = booking?.sessionName || 'Weekend portraits';
  $('session-name').readOnly = Boolean(booking);
  $('brief').value = booking?.brief || 'I would love a relaxed portrait session outdoors. Sunset on the coast is ideal, but a sheltered morning also works.';
  $('day').value = booking?.slots[0]?.day || today.toISOString().slice(0,10);
  $('request-time').value = r.timeOfDay; $('request-shelter').value = r.shelter; $('request-date').value = r.date === 'any' ? '' : r.date;
  $('dialog-error').hidden = true; $('new-dialog').showModal(); $(booking ? 'brief' : 'session-name').focus();
}
$('brief-form').addEventListener('submit', event => {
  event.preventDefault(); const input = { sessionName: $('session-name').value, brief: $('brief').value, day: $('day').value, requirements: readRequirements('request') };
  run(async () => { const b = await api(editingId ? `/api/bookings/${editingId}/revise-request` : '/api/bookings', input); activeId = b.id; view = 'workspace'; $('new-dialog').close(); editingId = null; history.replaceState(null, '', `/?booking=${b.id}`); }, { message: 'Checking the brief and session requirements…', success: 'The request is ready to review. No session or payment has been approved.', focus: true });
});
document.addEventListener('submit', event => {
  if (!['change-form', 'revise-change-form'].includes(event.target.id)) return;
  event.preventDefault(); saveDraft(); const b = current(), draft = drafts.get(b.id), revising = event.target.id === 'revise-change-form';
  run(async () => { await api(`/api/bookings/${b.id}/${revising ? 'revise-change' : 'propose-change'}`, { ...draft, ...(revising ? { changeId: b.change.id } : {}) }); drafts.delete(b.id); view = 'workspace'; }, { message: 'Checking the recovery request. The current agreement stays unchanged…', success: 'Review the request and its financial effect before making a decision.', focus: true });
});
document.addEventListener('input', event => { if (event.target.id === 'reason' || event.target.name === 'intent' || event.target.id?.startsWith('change-')) saveDraft(); });
document.addEventListener('change', event => {
  if (event.target.id === 'decision-ack') {
    const approve = document.querySelector('[data-approval]');
    if (approve) approve.disabled = !event.target.checked;
  }
});
document.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button || busy) return;
  if (button.dataset.ui === 'new') { openRequest(); return; }
  if (button.dataset.ui === 'close-dialog') { $('new-dialog').close(); return; }
  if (button.dataset.ui === 'refresh') { run(async()=>{}, {message:'Reading current bookings…',success:'Workspace is up to date.'}); return; }
  if (button.dataset.filter) { filter = button.dataset.filter; document.querySelectorAll('[data-filter]').forEach(item => { item.classList.toggle('selected', item.dataset.filter === filter); item.setAttribute('aria-pressed', String(item.dataset.filter === filter)); }); renderRail(); return; }
  if (button.dataset.select) { saveDraft(); selectBooking(button.dataset.select); return; }
  if (button.dataset.view) { saveDraft(); view = button.dataset.view; run(async()=>{}, {message:'Reading the current agreement…'}); return; }
  if (button.dataset.example) {
    const examples = {
      portrait: ['Weekend portraits', 'A relaxed portrait session on the coast at sunset. A sheltered morning is also possible.', 'any', 'any', ''],
      family: ['Family, in soft morning light', 'A relaxed family session in a sheltered spot. We can only come in the morning.', 'morning', 'sheltered', ''],
      'no-fit': ['A morning, on one date only', 'We need a sheltered morning session on the first date. The following day is not possible.', 'morning', 'sheltered', $('day').value]
    };
    const [name, brief, time, shelter, date] = examples[button.dataset.example];
    $('session-name').value = name; $('brief').value = brief; $('request-time').value = time; $('request-shelter').value = shelter; $('request-date').value = date; return;
  }
  const b = current(); if (!b) return;
  if (button.dataset.ui === 'revise-request') { openRequest(b); return; }
  if (button.dataset.ui === 'example') { $('reason').value = 'Strong wind makes the exposed location unsuitable in this fictional scenario. We need a sheltered spot and can come either morning or afternoon.'; $('change-shelter').value = 'sheltered'; $('change-time').value = 'any'; $('change-date').value = ''; saveDraft(); $('reason').focus(); return; }
  if (button.dataset.ui === 'export') {
    run(async () => {
      const fresh = (await api('/api/bookings')).find(item => item.id === b.id);
      if (!fresh) throw new Error('Booking unavailable. No record exported.');
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), notice: 'Local snapshot. Synthetic data. Not a financial receipt. Does not update after export.', financialPosition: financials(fresh), booking: fresh }, null, 2)], {type:'application/json'});
      const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `plan-b-record-${b.id}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
    }, {message:'Preparing a current snapshot…',success:'The current booking record has been exported.'}); return;
  }
  const action = button.dataset.action; if (!action) return;
  const payload = { slotId: button.dataset.slot, kind: button.dataset.kind, changeId: b.change?.id, reviewed: Boolean($('decision-ack')?.checked) };
  run(async () => {
    await api(`/api/bookings/${b.id}/${action}`, payload);
    view = 'workspace';
  }, {message: action === 'refund' ? 'Reconciling this approved refund. Other changes are paused…' : action === 'capture' ? 'Confirming the existing deposit…' : 'Saving this decision…', success: action === 'reschedule' ? 'New date approved. Original deposit retained. Additional charge: €0.00.' : action === 'review-outcome' ? 'Review updated. No session or payment action has been executed.' : '', focus: true});
});

try {
  config = await api('/api/status'); bookings = await api('/api/bookings');
  $('mode').textContent = config.paymentMode === 'demo' ? 'OFFLINE PAYMENT DEMO' : 'PAYPAL SANDBOX';
  $('context').innerHTML = `<strong>${config.paymentMode === 'demo' ? 'Payments are simulated' : 'Sandbox only; no real money'}</strong><span class="divider">/</span><span>${config.plannerMode === 'ollama' ? 'Local AI proposes; you approve' : 'Rules preview; you approve'}</span><span class="divider">/</span><span>Synthetic sessions & conditions</span>${!config.paymentReady ? '<strong>Sandbox credentials missing</strong>' : ''}`;
  if (new URLSearchParams(location.search).get('paypal') === 'cancelled') { $('error').textContent = 'PayPal approval was cancelled. No completed deposit is confirmed by this return.'; $('error').hidden = false; }
  render();
} catch (error) { $('error').textContent = error.message; $('error').hidden = false; }

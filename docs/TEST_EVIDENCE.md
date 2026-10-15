# Verification recorded on 14 October 2026

**Current backend: 40/40 tests passed on Node 20.20.0. One real PayPal sandbox capture, move and refund journey completed and survived restart.** An earlier smoke passed three local model inferences and three deterministic guards with simulated payments. The real journey exposed an incorrect year in model prose; the final code replaces that prose with checked fixture facts while retaining the validated AI selection.

Artifact filenames below identify private workspace evidence, not files included in the source distribution. Reproducible tests and smoke scripts are included; local screenshots, provider records and model-run logs are retained separately. Do not infer that an omitted evidence file is available from a public repository.

## Requirements and recovery iteration on 14 October

The final backend suite passed **40/40 on Node 20.20.0** after the explanation correction. Earlier 35/35 passes belong to the preceding iteration, not the exact final source. A local-model smoke on Node 25.6.1 is recorded in `artifacts/local-ai-requirements-smoke-2026-10-14.json`, at **22:36:19.678 UTC / 23:36:19.678 Atlantic/Canary**. It preceded the later replacement of model prose and therefore does not prove that final display behavior.

Four synthetic options now represent afternoon coast, sheltered morning garden, covered afternoon courtyard and open morning meadow. Explicit time, shelter and date requirements produce field-level checks before a recommendation. The tests include incompatible requirements, rejected invalid choices, revised requests, preserved confirmed agreements, clarification states and additional payment timeout/restart recovery cases.

| Final smoke observation | Source and result |
|---|---|
| Afternoon preference, coast or courtyard both compatible | Real Ollama inference selected coast and explained the open-horizon preference. |
| A required date absent from the supplied alternatives | Deterministic `no_match` with a question; no model request and no payment change. |
| Revised morning and shelter requirements | Real Ollama inference selected garden; human-approved move preserved the same capture. |
| Request for unknown accessibility | Deterministic `clarify`; no location selected or accessibility claim accepted. |
| Explicit request to clarify before choosing | Deterministic `clarify`; no location selected. |
| Explicit cancellation | Real Ollama inference recommended refund with no replacement slot. Refund followed separate human approval. |

The final state was `refunded`, with **one simulated create, capture and refund**. No real PayPal request was made by this smoke. The guards are labelled `constraint-check` and must not be described as successful model reasoning.

Earlier attempts are retained in `artifacts/local-ai-requirements-smoke-2026-10-14-first-attempt.json`, `artifacts/local-ai-requirements-smoke-2026-10-14-second-attempt.json` and `artifacts/local-ai-clarification-diagnostic.json`. They found an output-budget failure, an invented wheelchair-access guarantee and a choice despite a request to ask first. Known request patterns now stop before inference, and the prompt states which facts are unknown. These corrections do not establish general semantic reliability; free-text model output can still be wrong and requires human review.

## Real PayPal sandbox journey on 14 October

Private receipt: `artifacts/sandbox-journey-2026-10-14.json`. The browser walkthrough used the actual sandbox API through the local server and real local Ollama. It did not use production money or a real customer booking.

1. A fictional buyer approved an actual sandbox order and PayPal returned a **COMPLETED EUR60 capture**.
2. A human-approved change moved Coast path on 21 October at 17:30 to Sheltered garden on 22 October at 10:00. The same capture reference remained, €60 stayed held and no additional charge was created.
3. Separate cancellation approval produced a **COMPLETED EUR60 refund**. The booking closed at revision 2 with €0 held, €0 outstanding and nine decision events.
4. The server was restarted after the explanation fix. Browser reload preserved capture/refund references, revision and balances. Screenshot `qa-2026-10-14/12-persisted-after-restart.jpg` records the observed state.

The original walkthrough screenshot `04-recovery-date-diagnostic.jpg` shows a genuine defect: the selected fixture was in 2026, but free model prose mentioned 2025. The original ledger was retained. The final correction gives new proposals an `explanationSource` of `verified-fixtures` or `application-policy`, records replaced-text review metadata, and hides legacy unverified wording in the interface and printable record. The regression is recorded in `artifacts/ai-reason-date-regression-2026-10-14.json`. The payment journey preceded that text correction; the original screenshot is diagnostic evidence, not a final marketing frame.

The reviewer observed the refunded state, form and no-match at a 390-pixel mobile viewport with a 375-pixel document width, without horizontal overflow. The no-match and known-accessibility cases disabled all four choices. After restart, a refined request generated a fresh real Ollama selection of Sheltered garden on 22 October 2026 at 10:00; the visible explanation identified its source as session data and showed two satisfied requirements. Screenshots `13-verified-ai-proposal.jpg` and `14-accessibility-clarification.jpg` record those cases in the private `artifacts/qa-2026-10-14/` directory. The final source/UI then passed another **40/40 Node 20.20.0** test run.

This verifies one bounded sandbox flow. Network response-loss and the five-hour retry boundaries were tested with explicit HTTP stubs, not forced against PayPal. It does not establish production reliability, customer benefit or general model accuracy.

## Historical verification from 12 October 2026

**The local booking flow passes. Real local AI passes. Real PayPal sandbox remains untested because account access is missing.** Payments below are explicitly offline simulations or HTTP stubs. No account registration, paid API call, real payment, public deployment or submission occurred.

## Automated behavior and HTTP tests

Studio iteration 2: `npm test` completed **16 tests, 16 passed, 0 failed** using Node **v25.6.1**, installed at `/opt/homebrew/bin/node`.

The same final source was separately tested with Node **v20.20.0**:

```sh
$HOME/.nvm/versions/node/v20.20.0/bin/node --test
```

Result: **16 tests, 16 passed, 0 failed**. The test set includes an actual loopback HTTP server, not only direct function calls. Node 20 was checked again after the final product code, on 12 October 2026. No new packages were installed.

| Boundary | Observed result |
|---|---|
| Main flow, concurrency | Eight concurrent order attempts and eight capture attempts each call the offline adapter once. |
| Rescheduling | The original capture ID survives, selected date changes, no new capture occurs. |
| Restart | Bookings and the same capture ID reload from persisted JSON. |
| Approved refund | Eight duplicate refund attempts invoke the offline refund adapter once. |
| Changed intent | Switching date change to cancellation creates a new review ID. Old IDs and missing explicit acknowledgement are rejected without changing funds. |
| Financial history | Date change preserves €60 held / €120 outstanding; completed cancellation records €0 / €0. Both revisions survive reload, with one capture. |
| Lost response | Operation ID survives restart; incompatible actions stay blocked until reconciliation. |
| Pending provider state | Capture/refund PENDING never becomes a confirmed booking/refund. |
| Wrong amount | A mismatched capture amount leaves the booking unconfirmed. |
| Missing sandbox keys | Order creation fails closed with zero outbound payment requests. Live mode is refused. |
| Sandbox HTTP stubs | OAuth/order/capture/refund requests use only the hard-coded sandbox host; request IDs persist and a captured order is read before a retry. This is contract testing, not real sandbox evidence. |
| AI schema | Invented slot IDs fail validation; accepted output remains a proposal. Rules mode explicitly reports rules-preview. |
| Local HTTP | Cross-origin and form-style mutations rejected; .env returns 404; normal JSON flow works. |
| Printable record | HTTP route returns HTML and attachment headers; customer markup is escaped; script execution is prohibited; current funds and export timestamp are included. |
| Pending accounting | Pending capture/refund values are excluded from completed funds. Projections show exact effects without mutating the booking. |

## Real local AI smoke

Executed `npm run test:ai` on Node **v25.6.1** with the already installed **qwen3-vl:8b** model through loopback Ollama. Result file for that run: `artifacts/local-ai-smoke.json`. Timestamp: **2026-10-12 12:55:45.319 UTC / 13:55:45.319 Atlantic/Canary**. This supersedes the first iteration's smoke artifact from 12:18 UTC.

| Synthetic request | Observed validated response |
|---|---|
| Only morning, needs shelter from wind | Selected garden, explaining that morning and shelter match both constraints. |
| Move from exposed coast to sheltered morning after a fictional wind change | Recommended reschedule, selected garden; after human approval the same capture ID remained. |
| Cancel and refund because neither date works | Recommended refund; refund executed only after separate human approval. |

The smoke ended refunded with **one simulated create, one simulated capture, one simulated refund**. These are observed calls in this run, not real PayPal operations or a production reliability metric. The artifact contains individual timings for reproducibility; no general latency claim is made.

Initial chat-endpoint trials failed to finish a usable structured response within the output budget. The final adapter uses the documented `/api/generate` endpoint with `raw: true`, schema output and a 512-token limit. It checks the installed model inventory, rejects known cloud aliases, validates JSON, accepts only supplied slot IDs and never executes actions from model output. No model was downloaded.

During iteration 2, an initial mixed-preference brief produced a slot/reason mismatch. The final prompt now separates an initial `propose` outcome from recovery `reschedule`/`refund`, and states that the latest change request overrides the original preference. The same mixed brief was rerun in the browser: coast was suggested, with a matching coast explanation; the subsequent sheltered request chose garden. These finite cases do not establish general model accuracy. Human review remains required.

## Studio iteration 2 browser verification

Executed in a dedicated Chrome tab against `127.0.0.1:4323`, using separate local data in `.data/studio-v2-review`. The server used real local Ollama and demo payments. The session created at 12:56 UTC was resumed and completed at approximately 16:49–16:53 UTC on 12 October 2026.

1. Created **October coastal portraits**, starting 24 October, with sunset coast preferred and sheltered morning acceptable. The real model suggested coast with a matching reason.
2. Approved coast, created one simulated order and confirmed a €60 simulated capture. The displayed outstanding balance changed from €180 to €120.
3. Used the fictional wind scenario. The model suggested sheltered garden on 25 October. Reviewed the before/after date and time, €60 → €60 held, €120 → €120 balance and €0 new charge.
4. Switched the review to cancellation. The separate view projected the full refund and balance waiver, while the current ledger stayed €60 held / €120 outstanding. Its approval button was disabled before acknowledgement. Switched back and approved the date change, producing revision 1.
5. At a **390 × 844** viewport, inspected the confirmed revision. `innerWidth = 390`, document scroll width `375`; no horizontal overflow. Restored the viewport override.
6. Selected **Cancel & refund**, entered a fictional inability to attend either date, and generated a new local AI proposal. Checked the separate acknowledgement and approved the simulated refund. Revision 2 showed €60 returned, €0 held, €0 outstanding and €0 additional charges.
7. Opened Decision log, verified both before/after revisions, and exercised duplicate deposit protection after closure. It returned the same existing capture, leaving the closed state unchanged.
8. Opened the printable record, downloaded HTML and exported JSON through the UI. The browser's JSON download-event wait timed out, but the application displayed export success and the actual downloaded file was inspected: `exportedAt = 2026-10-12T16:52:11.798Z`, state `refunded`, revision 2, two approved changes, €60 capture / €60 refund / €0 held / €0 outstanding. Both downloaded files were copied to `artifacts/studio-record.html` and `artifacts/studio-record.json`.
9. Reloaded the app. The closed booking, revision 2, original capture and completed refund were still present. Closed the two QA tabs and stopped the isolated 4323 server. No parent launcher process was touched.

Current visual artifacts:

- `artifacts/studio-desktop-top.jpg`: viewport capture from actual scroll position 0, with full navigation and current record.
- `artifacts/studio-record.jpg`: self-contained readable record, financial position and both approved changes.
- `artifacts/studio-mobile.jpg`: confirmed rescheduled session at 390px.
- `studio-desktop.jpg` and `studio-cancellation.jpg`: full-page review captures; the desktop full-page capture includes the browser's sticky-rail offset, so use the top viewport capture for presentation.

An independent read-only backend review also passed eight focused tests and a synthetic sequence covering changed intent, stale review IDs, missing acknowledgement, two revisions and one order/capture/refund. No new confirmed finding was reported. It used demo/stubs, not PayPal sandbox.

## First iteration browser evidence (historical)

In the Codex in-app browser, the following actions were exercised on the real local application:

1. Create request, approve coast, create simulated order, confirm simulated €60 deposit, propose a change and approve garden.
2. Verify unchanged capture ID, €60 retained deposit, €0 extra, persisted state after refresh and duplicate capture protection.
3. Enable the real local model, submit a morning/shelter request and see the garden proposal with LOCAL AI · QWEN3-VL:8B, while the payment banner continues to say simulated.
4. Open a second tab and approve that session. Export from the first, stale tab. The downloaded snapshot contains current state approved, selectedSlot garden and exportedAt 2026-10-12T12:20:13.258Z, rather than the stale proposed state.
5. Inspect a 390px viewport: innerWidth = 390, document scroll width 390, no horizontal overflow. The temporary viewport override was reset.

Local screenshots: `artifacts/desktop-rescheduled.jpg` and `artifacts/desktop-local-ai.jpg`. The latter shows the real local model proposal; neither claims real sandbox payment. The downloaded export was moved into `artifacts/receipt-current-snapshot.json`. Artifacts and data ledgers are excluded from future Git tracking by default.

## Demonstration and evaluation scope

- The narrated demonstration was completed on 15 October: 135.03 seconds, 1080p, 24 edited app views, the author's voice and synchronized English captions. Its financial states come from the verified sandbox capture, change and refund journey. The no-match insert is a separately labelled example.
- Keep pending, refused and expired provider behavior labelled as stub-tested boundaries unless actual sandbox evidence is later recorded for them.
- The public source contains only an explicit set of application files, tests and documentation. Local credentials, ledgers, provider evidence and browser state are excluded; reviewers should use their own sandbox accounts and local model to repeat the supplied steps.
- Keep this local-only until a separate security/deployment design exists. Current file locking and serialization support one process on one machine, not distributed production payments.

The automatic payment retry window is conservatively bounded to five hours. Expired or ambiguous transactions require manual sandbox reconciliation, preserving the existing ledger. No automatic reset or ledger deletion is provided as a payment recovery mechanism.

# Plan B Booking

A local prototype for outdoor photographers: compare four supplied session options against a customer's requirements, approve a deposit, then review a change without collecting a second deposit. Cancellation and refund require a separate human decision. Every step stays with the same booking.

**A working local prototype with a complete sandbox demonstration.** One real PayPal sandbox journey completed a €60 capture, a human-approved date change without a second charge and a €60 refund. Restart and browser reload preserved the final record. Offline preview payments remain explicitly simulated. See [test evidence](docs/TEST_EVIDENCE.md) for the exact AI and payment validation scope.

## Run the complete offline preview

Requires Node.js 20.12+ and a browser. No packages, API account, subscription, remote font or hosting are needed.

```sh
npm start
```

Open <http://127.0.0.1:4320>. Keep this exact loopback address, since other Host headers are intentionally rejected.

1. Click **New booking**, name the fictional session and set any required time of day, shelter or date. Submit the request, inspect the option checks and approve a compatible session.
2. Create a **simulated** order, then simulate the €60 deposit.
3. Describe a synthetic change and choose whether to ask for a suggestion, move the session or cancel. Review the session and exact financial effects before approving.
4. Check the retained €60 deposit, €0 additional charges and unchanged capture ID. Refresh to check persistence.
5. Propose another change, open the separate cancellation review, acknowledge its effects and approve a **simulated** refund.
6. Open **Decision log** for dated revisions, or **Booking record** for printable HTML, HTML download and JSON export.

The default planner is labelled **Rules preview, not AI**. It cannot satisfy the hackathon AI requirement. Dates, availability, locations, prices, policy and weather changes are synthetic examples. The app does not retrieve weather or reserve a real calendar slot.

Try a request that cannot fit: require the first fixture date and a morning session, while that date only supplies afternoon options. The app asks what can change instead of proposing an incompatible session. Use **Refine the brief** or **Refine the change request** to revise the requirements. Changing a recovery request does not replace the confirmed agreement or payment.

## Enable local AI

Choose a model already present in `ollama list`; no automatic model download occurs. Cloud model names are rejected, and the adapter only calls `127.0.0.1:11434`.

For a fresh machine, install [Ollama](https://ollama.com/download) and open it. If its local service is not running, start `ollama serve` in a separate terminal and leave it running. Then explicitly download the model used for this demo:

```sh
ollama pull qwen3-vl:8b
ollama list
```

This optional download is about **6.1 GB** according to the [official model listing](https://ollama.com/library/qwen3-vl:8b); inference then runs locally. No cloud API key is needed. You can skip the download for the offline rules preview, but genuine AI evaluation requires an installed model. Plan B never installs or downloads one automatically. The [official CLI guide](https://docs.ollama.com/cli) documents service startup and model downloads.

Stop any running Plan B server, then start its AI mode:

```sh
PLANNER_MODE=ollama OLLAMA_MODEL=qwen3-vl:8b npm start
```

Stop the default server first. The application filters four fixed slots against explicit time, shelter and date requirements; the model ranks compatible options and proposes a recovery outcome. JSON is schema constrained and validated again; unknown slots, malformed output or provider failure cannot approve a booking or payment. There is no silent fallback to pretend AI. The visible explanation comes from checked fixture facts or application policy, not the model's free-form wording. Historical unverified model wording is hidden without rewriting the ledger.

No-match and known requests for unavailable facts use deterministic guards before inference. They are labelled as requirement checks, not model output. These guards cover specific patterns for accessibility, live weather, real availability and requests to clarify first; they do not establish general understanding. Earlier model trials invented accessibility information and stated the wrong year for a correctly selected session, so human review and checked factual explanations remain important.

On 14 October 2026, `qwen3-vl:8b` completed three real inference cases: ranking two compatible options, moving to a sheltered morning and explicit cancellation. The same smoke exercised three deterministic guards and one **simulated** order/capture/refund; this run preceded the final explanation replacement. Run `npm run test:ai` to repeat the bounded scenarios; it is not a PayPal sandbox test. The dated result is recorded in [test evidence](docs/TEST_EVIDENCE.md). Each proposal records its source; changing planner mode does not relabel historical decisions.

The installed model's license was checked with `ollama show qwen3-vl:8b --license` on 14 October: Apache 2.0, matching the [official Ollama listing](https://ollama.com/library/qwen3-vl:8b). Model weights are not bundled with this application. Review the license of any replacement model separately.

## Prepare PayPal sandbox when access exists

Account creation, terms acceptance and sandbox access are user dependencies. Do not put credentials in chat, code, screenshots or a public repository. No production endpoint is configurable.

Use [the sandbox runbook](docs/SANDBOX_RUNBOOK.md) for the full verification sequence. `node scripts/readiness.mjs` reports local configuration readiness without executing PayPal requests or proving sandbox success.

```sh
cp -n .env.example .env
# Edit .env locally: PAYMENT_MODE=sandbox and sandbox-only client ID / secret.
# Optionally set PLANNER_MODE=ollama and an installed model name.
npm run sandbox
```

Keep an existing `.env`; the copy command above does not overwrite it. With credentials missing, order creation returns an explicit error and makes no PayPal request. Once access is available, use separate sandbox seller and buyer identities. Create an order locally, open the returned **PayPal sandbox** approval link, approve with the sandbox buyer, return, then click **Confirm sandbox deposit**. A return URL or query parameter never confirms a payment. The server reads the actual order, captures only an approved order and validates the €60/EUR result.

An approved cancellation requests a full sandbox refund. `PENDING` is retained as pending and can be reconciled with the same action. Success means an actual `COMPLETED` provider result. This path completed in the recorded 14 October sandbox journey; network-loss and expiry behavior was tested with HTTP stubs, not forced against PayPal.

## How payment consistency works

| Boundary | Behavior |
|---|---|
| Human approval | Choosing a session and approving a change are distinct actions. Switching the proposed outcome creates a new review ID and invalidates stale approval. Cancellation requires a separate acknowledgement. The AI cannot call payment actions. |
| One deposit per booking | Repeated order/capture clicks return the existing recorded result. Rescheduling never invokes a payment endpoint. |
| Retry after timeout | A PayPal request ID is persisted before each mutation. Capture retries first read the existing order. |
| Unknown result | Other actions are frozen until the same operation is reconciled. Pending refunds cannot be turned into rescheduling. |
| Restart | Atomic JSON writes preserve bookings and operation IDs. A lock file rejects a second server using the same data directory. |
| Retry expiry | Automatic retries stop after five hours, conservatively below the documented Orders retention. Existing transactions require manual sandbox reconciliation, not a new payment attempt. |
| Local isolation | Server binds only `127.0.0.1`. Host/origin checks, JSON and a custom header block cross-site mutation. Static routes use an explicit allowlist; printable records disallow scripts through CSP. |

Data lives in `.data/demo.json` or `.data/sandbox.json`, separately. `DATA_DIR` can select another local folder. Do not edit/delete a ledger to recover an uncertain sandbox payment. If a process is killed forcibly, a stale `.lock` can remain: inspect its recorded PID and remove it only after confirming that process is no longer running.

## Verify and review

```sh
npm test
```

The final 14 October backend suite passed **40 tests on Node 20.20.0**. It covers duplicate requests, restart recovery, retained deposits, stale approval IDs, financial history, invalid model output, pending provider states, expired recovery, explicit requirements, guarded clarification, checked explanations, escaped printable records and server isolation. All automated payment tests use offline or HTTP stubs; the actual sandbox journey is documented separately.

Review `lib/booking.mjs` for state transitions, `lib/payments.mjs` for sandbox calls, `lib/planner.mjs` for model boundaries, then `test/booking.test.mjs` for executable examples. `lib/finance.mjs` supplies the same financial calculations to the interface and `lib/receipt.mjs`. The UI is original, buildless HTML/CSS/JS with a persistent booking rail, an action workspace and a separate financial ledger. No external assets are loaded.

**Booking record** offers self-contained printable HTML and JSON. Both fetch current server state and include an export timestamp. Approved revisions preserve the previous and next session, the held deposit and the outstanding balance. They are local snapshots, not financial receipts or live documents. Before capture the outstanding amount is €180; after the €60 deposit it is €120; a completed full cancellation waives that remainder. Pending provider responses never count as completed funds.

## Scope and demonstration

This is a single-user local prototype, not production payment software. It has no multi-user authentication, calendar inventory lock, payment webhooks, tax handling, partial refunds, live weather or distributed storage. Local files are private only to the extent that the operating-system account is private. Do not expose this server publicly.

The sandbox journey and final interface verification are complete. A fresh local-AI proposal after restart displayed the correct checked session facts; no-match and known accessibility questions blocked approval. The 2:15 demonstration uses the author's own English narration, synchronized captions and 24 edited views of the actual interface. See the [demonstration guide](docs/DEMO_SCRIPT.md) and [primary sources](docs/SOURCES.md).

This source distribution contains the application, empty configuration template, tests and documentation. Credentials, payment ledgers, provider payloads, browser state and local evidence files are excluded. The narrated film is a separate deliverable; its edited app captures illustrate verified states rather than an uninterrupted recording of every click.

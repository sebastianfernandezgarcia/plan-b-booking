# Plan B Booking demonstration guide

The final demonstration is **2 minutes 15 seconds**, with the author's own English narration and synchronized captions. It follows one fictional photo booking through a verified PayPal sandbox deposit, a reviewed change and a separately approved refund. The film uses 24 edited views of the actual interface. It is not an uninterrupted screen recording.

## Story and evidence

| Part | What the viewer sees |
|---|---|
| A small request with consequences | “Can we move the session?” A deposit has already been paid, so changing the plan also means agreeing what happens to the money. The opening uses an editorial studio image. |
| The original booking | An afternoon coast session, explicit requirements, a compatible local-model proposal and human review. The €60 deposit is approved through PayPal sandbox and confirmed only after a completed capture. |
| A change to review | A fictional windy-coast scenario leads to a proposed sheltered morning. Before approval, the interface compares the original and proposed date, location and financial effects. |
| The same deposit | The human-approved move keeps €60 attached to the booking, adds no charge and leaves €120 outstanding. The confirmed result follows the review. |
| Another decision | A separately labelled no-match example asks which requirement can change. The film then returns to the original booking for cancellation review and a separately approved, completed €60 refund. |
| A readable record | The booking record combines the decisions and payment references. The closing identifies fictional sessions, test money and the prototype's local scope. |

The visual comparison uses the verified coast session on 21 October 2026 at 17:30 and sheltered garden session on 22 October at 10:00. Financial state labels remain visible. The no-match insert does not inherit the main booking's deposit.

## Reproduce the journey

Start with the [README](../README.md). Its offline mode is explicitly simulated. To repeat the payment evidence, configure your own sandbox credentials locally and follow the [sandbox runbook](SANDBOX_RUNBOOK.md). Enable an installed local model to repeat AI proposals; the default rules preview does not count as AI.

The [test evidence](TEST_EVIDENCE.md) distinguishes the actual sandbox journey from offline tests, HTTP stubs and bounded model trials. Pending, refused, lost-response and expired-retry behavior is tested with stubs; the film does not claim those failures were forced against PayPal.

## Limits

The sessions, availability, weather scenario and policy are fictional. The app does not fetch weather, reserve a real calendar or process production money. AI proposes an option; people approve bookings, changes and refunds. Checked fixture facts supply displayed explanations. The film does not claim customers, measured savings or general model accuracy.

The demonstration is distributed separately from this source package. No credentials, account details, buyer passwords, provider payloads or local payment ledgers belong in public source or presentation assets.

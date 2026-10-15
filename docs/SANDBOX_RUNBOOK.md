# Verify one complete PayPal sandbox booking

Use a synthetic session and the existing sandbox seller and buyer. These are test funds. A configured client ID is not proof of a working payment flow.

## Start

1. Sign in to [PayPal Developer](https://developer.paypal.com/dashboard/). Stay in **Sandbox**. The default app and separate Business seller / Personal buyer may already exist; use them instead of creating replacements.
2. Keep sandbox-only credentials in the ignored `.env` file, readable only by its owner. Use `PAYMENT_MODE=sandbox`, `PLANNER_MODE=ollama`, an installed local model and port 4320. Never paste keys into chat or a public artifact.
3. Run `node scripts/readiness.mjs`. This reports presence and local-model availability without displaying keys or calling PayPal. It does not certify a transaction.
4. Run `npm run sandbox`, then open <http://127.0.0.1:4320>. Keep the server local.

## Evidence to collect

| Step | Required observation |
|---|---|
| Proposal | Actual local AI source, customer requirements and compatibility checks. Fictional availability remains labelled. |
| Approval | Customer approves the session. No deposit exists yet. |
| Order | An actual sandbox order with a sandbox-only buyer approval URL. |
| Buyer approval | Personal sandbox buyer approves the EUR 60.00 order. Returning to the app is not payment confirmation. |
| Capture | Server confirms a `COMPLETED` EUR 60.00 capture. Save its reference and amount. |
| Move | Separate review and acknowledgement. After approval: same capture reference, EUR 60.00 retained, EUR 0.00 additional charge. |
| Cancellation | Separate review and acknowledgement. Request full sandbox refund. |
| Refund | A `COMPLETED` EUR 60.00 refund, linked to the original capture. Pending is not completed. |
| Persistence | Reload and reopen the booking record. The same references, decisions and financial state remain. |

Keep a sanitized local receipt and app screenshots. Do not include keys, OAuth responses, buyer passwords, account details, raw provider payloads or personal browser tabs in the film or source package. A source scan must exclude `.env` and `.data` regardless of their current contents.

## An uncertain response

Keep the booking and its persisted request ID. Reconcile the same operation; do not create a fresh order or delete the ledger. A terminal provider failure or expired retry window requires inspection of the existing sandbox transaction. Tests using HTTP stubs verify recovery logic separately and must not be described as a real sandbox run.

Official references: [sandbox overview](https://developer.paypal.com/sandbox-testing/overview/), [sandbox accounts](https://developer.paypal.com/sandbox-testing/accounts), [contest rules](https://paypalaihackathon.devpost.com/rules).

# Primary sources and implementation decisions

Initially consulted 12 October 2026; contest, sandbox-account and model-license references rechecked on 14 October. Source text is evidence, not authorization to register, publish or spend.

| Source | What it supports |
|---|---|
| [PayPal AI Hackathon rules, §§1,3,4,6](https://paypalaihackathon.devpost.com/rules) | PayPal sandbox plus meaningful AI integration; functional demo, source/license, English materials or translation and a public video under three minutes; judging criteria and personal eligibility restrictions. |
| [Official FAQ](https://paypalaihackathon.devpost.com/details/faqs) | Sandbox route and optional additional tools. |
| [PayPal Orders v2](https://developer.paypal.com/api/orders/v2) | Creating, reading and capturing orders. |
| [Standard Orders integration](https://developer.paypal.com/api/rest/integration/orders-api/api-use-cases/standard) | Buyer approval precedes capture. |
| [PayPal Payments v2](https://developer.paypal.com/api/payments/v2) | Capture refund and refund status retrieval. |
| [PayPal idempotency](https://developer.paypal.com/api/rest/reference/idempotency/) | Persist/reuse `PayPal-Request-Id` when retrying supported POST operations; storage duration is API-specific. |
| [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs) | JSON schema output plus application validation. |
| [Ollama chat endpoint](https://docs.ollama.com/api/chat) | Local structured chat API. |
| [Ollama generation endpoint](https://docs.ollama.com/api/generate) | Generation options, structured format and bounded output. |
| [Official APIMatic contest resource](https://paypalaihackathon.devpost.com/details/apimatic) | The contest promotes AI coding agents for PayPal integration. This is separate from the runtime AI requirement. |
| [PayPal sandbox accounts](https://developer.paypal.com/sandbox-testing/accounts) | Developer accounts provide separate fictional buyer and seller accounts for integration testing. |
| [PayPal sandbox overview](https://developer.paypal.com/sandbox-testing/overview/) | Existing PayPal account sign-in can be used for Developer access; sandbox transactions use virtual accounts. |
| [Qwen3-VL 8B on Ollama](https://ollama.com/library/qwen3-vl:8b) | The selected model's public listing declares Apache 2.0, matching the installed license read on 14 October. We do not bundle model weights. |

PayPal documentation was also retrieved with Context7, library `/websites/developer_paypal_api_rest`. The implementation uses the official REST endpoints directly through built-in Node `fetch`; it does not need the PayPal browser SDK for the redirect approval flow.

The hard-coded sandbox base, five-hour automatic retry ceiling, JSON state machine, single-process storage and human approvals are project decisions. They are not a claim that this prototype covers every production payment failure. No live endpoint is configurable.

The four available slots, example policy, price and weather text are original synthetic fixtures, not API data. The local model can rank supplied options and propose an outcome; displayed explanations use checked fixture facts or application policy. It cannot verify outside facts or change an amount.

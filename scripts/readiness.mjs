import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Local diagnostics only. Never print credentials or call a payment endpoint.
const envPath = fileURLToPath(new URL('../.env', import.meta.url));
let envFile = null;
try {
  const info = await stat(envPath);
  envFile = { present: true, restrictedToOwner: (info.mode & 0o077) === 0 };
  process.loadEnvFile(envPath);
} catch (error) {
  if (error.code === 'ENOENT') envFile = { present: false, restrictedToOwner: null };
  else { console.error('Local configuration could not be read. No values were printed.'); process.exit(1); }
}

const model = process.env.OLLAMA_MODEL || '';
const report = {
  checkedAt: new Date().toISOString(),
  envFile,
  paymentMode: process.env.PAYMENT_MODE || 'demo',
  sandboxCredentialsConfigured: Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
  plannerMode: process.env.PLANNER_MODE || 'rules-preview',
  localModelInstalled: false,
  ollamaReachable: false,
  paypalContacted: false,
  sandboxFlowVerifiedByThisCheck: false,
  nextStep: ''
};
if (report.plannerMode === 'ollama') {
  try {
    const response = await fetch('http://127.0.0.1:11434/api/tags', { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Local model unavailable');
    const body = await response.json();
    const installed = body.models?.find(item => item.name === model);
    report.ollamaReachable = true;
    report.localModelInstalled = Boolean(installed && !installed.remote_host && !installed.remote_model && !/cloud/i.test(model));
  } catch { /* An unavailable local service is reported, without guessing. */ }
}
const configured = report.paymentMode === 'sandbox' && report.sandboxCredentialsConfigured
  && report.plannerMode === 'ollama' && report.localModelInstalled;
report.nextStep = configured
  ? 'Configuration is present. Run the real sandbox approval, capture, move and refund journey. This check does not verify a payment or AI inference.'
  : 'Complete the missing local configuration before the sandbox journey. See docs/SANDBOX_RUNBOOK.md.';
console.log(JSON.stringify(report, null, 2));

import http from 'node:http';
import { readFile, mkdir, open, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPayments, AppError } from './lib/payments.mjs';
import { createPlanner } from './lib/planner.mjs';
import { BookingService } from './lib/booking.mjs';
import { renderReceipt } from './lib/receipt.mjs';

const root = dirname(fileURLToPath(import.meta.url));
export async function start({ port = Number(process.env.PORT || 4320), dataDir = process.env.DATA_DIR || join(root, '.data'), paymentMode = process.env.PAYMENT_MODE || 'demo', plannerMode = process.env.PLANNER_MODE || 'rules-preview', model = process.env.OLLAMA_MODEL || '' } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT');
  const origin = `http://127.0.0.1:${port}`;
  const payments = createPayments({ mode: paymentMode, clientId: process.env.PAYPAL_CLIENT_ID, clientSecret: process.env.PAYPAL_CLIENT_SECRET, origin });
  const planner = createPlanner({ mode: plannerMode, model });
  await mkdir(dataDir, { recursive: true });
  const lockPath = join(dataDir, `${paymentMode}.lock`);
  let lock;
  try { lock = await open(lockPath, 'wx'); await lock.writeFile(String(process.pid)); }
  catch { throw new Error(`Data directory is already in use. Stop the other server; only remove ${lockPath} after confirming its PID is no longer running.`); }
  let service;
  try { service = await new BookingService({ file: join(dataDir, `${paymentMode}.json`), payments, planner }).load(); }
  catch (error) { await lock.close(); await rm(lockPath, { force: true }); throw error; }
  const server = http.createServer(async (req, res) => {
    const actualOrigin = `http://127.0.0.1:${server.address().port}`;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    function json(status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }
    try {
      if (req.headers.host !== new URL(actualOrigin).host) throw new AppError('Use the loopback URL printed by the server.', 403);
      if (req.headers.origin && req.headers.origin !== actualOrigin) throw new AppError('Cross-origin requests are disabled.', 403);
      const url = new URL(req.url, actualOrigin);
      if (req.method === 'GET' && url.pathname === '/api/status') return json(200, { paymentMode, paymentReady: payments.ready, plannerMode, model: planner.model, synthetic: true });
      if (req.method === 'GET' && url.pathname === '/api/bookings') return json(200, service.list());
      const receipt = url.pathname.match(/^\/receipt\/([a-f0-9-]+)$/);
      if (req.method === 'GET' && receipt) {
        const booking = structuredClone(service.get(receipt[1]));
        const html = renderReceipt(booking);
        res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
        if (url.searchParams.get('download') === '1') res.setHeader('Content-Disposition', `attachment; filename="plan-b-record-${booking.id}.html"`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html);
      }
      if (req.method === 'POST') {
        if (req.headers['content-type']?.split(';')[0] !== 'application/json' || req.headers['x-plan-b'] !== 'local') throw new AppError('Use the local application JSON client.', 403);
        let body = '';
        for await (const chunk of req) { body += chunk; if (body.length > 10000) throw new AppError('Request too large.', 413); }
        let input; try { input = JSON.parse(body || '{}'); } catch { throw new AppError('Invalid JSON.', 400); }
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('Expected a JSON object.', 400);
        if (url.pathname === '/api/bookings') return json(201, await service.create(input));
        const match = url.pathname.match(/^\/api\/bookings\/([a-f0-9-]+)\/([a-z-]+)$/);
        if (match) return json(200, await service.action(match[1], match[2], input));
      }
      const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/finance.js': ['../lib/finance.mjs', 'text/javascript'] };
      const file = files[url.pathname];
      if (req.method !== 'GET' || !file) throw new AppError('Not found.', 404);
      const contents = await readFile(join(root, 'public', file[0]));
      res.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8` }); res.end(contents);
    } catch (error) {
      const message = error instanceof AppError ? error.message : error.name === 'TimeoutError' || error.name === 'AbortError' ? 'Provider timed out. Keep this booking and retry the same action to reconcile it.' : 'Request failed. Existing booking retained. Check the local provider and retry.';
      json(error.status || 503, { error: message });
    }
  });
  server.on('close', async () => { await lock.close(); await rm(lockPath, { force: true }); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }).catch(async error => { await lock.close(); await rm(lockPath, { force: true }); throw error; });
  return { server, service, payments };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { server } = await start();
  console.log(`Plan B Booking: http://127.0.0.1:${server.address().port} · ${process.env.PAYMENT_MODE || 'demo'} payments · ${process.env.PLANNER_MODE || 'rules-preview'} planner`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}

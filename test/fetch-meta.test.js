// Run: npm test   (node's built-in runner, no extra deps)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchMeta, pinterestCanonicalUrl } from '../fetch-meta.js';

const page = (title, description) =>
  `<html><head><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"></head></html>`;

// Fake fetch: `routes` maps request URL -> { finalUrl?, html?, status? } (finalUrl simulates redirects)
function fakeFetch(routes) {
  const calls = [];
  const impl = async url => {
    calls.push(url);
    const r = routes[url];
    if (!r) throw new Error(`network error: ${url}`);
    return { ok: (r.status || 200) < 400, url: r.finalUrl || url, text: async () => r.html || '' };
  };
  return { impl, calls };
}

// Shape observed in production 2026-11-16 (pin.it/7if1B6hOa)
const SENT = 'https://www.pinterest.com/pin/1044694444835256785/sent/?invite_code=abc&sender=123&sfo=1';
const BARE = 'https://www.pinterest.com/pin/1044694444835256785/';

test('pin.it share: title comes from the bare pin page, not the "sent" landing page', async () => {
  const { impl, calls } = fakeFetch({
    'https://pin.it/7if1B6hOa': { finalUrl: SENT, html: page('Check out this Pin from RONE', '') },
    [BARE]: { html: page('Ground Beef and Dumplings', 'A delicious one-pot dinner') },
  });
  const meta = await fetchMeta('https://pin.it/7if1B6hOa', { fetchImpl: impl });
  assert.deepEqual(meta, { title: 'Ground Beef and Dumplings', description: 'A delicious one-pot dinner' });
  assert.deepEqual(calls, ['https://pin.it/7if1B6hOa', BARE]);
});

test('bare pin page unreachable: falls back to the first page', async () => {
  const { impl } = fakeFetch({
    'https://pin.it/x': { finalUrl: SENT, html: page('Take a look! 📌', 'Lemon Pepper Chicken') },
    [BARE]: { status: 403 },
  });
  const meta = await fetchMeta('https://pin.it/x', { fetchImpl: impl });
  assert.deepEqual(meta, { title: 'Take a look! 📌', description: 'Lemon Pepper Chicken' });
});

test('bare pin page with a title but no description keeps the first description', async () => {
  const { impl } = fakeFetch({
    'https://pin.it/x': { finalUrl: SENT, html: page('Take a look! 📌', 'Lemon Pepper Chicken') },
    [BARE]: { html: '<meta property="og:title" content="Lemon Pepper Chicken Thighs">' },
  });
  const meta = await fetchMeta('https://pin.it/x', { fetchImpl: impl });
  assert.deepEqual(meta, { title: 'Lemon Pepper Chicken Thighs', description: 'Lemon Pepper Chicken' });
});

test('already-bare pin URL is fetched once', async () => {
  const { impl, calls } = fakeFetch({ [BARE]: { html: page('Ground Beef and Dumplings', 'x') } });
  await fetchMeta(BARE, { fetchImpl: impl });
  assert.deepEqual(calls, [BARE]);
});

test('non-Pinterest URL is fetched once and unchanged', async () => {
  const { impl, calls } = fakeFetch({ 'https://example.com/a': { html: page('An article', 'About things') } });
  const meta = await fetchMeta('https://example.com/a', { fetchImpl: impl });
  assert.deepEqual(meta, { title: 'An article', description: 'About things' });
  assert.deepEqual(calls, ['https://example.com/a']);
});

test('network failure returns nulls', async () => {
  const { impl } = fakeFetch({});
  assert.deepEqual(await fetchMeta('https://pin.it/gone', { fetchImpl: impl }), { title: null, description: null });
});

test('pinterestCanonicalUrl', () => {
  assert.equal(pinterestCanonicalUrl(SENT), BARE);
  assert.equal(pinterestCanonicalUrl('https://uk.pinterest.co.uk/pin/42/?x=1'), 'https://www.pinterest.com/pin/42/');
  assert.equal(pinterestCanonicalUrl('https://pinterest.com/user/board/'), null);
  assert.equal(pinterestCanonicalUrl('https://notpinterest.com/pin/42/'), null);
  assert.equal(pinterestCanonicalUrl('https://pin.it/abc'), null);
  assert.equal(pinterestCanonicalUrl('not a url'), null);
});

// ── Timeouts: real node-fetch against local servers that stall ───────────────
// Metadata must never block capture: a stalled site yields null fields, quickly.
import http from 'node:http';

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${server.address().port}/`); }
  finally { server.closeAllConnections(); server.close(); }
}

async function timed(promise) {
  const t0 = Date.now();
  const value = await promise;
  return { value, ms: Date.now() - t0 };
}

test('server that never responds: gives up at the timeout with nulls', async () => {
  await withServer(() => {}, async url => {
    const { value, ms } = await timed(fetchMeta(url, { timeoutMs: 300 }));
    assert.deepEqual(value, { title: null, description: null });
    assert.ok(ms < 2000, `took ${ms}ms`);
  });
});

test('server that stalls mid-body: gives up at the timeout with nulls', async () => {
  const handler = (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.write('<html><head><meta property="og:title" content="Partial'); // never ends
  };
  await withServer(handler, async url => {
    const { value, ms } = await timed(fetchMeta(url, { timeoutMs: 300 }));
    assert.deepEqual(value, { title: null, description: null });
    assert.ok(ms < 2000, `took ${ms}ms`);
  });
});

test('normal server still works with real node-fetch', async () => {
  const handler = (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(page('Real page', 'Real description')); };
  await withServer(handler, async url => {
    assert.deepEqual(await fetchMeta(url, { timeoutMs: 2000 }), { title: 'Real page', description: 'Real description' });
  });
});

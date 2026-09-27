import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { allowV2Preview } from '../scripts/v2-preview-policy.mjs';
import { parseCatalogue, readCatalogue, safeImageUrl } from '../src/v2-preview/catalogue.mjs';

test('production cannot enable the preview even with local opt-in', () => {
  assert.equal(allowV2Preview({ VERCEL_ENV: 'production', QCLUB_LOCAL_V2_PREVIEW: '1' }, 'serve'), false);
  assert.equal(allowV2Preview({ VERCEL_ENV: 'production', VITE_ENABLE_V2_ROUTES: 'true' }), false);
  assert.equal(allowV2Preview({}), false);
  assert.equal(allowV2Preview({ QCLUB_LOCAL_V2_PREVIEW: '1' }, 'build'), false);
  assert.equal(allowV2Preview({ VERCEL_ENV: 'preview' }), true);
  assert.equal(allowV2Preview({ QCLUB_LOCAL_V2_PREVIEW: '1' }, 'serve'), true);
});

test('Ledger, payment handlers, shared catalogue, schema and dependencies match the pinned production commit', () => {
  const baseline = JSON.parse(readFileSync(new URL('./production-baseline.json', import.meta.url)));
  for (const [path, expected] of Object.entries(baseline.files)) {
    const content = readFileSync(new URL(`../${path}`, import.meta.url));
    const actual = createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
    assert.equal(actual, expected, `${path} changed from production ${baseline.commit}. Review separately before updating the baseline.`);
  }
});

const sample = () => ({ ok: true, source: 'qclub_fnb_master', menuCatalog: {
  drinks: { title: 'Drinks', items: [{ id: 'item-1', name: 'Test drink', price: 40, inStock: false, onlineOrderEnabled: false, image: '/test.jpg' }] },
} });

test('catalogue preserves authoritative identity, price and availability', () => {
  const row = parseCatalogue(sample())[0];
  assert.equal(row.id, 'drinks');
  assert.deepEqual(row.items[0], sample().menuCatalog.drinks.items[0]);
  assert.deepEqual(parseCatalogue({ ok: true, source: 'qclub_fnb_master', menuCatalog: {} }), []);
});

test('untrusted, failed and malformed menu responses never become available items', () => {
  for (const value of [null, { ok: false }, { ...sample(), source: 'legacy' }, { ...sample(), menuCatalog: [] }]) {
    assert.throws(() => parseCatalogue(value));
  }
  for (const price of [0, -1, '40', null, NaN, Infinity]) {
    const value = sample(); value.menuCatalog.drinks.items[0].price = price;
    assert.throws(() => parseCatalogue(value));
  }
});

test('image paths reject script URLs, credentials and protocol-relative paths', () => {
  for (const value of ['javascript:alert(1)', '//other.test/x', '/\\other.test/x', 'http://other.test/x', 'https://user:secret@other.test/x']) {
    assert.equal(safeImageUrl(value), '');
  }
  assert.equal(safeImageUrl('https://example.com/photo.jpg'), 'https://example.com/photo.jpg');
});

test('preview issues only a credential-free GET to the shared catalogue and rejects HTTP errors', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (...args) => {
    calls.push(args); return { ok: true, json: async () => sample() };
  });
  const controller = new AbortController();
  await readCatalogue(controller.signal);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/api/snooker/v1/public-catalogue');
  assert.equal(calls[0][1].method, 'GET');
  assert.equal(calls[0][1].credentials, 'omit');
  assert.equal(calls[0][1].cache, 'no-store');
  assert.equal(calls[0][1].signal, controller.signal);
  globalThis.fetch.mock.mockImplementation(async () => ({ ok: false }));
  await assert.rejects(readCatalogue(), /could not load/);
});

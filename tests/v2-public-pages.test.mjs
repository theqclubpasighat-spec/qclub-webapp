import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('V2 public body skin is loaded after the shell skin', async () => {
  const entry = await read('src/production-entry.jsx');
  const shell = entry.indexOf('./v2-live/v2-live.css');
  const pages = entry.indexOf('./v2-live/v2-public-pages.css');
  assert.ok(shell >= 0);
  assert.ok(pages > shell);
});

test('public-page skin covers the high-value legacy public bodies without adding behaviour', async () => {
  const css = await read('src/v2-live/v2-public-pages.css');
  for (const marker of [
    '.shopProductGrid',
    '.shopFloatingCart',
    '.membershipTierCard',
    '.photoGrid',
    '.player-link',
    '.pageHead',
    'table'
  ]) assert.ok(css.includes(marker), marker);
  assert.doesNotMatch(css, /fetch\s*\(|localStorage|sessionStorage|startPayment|supabase|Cashfree|MSG91/i);
});

test('V2 shell applies public skin only to public routes', async () => {
  const shell = await read('src/components/layout-shell.jsx');
  for (const path of ['/shop','/book','/membership','/tournaments','/fixtures','/leaderboard','/players','/halloffame','/photos']) {
    assert.ok(shell.includes('"' + path + '"'), path);
  }
  for (const protectedPath of ['/QclubLedger','/QclubPay','/QclubQr','/admin/orders','/food-print-bridge']) {
    assert.equal(shell.includes('"' + protectedPath + '"'), false, protectedPath);
  }
  assert.match(shell, /document\.body\.classList\.toggle\("qclub-v2-live",\s*isV2Public\)/);
});

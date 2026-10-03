import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/admin-preview/entry.jsx', import.meta.url), 'utf8');

test('role tools reuse canonical production destinations without duplicate admin routes', () => {
  for (const path of [
    '/QclubLedger',
    '/admin/orders',
    '/admin/orders-archive',
    '/shop/successful-order-receipts',
    '/member-registry',
    '/inventory',
    '/staff-walkins',
    '/review-panel',
    '/match-ledger',
    '/players',
    '/tournaments',
    '/fixtures',
    '/leaderboard',
    '/halloffame',
    '/live',
    '/admin-panel',
    '/tv',
    '/payment-status',
    '/food-print-bridge',
  ]) assert.ok(source.includes(path), 'missing canonical route ' + path);
  for (const path of [
    '/admin/members','/admin/bookings','/admin/players','/admin/tournaments','/admin/standings',
    '/admin/hall-of-fame','/admin/live-games','/admin/food-orders','/admin/shop-orders','/admin/payments','/admin/reports',
  ]) assert.ok(!source.includes("href:'" + path + "'") && !source.includes('href:"' + path + '"'), 'duplicate V2 route should not be wired: ' + path);
});

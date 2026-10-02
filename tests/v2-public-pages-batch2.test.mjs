import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Batch 2 stylesheet loads after Batch 1',async()=>{
  const entry=await read('src/production-entry.jsx');
  const b1=entry.indexOf('./v2-live/v2-public-pages.css');
  const b2=entry.indexOf('./v2-live/v2-public-pages-batch2.css');
  assert.ok(b1>=0);
  assert.ok(b2>b1);
});

test('Batch 2 preserves the existing order flow and adds only presentation markers',async()=>{
  const app=await read('src/App.jsx');
  const css=await read('src/v2-live/v2-public-pages-batch2.css');
  for(const marker of ['v2-members-page','v2-member-card','v2-game-card'])assert.ok(app.includes(marker),marker);
  for(const marker of ['.foodMenuGrid','.foodCatChip','.foodFloatingCart','.v2-members-page','.v2-game-card','.legalCard'])assert.ok(css.includes(marker),marker);
  assert.doesNotMatch(css,/fetch\s*\(|localStorage|sessionStorage|startPayment|supabase|Cashfree|MSG91/i);
  // Existing live order handler remains in App rather than being replaced by the skin.
  assert.ok(app.includes('startPayment('));
  assert.ok(app.includes('qclub_food_cart'));
});

test('protected operational route implementations are not restyled by explicit selectors',async()=>{
  const css=await read('src/v2-live/v2-public-pages-batch2.css');
  for(const marker of ['QclubLedger','QclubPay','QclubQr','food-print-bridge','admin/orders']){
    assert.equal(css.includes(marker),false,marker);
  }
});

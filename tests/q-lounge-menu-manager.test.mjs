import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manager = await readFile(new URL("../src/v2-live/V2FoodManager.jsx", import.meta.url), "utf8");
const api = await readFile(new URL("../src/server/snooker-v1.js", import.meta.url), "utf8");
const food = await readFile(new URL("../src/v2-live/V2Food.jsx", import.meta.url), "utf8");

test("Q Lounge exposes menu management through the existing Admin PIN session", () => {
  assert.match(food, /<V2FoodManager onUpdated=/);
  assert.match(manager, /qclub_admin_access_token_v2/);
  assert.match(manager, /cms\/session/);
  assert.match(manager, /session\.role !== "ADMIN"/);
  assert.match(manager, /catalogue\/items/);
  assert.match(manager, /catalogue\/categories/);
  assert.match(manager, /Deactivate/);
  assert.match(manager, /cost_price_inr/);
  assert.match(manager, /low_stock_threshold/);
});

test("catalogue category writes require an Admin session and protect categories in use", () => {
  for (const name of ["createCatalogueCategory", "updateCatalogueCategory", "removeCatalogueCategory"]) {
    const start = api.indexOf(`async function ${name}(`);
    assert.notEqual(start, -1, `${name} exists`);
    const block = api.slice(start, api.indexOf("\nasync function ", start + 1));
    assert.match(block, /requireAuth\(req, res, \["ADMIN"\]\)/, `${name} requires ADMIN`);
  }
  assert.match(api, /CATEGORY_IN_USE/);
  assert.match(api, /\.eq\("active", true\)\.select\("\*"\)\.maybeSingle\(\)/);
});

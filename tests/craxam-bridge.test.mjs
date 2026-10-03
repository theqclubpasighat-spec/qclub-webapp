import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const bridge = readFileSync(new URL("../src/components/CraXamAuthBridgePage.jsx", import.meta.url), "utf8");

test("CraXam bridge routes remain active in production", () => {
  assert.match(app, /path="\/Craxam" element={<CraXamAuthBridgePage \/>}/);
  assert.match(app, /path="\/craxam" element={<CraXamAuthBridgePage \/>}/);
});

test("CraXam bridge preserves OAuth query and hash payload exactly", () => {
  assert.match(bridge, /craxam:\/\/callback/);
  assert.match(bridge, /window\.location\.search/);
  assert.match(bridge, /window\.location\.hash/);
  assert.ok(!/console\.(log|debug|info|warn|error)/.test(bridge), "bridge must not log OAuth payloads");
});

test("CraXam privacy and deletion compliance routes remain present", () => {
  assert.match(app, /path="\/craxam\/privacy"/);
  assert.match(app, /path="\/craxam\/delete-account"/);
});

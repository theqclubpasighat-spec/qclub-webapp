import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const entry = readFileSync(new URL("../src/production-entry.jsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../src/components/layout-shell.jsx", import.meta.url), "utf8");
const home = readFileSync(new URL("../src/v2-live/V2Home.jsx", import.meta.url), "utf8");
const food = readFileSync(new URL("../src/v2-live/V2Food.jsx", import.meta.url), "utf8");

test("public root uses V2 Home while preserving classic admin Home controls", () => {
  assert.match(app, /path="\/" element=\{admin \? <Home[\s\S]*: <V2Home/);
  assert.match(app, /import V2Home from "\.\/v2-live\/V2Home\.jsx"/);
});

test("Q Lounge is a real production route backed by the shared catalogue", () => {
  assert.match(app, /path="\/food" element=\{<V2Food \/>\}/);
  assert.match(food, /readCatalogue/);
  assert.match(food, /\.\.\/v2-preview\/catalogue\.mjs/);
  assert.match(food, /to="\/offer"/);
});

test("production entry loads V2 shell after legacy styles", () => {
  const legacyIndex = entry.indexOf('import "./styles.css";');
  const v2Index = entry.indexOf('import "./v2-live/v2-live.css";');
  assert.ok(legacyIndex >= 0);
  assert.ok(v2Index > legacyIndex);
});

test("new shell keeps protected operational pages out of the public-theme list", () => {
  assert.doesNotMatch(shell, /"\/qclubledger"/i);
  assert.doesNotMatch(shell, /"\/qclubpay"/i);
  assert.doesNotMatch(shell, /"\/qclubqr"/i);
  assert.match(shell, /"\/book"/);
  assert.match(shell, /"\/shop"/);
  assert.match(shell, /"\/food"/);
});

test("compact home links to current production workflows instead of replacing them", () => {
  for (const path of ["/book", "/membership", "/shop", "/tournaments", "/fixtures"]) {
    assert.ok(home.includes(`"${path}"`), `missing ${path}`);
  }
});


test("critical production workflows remain routed through their existing components", () => {
  const required = [
    'path="/book"',
    'path="/membership"',
    'path="/offer"',
    'path="/shop"',
    'path="/admin/orders"',
    'path="/food-print-bridge"',
    'path="/QclubLedger"',
    'path="/QclubPay"',
    'path="/QclubQr"',
    '<QclubLedgerPage />',
    '<QclubPayPage />',
    '<QclubQrPage />',
  ];
  for (const marker of required) {
    assert.ok(app.includes(marker), `missing production route/component marker: ${marker}`);
  }
});

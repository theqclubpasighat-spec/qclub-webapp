import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const entry = readFileSync(new URL("../src/production-entry.jsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../src/components/layout-shell.jsx", import.meta.url), "utf8");
const home = readFileSync(new URL("../src/v2-live/V2Home.jsx", import.meta.url), "utf8");
const food = readFileSync(new URL("../src/v2-live/V2Food.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/v2-live/v2-live.css", import.meta.url), "utf8");

test("public root uses V2 Home while preserving classic admin Home controls", () => {
  assert.match(app, /path="\/" element=\{admin \? <Home[\s\S]*: <V2Home/);
  assert.match(app, /import V2Home from "\.\/v2-live\/V2Home\.jsx"/);
});

test("Q Lounge is a real production route backed by the shared catalogue", () => {
  assert.match(app, /path="\/food" element=\{<V2Food \/>\}/);
  assert.match(food, /readCatalogue/);
  assert.match(food, /..\/lib\/public-catalogue.mjs/);
  assert.match(food, /to="\/offer"/);
});

test("live Q Lounge never imports preview modules", () => {\n  assert.doesNotMatch(food, /v2-preview/);\n  assert.match(food, /public-catalogue\\.mjs/);\n});\n\ntest("production entry loads V2 shell after legacy styles", () => {
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


test("V2 body skin is scoped to allowlisted public pages only", () => {
  assert.match(css, /body\.qclub-v2-live \.shopProductCard/);
  assert.match(css, /body\.qclub-v2-live \.membershipTierCard/);
  assert.match(css, /body\.qclub-v2-live \.pageHead/);
  assert.doesNotMatch(css, /body:not\(\.qclub-v2-live\)/);
  const allowlistMatch = shell.match(/const PUBLIC_V2_PATHS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(allowlistMatch, "public V2 route allowlist missing");
  const allowlist = allowlistMatch[1].toLowerCase();
  for (const protectedPath of ["/QclubLedger", "/QclubPay", "/QclubQr", "/admin/orders", "/food-print-bridge", "/T1", "/T2", "/T3", "/T4"]) {
    assert.ok(!allowlist.includes(`"${protectedPath.toLowerCase()}"`), `protected route leaked into public V2 theme: ${protectedPath}`);
  }
});

test("existing public commerce engines remain mounted while receiving V2 presentation", () => {
  for (const marker of ["<BookTable", "<Membership", "<QShopPage", "<Tournaments", "<Players"]) {
    assert.ok(app.includes(marker), `existing public engine replaced unexpectedly: ${marker}`);
  }
});

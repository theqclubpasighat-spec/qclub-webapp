import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const entry = readFileSync(new URL("../src/production-entry.jsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../src/components/layout-shell.jsx", import.meta.url), "utf8");
const home = readFileSync(new URL("../src/v2-live/V2Home.jsx", import.meta.url), "utf8");
const food = readFileSync(new URL("../src/v2-live/V2Food.jsx", import.meta.url), "utf8");
const publicInfo = readFileSync(new URL("../src/v2-live/V2PublicInfo.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/v2-live/v2-live.css", import.meta.url), "utf8");
const kitty = readFileSync(new URL("../src/components/kitty-page.jsx", import.meta.url), "utf8");
const pageHelpers = readFileSync(new URL("../src/components/page-helpers.jsx", import.meta.url), "utf8");
const adminPanel = readFileSync(new URL("../src/components/admin-panel.jsx", import.meta.url), "utf8");

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


test("safe donor public info routes reuse production policy and pricing data", () => {
  assert.match(app, /path="\/refund-policy"[\s\S]*<RefundContent/);
  assert.match(app, /path="\/legal" element=\{<V2LegalHub \/>\}/);
  assert.match(app, /path="\/pricing" element=\{<V2Pricing data=\{data\} \/>\}/);
  for (const path of ["/terms", "/refund", "/privacy", "/tournament-legal"]) {
    assert.ok(publicInfo.includes(`to: "${path}"`), `legal hub missing ${path}`);
  }
  assert.match(publicInfo, /data\?\.memberships/);
  assert.match(publicInfo, /data\?\.booking\?\.tables/);
  assert.doesNotMatch(publicInfo, /fetch\(|supabase|localStorage|payment/i);
});

test("unsupported donor public routes are not invented by the V2 shell", () => {
  for (const path of ["/bylaws", "/disclaimer"]) {
    assert.ok(!app.includes(`path="${path}"`), `placeholder route should not be activated: ${path}`);
  }
});


test("rules and anti-gambling donor routes reuse existing authoritative policy content", () => {
  assert.match(app, /path="\/rules" element=\{<V2RulesHub \/>\}/);
  assert.match(app, /path="\/anti-gambling"[\s\S]*<TournamentLegalContent/);
  assert.match(publicInfo, /to="\/terms"/);
  assert.match(publicInfo, /to="\/legal"/);
  assert.doesNotMatch(publicInfo, /No smoking|No alcohol|Spitting is strictly prohibited/i);
});


test("generic receipt stays retired while CraXam auth bridge remains active", () => {
  assert.doesNotMatch(app, /path="\/receipt"/);
  assert.match(app, /path="\/Craxam"/);
  assert.match(app, /path="\/craxam"\s/);
  assert.match(app, /path="\/craxam\/privacy"/);
  assert.match(app, /path="\/craxam\/delete-account"/);
});


test("Kitty routes and game types match the current four physical tables", () => {
  const expected = [
    ['table1','T1 Liberwin','snooker_ronnie_12x6','/kitty-table-1','/kitty-table-1-display','600'],
    ['table2','T2 Wiraka 777','snooker_extra_12x6','/kitty-table-2','/kitty-table-2-display','600'],
    ['table3','T3 Mini Snooker','snooker_mini_10x5','/kitty-table-3','/kitty-table-3-display','500'],
    ['table4','T4 Pool','pool_american','/kitty-table-4','/kitty-table-4-display','400'],
  ];
  for (const [key,label,type,scorePath,displayPath,rate] of expected) {
    assert.ok(kitty.includes(`key: "${key}"`), `missing Kitty ${key}`);
    assert.ok(kitty.includes(`label: "${label}"`), `wrong Kitty label for ${key}`);
    assert.ok(kitty.includes(`gameType: "${type}"`), `wrong Kitty game type for ${key}`);
    assert.ok(kitty.includes(`scorePath: "${scorePath}"`), `wrong score path for ${key}`);
    assert.ok(kitty.includes(`displayPath: "${displayPath}"`), `wrong display path for ${key}`);
    assert.ok(kitty.includes(`ratePerHour: ${rate}`), `wrong existing Kitty rate mapping for ${key}`);
    assert.ok(app.includes(`path="${scorePath}"`), `missing app scorer route ${scorePath}`);
    assert.ok(app.includes(`path="${displayPath}"`), `missing app display route ${displayPath}`);
  }
  assert.match(kitty, /KITTY_TABLE_MAPPING_VERSION/);
  assert.match(kitty, /legacyMappingMismatch/);
  assert.match(kitty, /_legacy_/);
  assert.match(kitty, /kittyDefaultRedsOnTable\(currentKittyTableConfig\.gameType\)/);
  assert.match(pageHelpers, /"\/kitty-table-4"/);
  assert.match(pageHelpers, /"\/kitty-table-4-display"/);
  assert.match(adminPanel, /T4 Pool Kitty Scorer/);
  assert.match(adminPanel, /T4 Pool Kitty Display/);
});


test("unsafe or obsolete donor utility routes are retired while feedback uses current contact", () => {
  assert.match(app, /path="\/feedback" element=\{<V2FeedbackHub \/>\}/);
  assert.match(publicInfo, /to="\/contact"/);
  assert.doesNotMatch(publicInfo, /98628 00000|contact@theqclubpasighat\.com|lockers are available/i);
  for (const path of ["/bylaws", "/disclaimer", "/admin/login", "/reset-password", "/admin/storage-migrate"]) {
    assert.ok(!app.includes(`path="${path}"`), `retired donor route should not be active: ${path}`);
  }
});

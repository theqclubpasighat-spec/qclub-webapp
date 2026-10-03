import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const admin = readFileSync(new URL("../src/admin-live/AdminLivePage.jsx", import.meta.url), "utf8");
const registry = readFileSync(new URL("../docs/production-route-registry.md", import.meta.url), "utf8");

const explicit = [...new Set(
  [...app.matchAll(/<Route\b[^>]*\bpath\s*=\s*["']([^"']+)["']/g)]
    .map(match => match[1])
    .filter(path => path !== "*")
)];
const cmsDeepLinks = [...new Set(
  [...admin.matchAll(/["'](\/admin\/[^"']+)["']\s*:/g)].map(match => match[1])
)];
const actual = [...new Set([...explicit, ...cmsDeepLinks])].sort();

const retired = new Set([
  "/receipt", "/Craxam", "/craxam", "/admin/login", "/reset-password",
  "/admin/storage-migrate", "/bylaws", "/disclaimer",
]);

const documented = [...new Set(
  [...registry.matchAll(/^\| `([^`]+)` \|/gm)]
    .map(match => match[1])
    .filter(path => !retired.has(path))
)].sort();

test("production route registry covers every named client route and CMS deep link", () => {
  assert.equal(actual.length, 109);
  assert.deepEqual(documented, actual);
});

test("retired donor routes remain absent from production App routes", () => {
  for (const path of retired) {
    assert.ok(!explicit.includes(path), "retired route unexpectedly active: " + path);
  }
});

test("compatibility aliases point at the documented canonical routes", () => {
  for (const [alias, canonical] of [
    ["/qclubledger", "/QclubLedger"],
    ["/qclubpay", "/QclubPay"],
    ["/qclubqr", "/QclubQr"],
    ["/refund-policy", "/refund"],
  ]) {
    const line = registry.split("\n").find(row => row.startsWith("| `" + alias + "` |"));
    assert.ok(line, "missing alias row: " + alias);
    assert.ok(line.includes("| Alias |"), "route is not marked Alias: " + alias);
    assert.ok(line.includes(canonical), "alias target mismatch for " + alias);
  }
});

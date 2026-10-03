import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createAdminClient } from "../src/admin-live/client.mjs";

const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../api/qclub-cms.js", import.meta.url), "utf8");
const page = readFileSync(new URL("../src/admin-live/AdminLivePage.jsx", import.meta.url), "utf8");
const clientSource = readFileSync(new URL("../src/admin-live/client.mjs", import.meta.url), "utf8");
const isolation = readFileSync(new URL("../scripts/isolated-build-output.mjs", import.meta.url), "utf8");

test("live Website Manager is mounted at /admin", () => {
  assert.match(app, /import\("\.\/admin-live\/AdminLivePage\.jsx"\)/);
  assert.match(app, /path="\/admin"/);
  assert.match(app, /<AdminLivePage \/>/);
});

test("live CMS uses canonical server auth and never calls rehearsal endpoints", () => {
  assert.match(clientSource, /\/api\/snooker\/v1\/auth\/login/);
  assert.match(clientSource, /\/api\/qclub-cms\?action=content/);
  assert.doesNotMatch(clientSource, /qclub-checkout-rehearsal|QCLUB_SECURITY_REHEARSAL/);
  assert.doesNotMatch(page, /rehearsal website|PREVIEW ·/);
});

test("CMS writes are main-admin only even though legacy committee sessions use ADMIN role", () => {
  assert.match(api, /authenticate\(db, req, \["ADMIN"\]\)/);
  assert.match(api, /actor\.staff_id !== "admin-main"/);
  assert.match(api, /throw new SecurityError\(403, "FORBIDDEN"\)/);
});

test("committee login is normalized away from ADMIN in the live CMS client", async () => {
  const calls = [];
  const storage = {
    value: "",
    getItem() { return this.value; },
    setItem(_key, value) { this.value = value; },
    removeItem() { this.value = ""; },
  };
  const fetcher = async (url, options = {}) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          access_token: "snk_" + "a".repeat(43),
          role: "ADMIN",
          staff_id: "admin-committee",
          display_name: "Committee Admin",
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        };
      },
    };
  };
  const client = createAdminClient(fetcher, storage);
  const actor = await client.login("fixture-pin");
  assert.equal(actor.role, "COMMITTEE");
  assert.equal(actor.staff_id, "admin-committee");
  assert.equal(calls[0].url, "/api/snooker/v1/auth/login");
  assert.ok(storage.value.startsWith("snk_"));
});

test("production isolation still rejects rehearsal admin entry and client", () => {
  assert.match(isolation, /admin-preview\\\/\(\?:entry\\\.jsx\|client\\\.mjs\)/);
  assert.match(isolation, /checkout-preview/);
});

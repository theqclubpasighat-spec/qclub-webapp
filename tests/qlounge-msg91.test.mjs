import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const webhook = fs.readFileSync(new URL("../api/cashfree-webhook.js", import.meta.url), "utf8");
const sender = fs.readFileSync(new URL("../api/whatsapp-send.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

test("Q Lounge success uses the approved v2 template and namespace", () => {
  for (const source of [webhook, sender]) {
    assert.match(source, /qlounge_order_success_v2/);
    assert.match(source, /81882be1_5490_4998_98fb_29f89d47fdb4/);
  }
});

test("Q Lounge success contract has exactly five body values", () => {
  assert.match(
    sender,
    /params:\s*\["customer_name", "food_order_no", "food_items", "amount", "service_note"\]/
  );
  assert.match(webhook, /QLOUNGE_SERVICE_NOTE/);
  assert.match(app, /Ready-to-serve items will be handed over immediately\. Prepared items may take up to 15 minutes\./);
});

test("Q Lounge uses MSG91 bulk to_and_components contract", () => {
  assert.match(sender, /whatsapp-outbound-message\/bulk\//);
  assert.match(sender, /to_and_components/);
  assert.match(sender, /body_\$\{index \+ 1\}/);
  assert.match(webhook, /whatsapp-outbound-message\/bulk\//);
  assert.match(webhook, /to_and_components/);
});

test("food item text includes quantity and line amount", () => {
  assert.match(webhook, /\$\{name\} x \$\{qty\} = ₹\$\{lineTotal\}/);
  assert.match(app, /\$\{itemName\} x \$\{qty\} = ₹\$\{Number\.isFinite\(lineTotal\) \? lineTotal : 0\}/);
});

test("stale food-success environment settings cannot revert the approved template", () => {
  assert.match(webhook, /contextKey\(context\) === "food"\) return QLOUNGE_SUCCESS_TEMPLATE/);
  assert.match(sender, /food_success: QLOUNGE_SUCCESS_TEMPLATE/);
  assert.match(app, /return "qlounge_order_success_v2"/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canOrderLoungeItem, loungeOrderLines } from "../src/v2-live/lounge-order.mjs";

const sample = [
  {
    id: "beverages",
    items: [
      { id: "diet-coke", name: "Diet Coke", price: 70, inStock: true, onlineOrderEnabled: true },
      { id: "out", name: "Out of stock", price: 85, inStock: false },
    ],
  },
  {
    id: "momo",
    items: [
      { id: "chicken-momo", name: "Chicken Momo", price: 201, onlineOrderEnabled: true },
      { id: "counter", name: "At counter only", price: 100, onlineOrderEnabled: false },
    ],
  },
];

test("online ordering respects master menu availability", () => {
  assert.equal(canOrderLoungeItem(sample[0].items[0]), true);
  assert.equal(canOrderLoungeItem(sample[0].items[1]), false);
  assert.equal(canOrderLoungeItem(sample[1].items[1]), false);
  assert.equal(canOrderLoungeItem(null), false);
});

test("same-page cart uses current master prices and excludes unavailable or stale items", () => {
  const cart = { "diet-coke": 2, "chicken-momo": 1, out: 3, counter: 1, deleted: 5 };
  assert.deepEqual(loungeOrderLines(cart, sample), [
    { id: "diet-coke", name: "Diet Coke", qty: 2, price: 70, lineTotal: 140 },
    { id: "chicken-momo", name: "Chicken Momo", qty: 1, price: 201, lineTotal: 201 },
  ]);
  const renamedAndRepriced = sample.map((group) => ({
    ...group,
    items: group.items.map((item) => item.id === "diet-coke"
      ? { ...item, name: "Diet Coke (New)", price: 75 }
      : item),
  }));
  assert.deepEqual(loungeOrderLines(cart, renamedAndRepriced)[0], {
    id: "diet-coke", name: "Diet Coke (New)", qty: 2, price: 75, lineTotal: 150,
  });
});

test("invalid quantities cannot enter Q Lounge payable lines", () => {
  for (const quantity of [0, -1, 0.5, 101, NaN, undefined]) {
    assert.deepEqual(loungeOrderLines({ "diet-coke": quantity }, sample), []);
  }
  assert.equal(loungeOrderLines({ "diet-coke": 100 }, sample)[0].lineTotal, 7000);
});

test("V2 Food uses original Cashfree tags and leaves existing operational checkout unmodified", () => {
  const food = readFileSync(new URL("../src/v2-live/V2Food.jsx", import.meta.url), "utf8");
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(food, /readCatalogue\(controller\.signal\)/);
  assert.match(food, /food_items_json: JSON\.stringify\(orderLines\)/);
  assert.match(food, /qclub_payment_context/);
  assert.match(food, /qclub_payment_mobile/);
  assert.match(food, /qclub_food_order_started_at/);
  assert.match(food, /startPayment\(cartTotal, phone, name/);
  assert.match(food, /pattern="\[6-9\]\[0-9\]\{9\}"/);
  assert.match(food, /type="submit" disabled=\{paying \|\| cartTotal <= 0\}/);
  assert.doesNotMatch(food, /to="\/offer"/);
  assert.match(app, /path="\/offer"/); // compatibility route retained
  assert.match(app, /path="\/food" element=\{<V2Food startPayment=\{startPayment\} \/>\}/);
});

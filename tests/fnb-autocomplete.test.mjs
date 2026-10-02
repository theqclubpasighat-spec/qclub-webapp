import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { autocompleteKeyAction, incrementItemQuantity, rankFnbAutocomplete } from "../src/lib/fnb-autocomplete.js";

const items = [
  { id:"masala-beef", name:"Masala Beef", category:"Beef", selling_price_inr:400, active:true, sell_in_ledger:true, current_stock:5, track_inventory:true },
  { id:"masala-chicken", name:"Masala Chicken", category:"Chicken", selling_price_inr:350, active:true, sell_in_ledger:true },
  { id:"chicken-masala", name:"Chicken Masala", category:"Chicken", selling_price_inr:320, active:true, sell_in_ledger:true },
  { id:"marrow", name:"Beef Bone Marrow", category:"Beef", selling_price_inr:300, active:true, sell_in_ledger:true },
  { id:"tenderloin", name:"Tenderloin Fry", category:"Beef", selling_price_inr:450, active:true, sell_in_ledger:true },
  { id:"inactive", name:"Masala Hidden", category:"Beef", selling_price_inr:100, active:false, sell_in_ledger:true },
  { id:"hidden", name:"Masala Staff Only", category:"Beef", selling_price_inr:100, active:true, sell_in_ledger:false },
  { id:"unpriced", name:"Masala Unpriced", category:"Beef", selling_price_inr:null, active:true, sell_in_ledger:true, is_unpriced:true },
  { id:"sold-out", name:"Masala Sold Out", category:"Beef", selling_price_inr:250, active:true, sell_in_ledger:true, track_inventory:true, current_stock:0 },
];

test("prefix matches rank before word-prefix and search is case-insensitive", () => {
  const result = rankFnbAutocomplete(items, "MA", 10);
  assert.deepEqual(result.slice(0, 3).map((x) => x.id), ["masala-beef", "masala-chicken", "chicken-masala"]);
});

test("word-prefix finds Beef Bone Marrow from mar", () => {
  const result = rankFnbAutocomplete(items, "mar", 10);
  assert.equal(result[0].id, "marrow");
});

test("contains match works when no earlier rank applies", () => {
  const result = rankFnbAutocomplete(items, "sala", 10);
  assert.deepEqual(result.map((x) => x.id), ["masala-beef", "chicken-masala", "masala-chicken"]);
});

test("category match is available across categories", () => {
  const result = rankFnbAutocomplete(items, "beef", 10);
  assert.ok(result.some((x) => x.id === "tenderloin"));
});

test("inactive, hidden, unpriced and out-of-stock items are excluded", () => {
  const result = rankFnbAutocomplete(items, "masala", 20).map((x) => x.id);
  assert.equal(result.includes("inactive"), false);
  assert.equal(result.includes("hidden"), false);
  assert.equal(result.includes("unpriced"), false);
  assert.equal(result.includes("sold-out"), false);
});

test("results are limited for fast POS display", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({
    id:"item-"+i, name:"Masala "+i, category:"Food", selling_price_inr:100+i, active:true, sell_in_ledger:true
  }));
  assert.equal(rankFnbAutocomplete(many, "m", 10).length, 10);
});

test("selecting the same item increments quantity instead of duplicating a line", () => {
  const first = incrementItemQuantity({}, "masala-beef");
  const second = incrementItemQuantity(first, "masala-beef");
  assert.deepEqual(second, { "masala-beef": 2 });
});

test("keyboard navigation supports arrows, enter and escape", () => {
  assert.deepEqual(autocompleteKeyAction("ArrowDown", -1, 3), { type:"MOVE", index:0 });
  assert.deepEqual(autocompleteKeyAction("ArrowDown", 0, 3), { type:"MOVE", index:1 });
  assert.deepEqual(autocompleteKeyAction("ArrowUp", 1, 3), { type:"MOVE", index:0 });
  assert.deepEqual(autocompleteKeyAction("Enter", 1, 3), { type:"SELECT", index:1 });
  assert.deepEqual(autocompleteKeyAction("Escape", 1, 3), { type:"CLOSE", index:-1 });
});

test("QclubLedger wires keyboard and touch selection to the same autocomplete selection function", () => {
  const source = fs.readFileSync(new URL("../src/components/qclub-ledger-page.jsx", import.meta.url), "utf8");
  assert.match(source, /onKeyDown=\{handleFnbSearchKeyDown\}/);
  assert.match(source, /onClick=\{function\(\) \{ selectFnbAutocompleteItem\(item\); \}\}/);
  assert.match(source, /requestAnimationFrame/);
  assert.match(source, /setFnbSearch\(""\)/);
});

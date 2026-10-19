// CI-only simulated Q Lounge customer journey; never accesses production APIs or Cashfree.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";

if (process.env.QCLUB_BROWSER_FIXTURES !== "enabled" ||
    !process.env.QCLUB_AGENT_BROWSER ||
    process.env.VERCEL_ENV === "production") {
  throw Error("Explicit synthetic browser configuration required");
}

const root = await mkdtemp(path.resolve(".qclub-food-fixture-"));
const artifacts = path.resolve("browser-artifacts");
await mkdir(artifacts, { recursive: true });
await writeFile(path.join(root, "index.html"),
  '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module" src="/main.jsx"></script></body></html>');
await writeFile(path.join(root, "main.jsx"), [
  'import React from "react";',
  'import {createRoot} from "react-dom/client";',
  'import {BrowserRouter} from "react-router-dom";',
  'import V2Food from "../src/v2-live/V2Food.jsx";',
  'import "../src/styles.css";',
  'import "../src/v2-live/v2-live.css";',
  'window.__qloungeErrors=[];window.__qloungePayments=[];',
  'addEventListener("error",e=>window.__qloungeErrors.push(e.message));',
  'addEventListener("unhandledrejection",e=>window.__qloungeErrors.push(String(e.reason)));',
  'function mockedStartPayment(amount,phone,name,tags){window.__qloungePayments.push({amount,phone,name,tags});}',
  'createRoot(document.getElementById("root")).render(<BrowserRouter><V2Food startPayment={mockedStartPayment}/></BrowserRouter>);',
].join("\n"));

const menu = { ok: true, source: "qclub_fnb_master", menuCatalog: {
  drinks: { title: "Beverages", items: [
    { id: "coke", name: "Diet Coke", price: 70, inStock: true, onlineOrderEnabled: true, image: "" },
    { id: "offline", name: "At counter only", price: 110, inStock: true, onlineOrderEnabled: false, image: "" },
    { id: "gone", name: "Sold out", price: 90, inStock: false, onlineOrderEnabled: true, image: "" },
  ]},
  momo: { title: "Momo", items: [
    { id: "momo", name: "Chicken Momo", price: 201, inStock: true, onlineOrderEnabled: true, image: "" },
  ]},
}};
const server = await createServer({
  configFile: false,
  root,
  server: { host: "127.0.0.1", port: 5190, strictPort: true, fs: { allow: [process.cwd()] } },
  esbuild: { jsx: "transform", jsxFactory: "React.createElement", jsxFragment: "React.Fragment" },
  plugins: [{ name: "synthetic-q-lounge-menu", configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      if (req.url?.split("?")[0] !== "/api/snooker/v1/public-catalogue") return next();
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify(menu));
    });
  }}],
});
const run = promisify(execFile);
const session = "qclub-qlounge-direct-" + process.pid;
async function browser(...args) {
  const { stdout } = await run(process.env.QCLUB_AGENT_BROWSER,
    ["--session", session, "--allowed-domains", "127.0.0.1", "--json", ...args],
    { timeout: 45000, maxBuffer: 2 * 1024 * 1024 });
  const parsed = JSON.parse(stdout);
  if (!parsed.success) throw Error(JSON.stringify(parsed));
  return parsed.data;
}
async function evaluate(script) { return (await browser("eval", script)).result; }
try {
  await server.listen();
  await browser("open", "http://127.0.0.1:5190/food");
  await browser("wait", ".v2-live-product-card");
  for (const width of [360, 390, 430, 1280]) {
    await browser("set", "viewport", String(width), "800");
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true,
      "Q Lounge overflow at width " + width);
    await browser("screenshot", path.join(artifacts, "qlounge-direct-" + width + ".png"), "--full");
  }
  assert.equal(await evaluate('document.querySelector("a[href=\\\"/offer\\\"]")===null'), true,
    "Q Lounge must not force a second ordering page");
  assert.equal(await evaluate('document.querySelectorAll(".v2-live-product-card").length'), 4);
  assert.equal(await evaluate('document.querySelectorAll(".v2-live-product-actions").length'), 2,
    "Only online-orderable items receive Add actions");
  await browser("set", "viewport", "390", "800");
  const coke = ".v2-live-product-card:first-child .v2-live-product-actions .v2-live-primary";
  await browser("click", coke);
  await browser("click", coke);
  await browser("click", ".v2-live-floating-cart");
  assert.equal(await evaluate('document.querySelector(".v2-live-cart-total").textContent.includes("140")'), true);
  await browser("fill", "#v2-food-name", "Q Lounge Browser Fixture");
  await browser("fill", "#v2-food-phone", "9876543210");
  await browser("click", '.v2-live-checkout button[type="submit"]');
  await browser("wait", "200");
  const payments = await evaluate("window.__qloungePayments");
  assert.equal(payments.length, 1, "One click should invoke one checkout");
  assert.equal(payments[0].amount, 140);
  assert.equal(payments[0].name, "Q Lounge Browser Fixture");
  assert.equal(payments[0].phone, "9876543210");
  assert.equal(payments[0].tags.context, "food");
  assert.deepEqual(JSON.parse(payments[0].tags.food_items_json), [
    { id: "coke", name: "Diet Coke", qty: 2, price: 70, lineTotal: 140 },
  ]);
  assert.deepEqual(await evaluate("window.__qloungeErrors"), []);
  await writeFile(path.join(artifacts, "qlounge-direct-order-result.json"), JSON.stringify({
    passed: true, synthetic: true, widths: [360, 390, 430, 1280],
    cartItems: 2, amount: 140, paymentFunctionCalls: 1,
    verified: ["no duplicate /offer navigation", "stock and online availability", "add", "cart",
      "customer name", "WhatsApp number", "existing payment callback and tags", "responsive widths"],
  }, null, 2));
  console.log("Q Lounge direct-order mobile/browser synthetic verification passed.");
} catch (error) {
  try { await browser("screenshot", path.join(artifacts, "qlounge-direct-failure.png"), "--full"); } catch {}
  throw error;
} finally {
  try { await browser("close"); } finally { await server.close(); await rm(root, { recursive: true, force: true }); }
}

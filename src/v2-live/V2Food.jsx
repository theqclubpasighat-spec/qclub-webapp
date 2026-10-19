import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { readCatalogue } from "../v2-preview/catalogue.mjs";

// The checkout still uses the existing production Cashfree path in App.jsx.
// This component only collects current catalogue items and the customer's order.
const money = (amount) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(amount || 0));

export function canOrderLoungeItem(item) {
  return Boolean(item && item.inStock !== false && item.onlineOrderEnabled !== false);
}

export function loungeOrderLines(cart, categories) {
  const catalog = new Map(
    categories.flatMap((category) => category.items.map((item) => [item.id, item]))
  );
  return Object.entries(cart)
    .map(([id, qty]) => ({ item: catalog.get(id), qty: Number(qty) }))
    .filter(({ item, qty }) => item && canOrderLoungeItem(item) && Number.isInteger(qty) && qty > 0)
    .map(({ item, qty }) => ({
      id: item.id,
      name: item.name,
      qty,
      price: Number(item.price),
      lineTotal: Number(item.price) * qty,
    }));
}

function ItemImage({ item, className = "" }) {
  const [failed, setFailed] = useState(false);
  if (!item.image || failed) {
    return <span className={"v2-live-image-placeholder " + className} aria-hidden="true">Q</span>;
  }
  return (
    <img
      className={className}
      src={item.image}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

function ItemDetails({ item, orderable, onAdd, onClose }) {
  const dialog = useRef(null);
  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);
  return (
    <dialog
      className="v2-live-dialog"
      ref={dialog}
      aria-labelledby="v2-live-item-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) dialog.current?.close();
      }}
    >
      <div className="v2-live-dialog-inner">
        <button className="v2-live-button v2-live-dialog-close" type="button" autoFocus onClick={() => dialog.current?.close()}>
          Close
        </button>
        <ItemImage item={item} className="v2-live-detail-image" />
        <h2 id="v2-live-item-title">{item.name}</h2>
        <p className="v2-live-price">{money(item.price)}</p>
        {item.description ? <p>{item.description}</p> : null}
        <p className="v2-live-muted">
          {item.inStock === false
            ? "Currently out of stock"
            : item.onlineOrderEnabled === false
            ? "Available at the club, not for online ordering"
            : "Available to order from Q Lounge"}
        </p>
        {orderable ? (
          <button
            className="v2-live-button v2-live-primary"
            type="button"
            onClick={() => {
              onAdd(item);
              dialog.current?.close();
            }}
          >
            + Add to order
          </button>
        ) : null}
      </div>
    </dialog>
  );
}

export default function V2Food({ startPayment }) {
  const [categories, setCategories] = useState([]);
  const [status, setStatus] = useState("loading");
  const [retry, setRetry] = useState(0);
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [cart, setCart] = useState({});
  const [showCart, setShowCart] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [paying, setPaying] = useState(false);
  const cartRef = useRef(null);
  const paymentLock = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setStatus("loading");
    const timeout = setTimeout(() => controller.abort(), 12000);
    readCatalogue(controller.signal)
      .then((rows) => {
        if (!active) return;
        setCategories(rows);
        setStatus("ready");
      })
      .catch(() => {
        if (!active) return;
        setCategories([]);
        setStatus("error");
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [retry]);

  useEffect(() => {
    if (showCart) cartRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [showCart]);

  const query = search.trim().toLocaleLowerCase();
  const items = categories
    .filter((row) => category === "all" || row.id === category)
    .flatMap((row) => row.items.map((item) => ({ ...item, categoryTitle: row.title })))
    .filter((item) =>
      (item.name + " " + (item.description || "")).toLocaleLowerCase().includes(query)
    );

  // Build every payable line from the live master catalogue, never cached browser prices.
  const orderLines = status === "ready" ? loungeOrderLines(cart, categories) : [];
  const cartTotal = orderLines.reduce((sum, item) => sum + item.lineTotal, 0);
  const cartCount = orderLines.reduce((sum, item) => sum + item.qty, 0);

  function addToCart(item) {
    if (status !== "ready" || !canOrderLoungeItem(item)) return;
    setCart((previous) => ({
      ...previous,
      [item.id]: Math.min(100, Number(previous[item.id] || 0) + 1),
    }));
  }

  function removeFromCart(item) {
    setCart((previous) => ({
      ...previous,
      [item.id]: Math.max(0, Number(previous[item.id] || 0) - 1),
    }));
  }

  async function payForOrder(event) {
    event.preventDefault();
    if (paymentLock.current || status !== "ready" || cartTotal <= 0 || !orderLines.length) return;
    const name = customerName.trim();
    const phone = customerPhone.replace(/\D/g, "");
    if (!name) return alert("Please enter your name.");
    if (!/^[6-9][0-9]{9}$/.test(phone)) {
      return alert("Please enter a valid 10-digit WhatsApp number.");
    }
    if (typeof startPayment !== "function") return alert("Payment is temporarily unavailable.");

    // Keep identical tags/storage expected by the existing Cashfree + receipt
    // + WhatsApp + staff/PrintBridge workflow. Do not create a second checkout.
    const foodItems = orderLines
      .map((item, index) => (index + 1) + ". " + item.name + " x " + item.qty)
      .join("\n");
    localStorage.setItem("qclub_payment_context", "food");
    localStorage.setItem("qclub_payment_name", name);
    localStorage.setItem("qclub_payment_mobile", phone);
    localStorage.setItem("qclub_food_cart", JSON.stringify(orderLines));
    localStorage.setItem("qclub_food_total", String(cartTotal));
    localStorage.setItem("qclub_food_order_started_at", new Date().toISOString());

    paymentLock.current = true;
    setPaying(true);
    try {
      await startPayment(cartTotal, phone, name, {
        context: "food",
        customer_name: name,
        mobile: phone,
        food_items: foodItems || "Food items",
        food_items_json: JSON.stringify(orderLines),
        food_total: String(cartTotal),
      });
    } finally {
      // If Cashfree doesn't redirect (for example cancelled checkout),
      // allow the customer to try again without creating a second UI flow.
      paymentLock.current = false;
      setPaying(false);
    }
  }

  return (
    <main className="v2-live-section v2-live-food" id="main-content">
      <div className="v2-live-page-heading">
        <div>
          <p className="v2-live-eyebrow">A break between frames</p>
          <h1>Q Lounge</h1>
          <p className="v2-live-muted">Choose food and drinks, add them to your cart and pay right here.</p>
        </div>
        <div className="v2-live-inline-actions">
          {cartCount > 0 ? (
            <button className="v2-live-button v2-live-primary" type="button" onClick={() => setShowCart(true)}>
              View Cart ({cartCount})
            </button>
          ) : null}
          <Link className="v2-live-button" to="/">Home</Link>
        </div>
      </div>

      {status === "loading" ? <p role="status" className="v2-live-state">Loading the club menu…</p> : null}
      {status === "error" ? (
        <div role="alert" className="v2-live-state">
          <p>The live menu could not load. Online ordering is unavailable until prices and stock can be verified.</p>
          <button className="v2-live-button" type="button" onClick={() => setRetry((value) => value + 1)}>
            Retry menu
          </button>
        </div>
      ) : null}

      {status === "ready" ? (
        <>
          <label className="v2-live-search-label" htmlFor="v2-live-menu-search">Search the menu</label>
          <input
            id="v2-live-menu-search"
            className="v2-live-search"
            type="search"
            placeholder="Search food or drinks"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          <div className="v2-live-category-list" role="group" aria-label="Menu categories">
            <button className="v2-live-chip" type="button" aria-pressed={category === "all"} onClick={() => setCategory("all")}>
              All
            </button>
            {categories.map((row) => (
              <button key={row.id} className="v2-live-chip" type="button" aria-pressed={category === row.id} onClick={() => setCategory(row.id)}>
                {row.title}
              </button>
            ))}
          </div>

          <p role="status" className="v2-live-result-count">
            {items.length} {items.length === 1 ? "item" : "items"}
          </p>

          {showCart && cartCount > 0 ? (
            <section ref={cartRef} className="v2-live-cart" aria-label="Your Q Lounge order">
              <div className="v2-live-cart-heading">
                <h2>Your Cart · {cartCount} {cartCount === 1 ? "item" : "items"}</h2>
                <button className="v2-live-button" type="button" onClick={() => setShowCart(false)}>Continue Browsing</button>
              </div>
              {orderLines.map((line) => (
                <div className="v2-live-cart-row" key={line.id}>
                  <span>{line.name}</span>
                  <div className="v2-live-qty" aria-label={"Quantity for " + line.name}>
                    <button type="button" onClick={() => removeFromCart(line)} aria-label={"Remove one " + line.name}>−</button>
                    <strong>{line.qty}</strong>
                    <button type="button" onClick={() => addToCart(line)} disabled={line.qty >= 100} aria-label={"Add one " + line.name}>+</button>
                  </div>
                  <strong>{money(line.lineTotal)}</strong>
                </div>
              ))}
              <div className="v2-live-cart-total"><strong>Total</strong><strong>{money(cartTotal)}</strong></div>
              <form className="v2-live-checkout" onSubmit={payForOrder}>
                <label htmlFor="v2-food-name">Your name</label>
                <input
                  id="v2-food-name"
                  className="v2-live-search"
                  value={customerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                  autoComplete="name"
                  required
                  maxLength={100}
                />
                <label htmlFor="v2-food-phone">WhatsApp number</label>
                <input
                  id="v2-food-phone"
                  className="v2-live-search"
                  type="tel"
                  value={customerPhone}
                  onChange={(event) => setCustomerPhone(event.target.value)}
                  autoComplete="tel-national"
                  inputMode="tel"
                  pattern="[6-9][0-9]{9}"
                  title="10-digit Indian WhatsApp number"
                  required
                  placeholder="10-digit WhatsApp number"
                />
                <button className="v2-live-button v2-live-primary" type="submit" disabled={paying || cartTotal <= 0}>
                  {paying ? "Starting payment…" : "Pay " + money(cartTotal)}
                </button>
                <p className="v2-live-muted">Online payment is handled by the club's existing secure checkout. Payable items, prices and availability come from the current master menu.</p>
              </form>
            </section>
          ) : null}

          <div className="v2-live-product-grid">
            {items.map((item) => {
              const orderable = canOrderLoungeItem(item);
              const qty = Number(cart[item.id] || 0);
              return (
                <article className="v2-live-product-card" key={item.id}>
                  <button
                    className="v2-live-product-open"
                    type="button"
                    onClick={() => setSelected(item)}
                    aria-label={"View " + item.name + ", " + money(item.price)}
                  >
                    <ItemImage item={item} />
                    <span className="v2-live-product-content">
                      <span className="v2-live-product-name">{item.name}</span>
                      <span className="v2-live-price">{money(item.price)}</span>
                      <span className="v2-live-availability">
                        {item.inStock === false
                          ? "Out of stock"
                          : item.onlineOrderEnabled === false
                          ? "At the club"
                          : item.categoryTitle}
                      </span>
                    </span>
                  </button>
                  {orderable ? (
                    <div className="v2-live-product-actions">
                      {qty > 0 ? (
                        <button className="v2-live-qty-remove" type="button" onClick={() => removeFromCart(item)} aria-label={"Remove one " + item.name}>−</button>
                      ) : null}
                      {qty > 0 ? <strong className="v2-live-qty-count" aria-label={"Quantity " + qty}>{qty}</strong> : null}
                      <button className="v2-live-button v2-live-primary" type="button" disabled={qty >= 100} onClick={() => addToCart(item)}>
                        + Add
                      </button>
                    </div>
                  ) : (
                    <p className="v2-live-availability v2-live-product-unavailable">
                      {item.inStock === false ? "Currently out of stock" : "Order at the counter"}
                    </p>
                  )}
                </article>
              );
            })}
          </div>

          {!items.length ? (
            <p className="v2-live-state">
              {categories.length ? "No matching items. Try another search or category." : "No menu items are listed yet."}
            </p>
          ) : null}
        </>
      ) : null}

      {selected ? (
        <ItemDetails
          item={selected}
          orderable={status === "ready" && canOrderLoungeItem(selected)}
          onAdd={addToCart}
          onClose={() => setSelected(null)}
        />
      ) : null}

      {status === "ready" && cartCount > 0 && !showCart ? (
        <button className="v2-live-floating-cart" type="button" onClick={() => setShowCart(true)}>
          <span>{cartCount} {cartCount === 1 ? "item" : "items"} · {money(cartTotal)}</span>
          <strong>View Cart →</strong>
        </button>
      ) : null}
    </main>
  );
}

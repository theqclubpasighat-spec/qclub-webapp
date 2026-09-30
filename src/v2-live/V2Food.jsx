import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { readCatalogue } from "../v2-preview/catalogue.mjs";

const money = (amount) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(amount || 0));

function ItemImage({ item, className = "" }) {
  const [failed, setFailed] = useState(false);
  if (!item.image || failed) {
    return <span className={`v2-live-image-placeholder ${className}`} aria-hidden="true">Q</span>;
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

function ItemDetails({ item, onClose }) {
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
        <button className="v2-live-button v2-live-dialog-close" autoFocus onClick={() => dialog.current?.close()}>
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
            ? "Available at the club"
            : "Listed on the club menu"}
        </p>
      </div>
    </dialog>
  );
}

export default function V2Food() {
  const [categories, setCategories] = useState([]);
  const [status, setStatus] = useState("loading");
  const [retry, setRetry] = useState(0);
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);

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

  const query = search.trim().toLocaleLowerCase();
  const items = categories
    .filter((row) => category === "all" || row.id === category)
    .flatMap((row) => row.items.map((item) => ({ ...item, categoryTitle: row.title })))
    .filter((item) =>
      `${item.name} ${item.description || ""}`.toLocaleLowerCase().includes(query)
    );

  return (
    <main className="v2-live-section v2-live-food" id="main-content">
      <div className="v2-live-page-heading">
        <div>
          <p className="v2-live-eyebrow">A break between frames</p>
          <h1>Q Lounge</h1>
          <p className="v2-live-muted">Food & refreshments from the club’s shared catalogue.</p>
        </div>
        <Link className="v2-live-button" to="/">Home</Link>
      </div>

      {status === "loading" ? <p role="status" className="v2-live-state">Loading the club menu…</p> : null}
      {status === "error" ? (
        <div role="alert" className="v2-live-state">
          <p>The menu could not load.</p>
          <button className="v2-live-button" onClick={() => setRetry((value) => value + 1)}>
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
            <button
              className="v2-live-chip"
              aria-pressed={category === "all"}
              onClick={() => setCategory("all")}
            >
              All
            </button>
            {categories.map((row) => (
              <button
                key={row.id}
                className="v2-live-chip"
                aria-pressed={category === row.id}
                onClick={() => setCategory(row.id)}
              >
                {row.title}
              </button>
            ))}
          </div>

          <p role="status" className="v2-live-result-count">
            {items.length} {items.length === 1 ? "item" : "items"}
          </p>

          <div className="v2-live-product-grid">
            {items.map((item) => (
              <button
                key={item.id}
                className="v2-live-product-card"
                onClick={() => setSelected(item)}
                aria-label={`View ${item.name}, ${money(item.price)}`}
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
            ))}
          </div>

          {!items.length ? (
            <p className="v2-live-state">
              {categories.length ? "No matching items. Try another search or category." : "No menu items are listed yet."}
            </p>
          ) : null}
        </>
      ) : null}

      {selected ? <ItemDetails item={selected} onClose={() => setSelected(null)} /> : null}
    </main>
  );
}

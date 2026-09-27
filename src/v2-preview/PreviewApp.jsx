import React, { useEffect, useRef, useState } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { readCatalogue } from "./catalogue.mjs";

// Adapted from QclubV2 HomePage/PublicLayout/Header: felt, brass, serif titles,
// cue-sport artwork and public cards. Production services remain authoritative.
const live = "https://www.theqclubpasighat.com";
const money = amount => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(amount);

function Header() {
  const [expanded, setExpanded] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => { setExpanded(false); window.scrollTo(0, 0); }, [pathname]);
  return <header className="v2-header">
    <div className="v2-header-row">
      <Link to="/" className="v2-brand" aria-label="The Q Club home"><span className="v2-mark" aria-hidden="true">Q</span><span>The Q Club<small>Pasighat · Play. Chill. Compete.</small></span></Link>
      <button className="v2-button v2-menu-toggle" aria-expanded={expanded} aria-controls="v2-navigation" onClick={() => setExpanded(!expanded)}>{expanded ? "Close" : "Menu"}</button>
    </div>
    <nav id="v2-navigation" className={`v2-navigation ${expanded ? "is-open" : ""}`} aria-label="Main navigation">
      <NavLink to="/" end>Home</NavLink><NavLink to="/food">Q Lounge</NavLink>
      <a href={`${live}/shop`}>Q Shop ↗</a><a href={`${live}/book`}>Book a table ↗</a><a href={`${live}/membership`}>Membership ↗</a>
    </nav>
  </header>;
}

function Home() {
  return <>
    <section className="v2-hero">
      <svg className="v2-rack" viewBox="0 0 220 190" aria-hidden="true"><path d="M110 14 L204 176 H16 Z"/>{[[110,44],[94,72],[126,72],[78,100],[110,100],[142,100],[62,128],[94,128],[126,128],[158,128]].map(([x,y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="13"/>)}</svg>
      <p className="v2-eyebrow">Cue sports & social club</p>
      <h1>The Q Club</h1><p className="v2-tagline">Play. Chill. Compete.</p>
      <p className="v2-intro">Your next frame. Your favourite people.<br/>Snooker, pool and good company in Pasighat.</p>
      <div className="v2-actions"><a className="v2-button v2-primary" href={`${live}/book`}>Book a table ↗</a><Link className="v2-button" to="/food">Explore Q Lounge</Link></div>
    </section>
    <section className="v2-section" aria-labelledby="v2-explore">
      <p className="v2-eyebrow">Make yourself at home</p><h2 id="v2-explore">More than a game</h2>
      <div className="v2-feature-grid">
        <a className="v2-feature-card" href={`${live}/book`}><span aria-hidden="true">◉</span><h3>Find your table</h3><p>Full-size snooker, mini snooker and American pool.</p><strong>Book on the live site ↗</strong></a>
        <Link className="v2-feature-card" to="/food"><span aria-hidden="true">☕</span><h3>The Q Lounge</h3><p>Browse food and refreshments from our shared club menu.</p><strong>Explore the menu →</strong></Link>
        <a className="v2-feature-card" href={`${live}/shop`}><span aria-hidden="true">◇</span><h3>The Q Shop</h3><p>Explore the club shop and its current collection.</p><strong>Visit the live shop ↗</strong></a>
        <a className="v2-feature-card" href={`${live}/membership`}><span aria-hidden="true">✦</span><h3>Make it your club</h3><p>View membership options and their benefits.</p><strong>View memberships ↗</strong></a>
      </div>
    </section>
  </>;
}

function ItemImage({ item, className = "" }) {
  const [failed, setFailed] = useState(false);
  return item.image && !failed ? <img className={className} src={item.image} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} /> : <span className={`v2-image-placeholder ${className}`} aria-hidden="true">Q</span>;
}

function ItemDetails({ item, onClose }) {
  const dialog = useRef(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element.open) element.showModal();
    // Unmount removes the dialog. Calling close in effect cleanup would fire
    // onClose during React StrictMode's development effect replay.
  }, []);
  return <dialog className="v2-dialog" ref={dialog} aria-labelledby="v2-item-title" onClose={onClose} onClick={event => { if (event.target === event.currentTarget) dialog.current.close(); }}>
    <div className="v2-dialog-inner">
      <button className="v2-button v2-dialog-close" autoFocus onClick={() => dialog.current.close()}>Close</button>
      <ItemImage item={item} className="v2-detail-image"/>
      <h2 id="v2-item-title">{item.name}</h2><p className="v2-price">{money(item.price)}</p>
      {item.description ? <p>{item.description}</p> : null}
      <p>{item.inStock === false ? "Currently out of stock" : item.onlineOrderEnabled === false ? "Available at the club" : "Listed on the club menu"}</p>
      <p className="v2-muted">This preview lets you browse. Orders and payments remain on the current website.</p>
    </div>
  </dialog>;
}

function Food() {
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
    readCatalogue(controller.signal).then(rows => {
      if (active) { setCategories(rows); setStatus("ready"); }
    }).catch(() => { if (active) { setCategories([]); setStatus("error"); } })
      .finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [retry]);
  const query = search.trim().toLocaleLowerCase();
  const items = categories.filter(row => category === "all" || row.id === category)
    .flatMap(row => row.items.map(item => ({ ...item, categoryTitle: row.title })))
    .filter(item => `${item.name} ${item.description || ""}`.toLocaleLowerCase().includes(query));
  return <section className="v2-section v2-food" aria-labelledby="v2-food-title">
    <p className="v2-eyebrow">A little break between frames</p><h1 id="v2-food-title">The Q Lounge</h1>
    <p className="v2-muted">Food & refreshments. Tap an item to take a closer look.</p>
    {status === "loading" ? <p role="status" className="v2-state">Loading the club menu…</p> : null}
    {status === "error" ? <div role="alert" className="v2-state"><p>The menu could not load. Please try again.</p><button className="v2-button" onClick={() => setRetry(value => value + 1)}>Retry menu</button></div> : null}
    {status === "ready" ? <>
      <label className="v2-search-label" htmlFor="v2-menu-search">Find something you like</label>
      <input id="v2-menu-search" className="v2-search" type="search" placeholder="Search food or drinks" value={search} onChange={event => setSearch(event.target.value)} />
      <div className="v2-category-list" role="group" aria-label="Menu categories">
        <button className="v2-chip" aria-pressed={category === "all"} onClick={() => setCategory("all")}>All</button>
        {categories.map(row => <button key={row.id} className="v2-chip" aria-pressed={category === row.id} onClick={() => setCategory(row.id)}>{row.title}</button>)}
      </div>
      <p role="status" className="v2-result-count">{items.length} {items.length === 1 ? "item" : "items"}</p>
      <div className="v2-product-grid">{items.map(item => <button key={item.id} className="v2-product-card" onClick={() => setSelected(item)} aria-label={`View ${item.name}, ${money(item.price)}`}>
        <ItemImage item={item}/><span className="v2-product-content"><span className="v2-product-name">{item.name}</span><span className="v2-price">{money(item.price)}</span><span className="v2-availability">{item.inStock === false ? "Out of stock" : item.onlineOrderEnabled === false ? "At the club" : item.categoryTitle}</span></span>
      </button>)}</div>
      {!items.length ? <p className="v2-state">{categories.length ? "No matching items. Try another search or category." : "The club has not listed any menu items yet."}</p> : null}
    </> : null}
    {selected ? <ItemDetails item={selected} onClose={() => setSelected(null)}/> : null}
  </section>;
}

function LayoutReview() {
  const [width, setWidth] = useState("390");
  const [page, setPage] = useState("food");
  return <div className="qclub-v2 v2-review">
    <h1>Phone layout review</h1>
    <p>Review the preview at phone widths. Actual device and payment testing remain separate.</p>
    <div className="v2-review-controls">
      <label>Phone width <select value={width} onChange={event => setWidth(event.target.value)}>{[320,360,390,430].map(value => <option key={value} value={value}>{value} px</option>)}</select></label>
      <label>Page <select value={page} onChange={event => setPage(event.target.value)}><option value="">Home</option><option value="food">Q Lounge</option></select></label>
      <Link to="/">Full preview</Link>
    </div>
    <iframe title="Phone preview" src={`/__v2-preview/${page}`} style={{ width: `${width}px` }} className="v2-phone-frame" />
  </div>;
}

export default function PreviewApp() {
  const location = useLocation();
  if (location.pathname === "/review") return <LayoutReview/>;
  return <div className="qclub-v2">
    <a className="v2-skip" href="#v2-main">Skip to content</a>
    <aside className="v2-preview-note">Design preview · Browsing only. <a href={live}>Open current website ↗</a></aside>
    <Header/>
    <main id="v2-main"><Routes><Route path="/" element={<Home/>}/><Route path="/food" element={<Food/>}/><Route path="*" element={<section className="v2-section"><h1>Page not in this preview</h1><Link to="/">Back to preview home</Link></section>}/></Routes></main>
    <footer className="v2-footer"><strong>The Q Club · Pasighat</strong><p>Play. Chill. Compete.</p><a href={live}>Return to the current website ↗</a></footer>
  </div>;
}

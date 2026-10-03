import React, { useEffect, useRef, useState } from "react";
import { createAdminClient, changesBetween, messageFor, sections } from "./client.mjs";
import "../admin-preview/style.css";
import Notices from "../admin-preview/Notices.jsx";
import StaffOperationsPanel from "../admin-preview/StaffOperationsPanel.jsx";
import {
  FeatureFlagsEditor,
  HeroSlidesEditor,
  MembershipEditor,
  NotificationTemplatesEditor,
  RateEditor,
  ReportsAuditOverview,
  RoleToolsOverview,
  SettingsOverview,
  ShopEditor,
  ThemeEditor,
} from "../admin-preview/CatalogueEditors.jsx";

const client = createAdminClient();

function initialTabForPath(pathname = "") {
  const noticesTab = sections.length;
  const membershipsTab = noticesTab + 1;
  const ratesTab = noticesTab + 2;
  const shopTab = noticesTab + 3;
  const heroTab = noticesTab + 4;
  const themeTab = noticesTab + 5;
  const templatesTab = noticesTab + 6;
  const flagsTab = noticesTab + 7;
  const settingsTab = noticesTab + 8;
  const reportsTab = noticesTab + 9;
  const rolesTab = noticesTab + 10;
  const staffOpsTab = noticesTab + 11;
  const path = String(pathname || "").replace(/\/+$/, "") || "/admin";
  const map = {
    "/admin/club-details": 0,
    "/admin/documents": 1,
    "/admin/membership-tiers": membershipsTab,
    "/admin/rates": ratesTab,
    "/admin/notices": noticesTab,
    "/admin/shop": shopTab,
    "/admin/media": heroTab,
    "/admin/theme": themeTab,
    "/admin/templates": templatesTab,
    "/admin/feature-flags": flagsTab,
    "/admin/settings": settingsTab,
    "/admin/data-tools": reportsTab,
    "/admin/audit-log": reportsTab,
    "/admin/reports": reportsTab,
    "/admin/food-menu": rolesTab,
    "/staff-shifts": staffOpsTab,
    "/expense": staffOpsTab,
    "/staff-attendance": staffOpsTab,
  };
  return map[path] ?? 0;
}

export default function AdminLivePage() {
  const [actor, setActor] = useState(null);
  const [pin, setPin] = useState("");
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [tab, setTab] = useState(() => initialTabForPath(globalThis.location?.pathname || ""));
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState(null);
  const lock = useRef(false);
  const dirty = saved && draft && Object.keys(changesBetween(saved.content, draft)).length > 0;

  const noticesTab = sections.length;
  const membershipsTab = noticesTab + 1;
  const ratesTab = noticesTab + 2;
  const shopTab = noticesTab + 3;
  const heroTab = noticesTab + 4;
  const themeTab = noticesTab + 5;
  const templatesTab = noticesTab + 6;
  const flagsTab = noticesTab + 7;
  const settingsTab = noticesTab + 8;
  const reportsTab = noticesTab + 9;
  const rolesTab = noticesTab + 10;

  const roleGroups = [
    { title:"Staff operations", description:"Daily counter, orders, members and stock tools already in production.", items:[
      {label:"QclubLedger",href:"/QclubLedger",note:"Billing, payments, F&B, website operations and daily closing"},
      {label:"Food orders",href:"/admin/orders",note:"Q Lounge orders, printing and delivery workflow"},
      {label:"Food order archive",href:"/admin/orders-archive",note:"Delivered/cancelled order history"},
      {label:"QShop receipts",href:"/shop/successful-order-receipts",note:"Successful QShop receipts and pickup proof"},
      {label:"Member registry",href:"/member-registry",note:"Membership records and member maintenance"},
      {label:"Inventory",href:"/inventory",note:"Existing stock/item screen; F&B stock remains in Ledger catalogue"},
      {label:"Staff walk-ins",href:"/staff-walkins",note:"Counter walk-in booking/entry"},
      {label:"Shifts, attendance & expenses",href:"/staff-shifts",note:"Staff scheduling, clock-in/out and operational expenses"},
    ]},
    { title:"Committee / competition", description:"Player review, match records, tournaments and displays.", items:[
      {label:"Review panel",href:"/review-panel",note:"Classification, review history and committee audit"},
      {label:"Match ledger",href:"/match-ledger",note:"Manual match/performance records"},
      {label:"Players",href:"/players",note:"Existing player profiles"},
      {label:"Tournaments",href:"/tournaments",note:"Tournament management"},
      {label:"Fixtures",href:"/fixtures",note:"Fixtures/results and printing"},
      {label:"Leaderboard",href:"/leaderboard",note:"Tournament standings"},
      {label:"Hall of Fame",href:"/halloffame",note:"Hall of Fame presentation"},
      {label:"Live matches",href:"/live",note:"Current live-match surface"},
    ]},
    { title:"Admin system tools", description:"Sensitive or club-wide administrative destinations.", items:[
      {label:"Admin panel",href:"/admin-panel",note:"Legacy production admin dashboard"},
      {label:"TV mode",href:"/tv",note:"Club/tournament display controls"},
      {label:"Payment status",href:"/payment-status",note:"Payment return/status verification"},
      {label:"Food Print Bridge",href:"/food-print-bridge",note:"Dedicated receipt printing bridge"},
    ]},
  ];

  const reportGroups = [
    { title:"Billing & website operations", description:"Daily closing, CSV exports, bill/payment audit and website-order inbox.", items:[
      {label:"QclubLedger",href:"/QclubLedger"},{label:"Food order archive",href:"/admin/orders-archive"},
    ]},
    { title:"Q Chase", description:"Final-lock game records and monthly player reports.", items:[
      {label:"Q Chase records",href:"/qchase-records"},{label:"Q Chase monthly reports",href:"/qchase-monthly"},
    ]},
    { title:"Kitty", description:"Saved Kitty records, dispute history and monthly summaries.", items:[
      {label:"Kitty records",href:"/kitty-records"},{label:"Kitty monthly reports",href:"/kitty-monthly"},
    ]},
    { title:"Tournament & player review", description:"Committee review history and match-ledger records.", items:[
      {label:"Review panel",href:"/review-panel"},{label:"Match ledger",href:"/match-ledger"},
    ]},
  ];

  const settingsGroups = [
    { title:"Content", description:"Club identity, public pages, policies, contact and notices.", items:[
      {label:"Club information",tab:0},{label:"About & policies",tab:1},{label:"Food page",tab:2},{label:"Booking & membership copy",tab:3},
      {label:"Shop & game pages",tab:4},{label:"Home & footer",tab:5},{label:"Media links",tab:6},{label:"Contact",tab:7},{label:"Notices",tab:noticesTab},
    ]},
    { title:"Commerce", description:"Public products, memberships and table pricing without operational customer records.", items:[
      {label:"Membership tiers",tab:membershipsTab},{label:"Table rates",tab:ratesTab},{label:"QShop catalogue",tab:shopTab},
    ]},
    { title:"Presentation", description:"Homepage media, colours and V2 visibility settings.", items:[
      {label:"Hero slides",tab:heroTab},{label:"Theme",tab:themeTab},{label:"Feature flags",tab:flagsTab},
    ]},
    { title:"Communication", description:"Approved notification template names only; credentials remain server-side.", items:[
      {label:"Notification templates",tab:templatesTab},
    ]},
    { title:"Shared operations", description:"Use the existing production masters instead of duplicate CMS data.", items:[
      {label:"Q Lounge / F&B catalogue in QclubLedger",href:"/QclubLedger"},
    ]},
  ];

  function accept(data) {
    setSaved(data);
    setDraft(structuredClone(data.content));
    setConflict(false);
    setLatest(null);
  }

  async function perform(work) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setNotice("");
    try { await work(); }
    catch (error) {
      if (error?.status === 401) {
        client.forget();
        setActor(null);
        setSaved(null);
        setDraft(null);
      }
      if (error?.status === 409) setConflict(true);
      setNotice(messageFor(error));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const restored = await client.restore();
        if (cancelled || !restored) return;
        setActor(restored);
        if (restored.role === "ADMIN" && restored.staff_id === "admin-main") {
          const data = await client.content();
          if (!cancelled) accept(data);
        }
      } catch (error) {
        if (!cancelled) setNotice(messageFor(error));
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const warn = (event) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function login(event) {
    event.preventDefault();
    const entered = pin;
    setPin("");
    await perform(async () => {
      const user = await client.login(entered);
      setActor(user);
      if (user.role === "ADMIN" && user.staff_id === "admin-main") accept(await client.content());
    });
  }

  async function logout() {
    if (dirty && !window.confirm("Discard your unsaved changes and sign out?")) return;
    await perform(async () => {
      try { await client.logout(); }
      finally {
        setActor(null);
        setSaved(null);
        setDraft(null);
        setConflict(false);
        setLatest(null);
      }
    });
  }

  async function save(event) {
    event.preventDefault();
    const changes = changesBetween(saved.content, draft);
    if (!Object.keys(changes).length || conflict) return;
    await perform(async () => {
      const result = await client.save(saved.updatedAt, changes);
      accept({ content: result.content, updatedAt: result.updatedAt });
      setNotice("Changes saved to the live Q Club website.");
    });
  }

  const current = sections[tab] || sections[0];
  const roleWorkspaceGroups = actor?.role === "STAFF"
    ? [roleGroups[0]]
    : actor?.role === "COMMITTEE"
      ? [roleGroups[1]]
      : [];
  const roleIntro = actor?.role === "STAFF"
    ? "Open the daily operational tools assigned to staff. Website editing remains Main Admin only."
    : actor?.role === "COMMITTEE"
      ? "Open competition and review tools. Website editing remains Main Admin only."
      : "Edit the live website without changing billing, payments or game engines.";

  if (restoring) {
    return <main className="admin-shell"><div className="card"><p>Opening Website Manager…</p></div></main>;
  }

  return <main className="admin-shell">
    <div className="preview-banner">LIVE WEBSITE MANAGER · Changes publish to The Q Club</div>
    <header>
      <div className="brand">Q<span>CLUB</span></div>
      {actor && <button className="quiet" onClick={logout} disabled={busy}>Sign out</button>}
    </header>
    <p className="eyebrow">WEBSITE MANAGER</p>
    <h1>{actor ? (actor.role === "ADMIN" && actor.staff_id === "admin-main" ? "Make it yours." : "Your Q Club tools.") : "Welcome back."}</h1>
    <p className="intro">{actor ? roleIntro : "Sign in with your Q Club PIN."}</p>
    {notice && <div className="notice" role="status">{notice}</div>}

    {!actor ? <form className="card login" onSubmit={login}>
      <label htmlFor="pin">Q Club PIN</label>
      <input id="pin" type="password" autoComplete="current-password" value={pin} maxLength={64} required minLength={4}
        onChange={event => setPin(event.target.value)} disabled={busy}/>
      <button className="primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    </form> : actor.role !== "ADMIN" || actor.staff_id !== "admin-main" ? (
      <RoleToolsOverview groups={roleWorkspaceGroups}/>
    ) : !draft ? (
      <div className="card"><p>Website content could not be loaded.</p><button disabled={busy} onClick={() => perform(async () => accept(await client.content()))}>Retry</button></div>
    ) : <>
      <div className="account"><span className="dot"/>{actor.display_name}<span className="status">{dirty ? "Unsaved changes" : "Up to date"}</span></div>
      <nav aria-label="Content sections">
        {sections.map((section,index)=><button key={`${section.title}-${index}`} aria-pressed={tab===index} onClick={()=>setTab(index)}>{section.title}</button>)}
        <button aria-pressed={tab===noticesTab} onClick={()=>setTab(noticesTab)}>Notices</button>
        <button aria-pressed={tab===membershipsTab} onClick={()=>setTab(membershipsTab)}>Membership tiers</button>
        <button aria-pressed={tab===ratesTab} onClick={()=>setTab(ratesTab)}>Table rates</button>
        <button aria-pressed={tab===shopTab} onClick={()=>setTab(shopTab)}>QShop catalogue</button>
        <button aria-pressed={tab===heroTab} onClick={()=>setTab(heroTab)}>Hero slides</button>
        <button aria-pressed={tab===themeTab} onClick={()=>setTab(themeTab)}>Theme</button>
        <button aria-pressed={tab===templatesTab} onClick={()=>setTab(templatesTab)}>Notification templates</button>
        <button aria-pressed={tab===flagsTab} onClick={()=>setTab(flagsTab)}>Feature flags</button>
        <button aria-pressed={tab===settingsTab} onClick={()=>setTab(settingsTab)}>Settings</button>
        <button aria-pressed={tab===reportsTab} onClick={()=>setTab(reportsTab)}>Reports & audit</button>
        <button aria-pressed={tab===rolesTab} onClick={()=>setTab(rolesTab)}>Role tools</button>
        <button aria-pressed={tab===staffOpsTab} onClick={()=>setTab(staffOpsTab)}>Staff operations</button>
      </nav>

      {conflict && <aside className="card conflict">
        <h2>Review the newer version</h2>
        <p>Your draft is safe. Load the latest saved content before deciding what to replace.</p>
        <button disabled={busy} onClick={()=>perform(async()=>setLatest(await client.content()))}>Load latest for comparison</button>
        {latest && <><div className="comparison">
          {sections.flatMap(section=>section.fields.map(([key,label])=><div key={`${section.title}-${key}`}><strong>{label}</strong><p>{latest.content[section.id]?.[key] || "Empty"}</p></div>))}
          {latest.content.announcements?.map(row=><div key={row.id}><strong>Public notice</strong><p>{row.text}</p><p>{row.link}</p></div>)}
        </div><button disabled={busy} onClick={()=>{if(window.confirm("Replace your unsaved draft with the latest saved content?")) accept(latest);}}>Discard draft and use latest</button></>}
      </aside>}

      <form onSubmit={save}>
        {tab===noticesTab ? <Notices rows={draft.announcements || []} onChange={rows=>setDraft({...draft,announcements:rows})} busy={busy}/>
          : tab===membershipsTab ? <MembershipEditor rows={draft.memberships || []} onChange={rows=>setDraft({...draft,memberships:rows})} busy={busy}/>
          : tab===ratesTab ? <RateEditor rows={draft.bookingTables || []} onChange={rows=>setDraft({...draft,bookingTables:rows})} busy={busy}/>
          : tab===shopTab ? <ShopEditor catalog={draft.shopCatalog || {heading:"",topLabel:"",description:"",badge1:"",badge2:"",items:[]}} onChange={shopCatalog=>setDraft({...draft,shopCatalog})} busy={busy}/>
          : tab===heroTab ? <HeroSlidesEditor slides={draft.club?.heroSlides || []} onChange={heroSlides=>setDraft({...draft,club:{...(draft.club||{}),heroSlides}})} busy={busy}/>
          : tab===themeTab ? <ThemeEditor theme={draft.theme || {}} onChange={theme=>setDraft({...draft,theme})} busy={busy}/>
          : tab===templatesTab ? <NotificationTemplatesEditor templates={draft.notificationTemplates || {}} onChange={notificationTemplates=>setDraft({...draft,notificationTemplates})} busy={busy}/>
          : tab===flagsTab ? <FeatureFlagsEditor flags={draft.featureFlags || {}} onChange={featureFlags=>setDraft({...draft,featureFlags})} busy={busy}/>
          : tab===settingsTab ? <SettingsOverview groups={settingsGroups} onOpen={setTab}/>
          : tab===reportsTab ? <ReportsAuditOverview groups={reportGroups}/>
          : tab===rolesTab ? <RoleToolsOverview groups={roleGroups}/>
          : tab===staffOpsTab ? <StaffOperationsPanel client={client} actor={actor}/>
          : <section className="card">
              <h2>{current.title}</h2>
              {current.fields.map(([key,label,kind])=><div className="field" key={key}>
                <label htmlFor={key}>{label}</label>
                {kind==="textarea"
                  ? <textarea id={key} rows={5} maxLength={30000} value={draft[current.id]?.[key] || ""} disabled={busy}
                      onChange={event=>setDraft({...draft,[current.id]:{...draft[current.id],[key]:event.target.value}})}/>
                  : <input id={key} maxLength={30000} value={draft[current.id]?.[key] || ""} disabled={busy}
                      onChange={event=>setDraft({...draft,[current.id]:{...draft[current.id],[key]:event.target.value}})}/>}
              </div>)}
            </section>}
        <footer>
          <span>{conflict ? "Review required" : dirty ? "Ready when you are" : "All changes saved"}</span>
          <button className="primary" disabled={busy || !dirty || conflict}>{busy ? "Saving…" : "Save changes"}</button>
        </footer>
      </form>
    </>}
  </main>;
}

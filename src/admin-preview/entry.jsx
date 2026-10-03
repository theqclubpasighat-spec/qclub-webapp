import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createAdminClient, changesBetween, messageFor, sections } from './client.mjs';
import './style.css';
import Notices from './Notices.jsx';
import { HeroSlidesEditor, MembershipEditor, RateEditor, ShopEditor } from './CatalogueEditors.jsx';
const client = createAdminClient();
function Admin() {
  const [actor,setActor] = useState(null), [pin,setPin] = useState('');
  const [saved,setSaved] = useState(null), [draft,setDraft] = useState(null);
  const [tab,setTab] = useState(0), [busy,setBusy] = useState(false);
  const [notice,setNotice] = useState(''), [conflict,setConflict] = useState(false);
  const [latest,setLatest] = useState(null);
  const lock = useRef(false);
  const dirty = saved && draft && Object.keys(changesBetween(saved.content,draft)).length > 0;
  useEffect(() => {
    const warn = e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload',warn);
    return () => window.removeEventListener('beforeunload',warn);
  },[dirty]);
  async function perform(work) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setNotice('');
    try { await work(); }
    catch(error) {
      if (error.status === 401) { client.forget(); setActor(null); }
      if (error.status === 409) setConflict(true);
      setNotice(messageFor(error));
    } finally { lock.current = false; setBusy(false); }
  }
  function accept(data) { setSaved(data); setDraft(structuredClone(data.content)); setConflict(false); setLatest(null); }
  async function login(e) {
    e.preventDefault();
    const entered = pin; setPin('');
    await perform(async () => {
      const user = await client.login(entered); setActor(user);
      if (user.role === 'ADMIN') {
        const data = await client.content();
        // Keep a draft after expiry; old revision will still produce a conflict.
        if (!draft) accept(data);
        else setNotice('Signed in again. Your unsaved draft is still here.');
      }
    });
  }
  async function logout() {
    if (dirty && !window.confirm('Discard your unsaved changes and sign out?')) return;
    await perform(async () => {
      try { await client.logout(); }
      finally { setActor(null); setSaved(null); setDraft(null); setConflict(false); setLatest(null); }
    });
  }
  async function save(e) {
    e.preventDefault();
    const changes = changesBetween(saved.content,draft);
    if (!Object.keys(changes).length || conflict) return;
    await perform(async () => {
      const result = await client.save(saved.updatedAt,changes);
      accept({ content: result.content, updatedAt: result.updatedAt });
      setNotice('Changes saved to the rehearsal website.');
    });
  }
  const noticesTab = sections.length;
  const membershipsTab = noticesTab + 1;
  const ratesTab = noticesTab + 2;
  const shopTab = noticesTab + 3;
  const heroTab = noticesTab + 4;
  const current = sections[tab] || sections[0];
  return <main className="admin-shell">
    <div className="preview-banner">PREVIEW · Changes affect rehearsal content only</div>
    <header><div className="brand">Q<span>CLUB</span></div>{actor && <button className="quiet" onClick={logout} disabled={busy}>Sign out</button>}</header>
    <p className="eyebrow">WEBSITE MANAGER</p><h1>{actor ? 'Make it yours.' : 'Welcome back.'}</h1>
    <p className="intro">{actor ? 'Update the words your players see.' : 'Sign in with your admin PIN to manage the website.'}</p>
    {notice && <div className="notice" role="status">{notice}</div>}
    {!actor ? <form className="card login" onSubmit={login}>
      <label htmlFor="pin">Admin PIN</label><input id="pin" type="password" autoComplete="off" value={pin} maxLength={64} required minLength={4} onChange={e=>setPin(e.target.value)} disabled={busy}/>
      <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form> : actor.role !== 'ADMIN' ? <div className="card"><h2>Staff account</h2><p>Website editing is available to administrators. Your operational Ledger access is unchanged.</p></div> : !draft ? <div className="card"><p>Content could not be loaded.</p><button disabled={busy} onClick={()=>perform(async()=>accept(await client.content()))}>Retry</button></div> : <>
      <div className="account"><span className="dot"/>{actor.display_name}<span className="status">{dirty ? 'Unsaved changes' : 'Up to date'}</span></div>
      <nav aria-label="Content sections">{sections.map((s,i)=><button key={s.title} aria-pressed={tab===i} onClick={()=>setTab(i)}>{s.title}</button>)}<button aria-pressed={tab===noticesTab} onClick={()=>setTab(noticesTab)}>Notices</button><button aria-pressed={tab===membershipsTab} onClick={()=>setTab(membershipsTab)}>Membership tiers</button><button aria-pressed={tab===ratesTab} onClick={()=>setTab(ratesTab)}>Table rates</button><button aria-pressed={tab===shopTab} onClick={()=>setTab(shopTab)}>QShop catalogue</button><button aria-pressed={tab===heroTab} onClick={()=>setTab(heroTab)}>Hero slides</button></nav>
      {conflict && <aside className="card conflict"><h2>Review the newer version</h2><p>Your draft is kept below. Load the latest saved text to compare before replacing your draft.</p>
        <button disabled={busy} onClick={()=>perform(async()=>setLatest(await client.content()))}>Load latest for comparison</button>
        {latest && <><div className="comparison">{sections.flatMap(s=>s.fields.map(([key,label])=><div key={key}><strong>{label}</strong><p>{latest.content[s.id]?.[key] || 'Empty'}</p></div>))}{latest.content.announcements?.map(row=><div key={row.id}><strong>Public notice</strong><p>{row.text}</p><p>{row.link}</p></div>)}</div><button disabled={busy} onClick={()=>{if(window.confirm('Replace your unsaved draft with the latest saved content?')) accept(latest);}}>Discard draft and use latest</button></>}
      </aside>}
      <form onSubmit={save}>{tab===noticesTab ? <Notices rows={draft.announcements || []} onChange={rows=>setDraft({...draft,announcements:rows})} busy={busy}/> : tab===membershipsTab ? <MembershipEditor rows={draft.memberships || []} onChange={rows=>setDraft({...draft,memberships:rows})} busy={busy}/> : tab===ratesTab ? <RateEditor rows={draft.bookingTables || []} onChange={rows=>setDraft({...draft,bookingTables:rows})} busy={busy}/> : tab===shopTab ? <ShopEditor catalog={draft.shopCatalog || {heading:'',topLabel:'',description:'',badge1:'',badge2:'',items:[]}} onChange={shopCatalog=>setDraft({...draft,shopCatalog})} busy={busy}/> : tab===heroTab ? <HeroSlidesEditor slides={draft.club?.heroSlides || []} onChange={heroSlides=>setDraft({...draft,club:{...(draft.club||{}),heroSlides}})} busy={busy}/> : <section className="card"><h2>{current.title}</h2>{current.fields.map(([key,label,kind])=><div className="field" key={key}><label htmlFor={key}>{label}</label>{kind==='textarea' ? <textarea id={key} rows={5} maxLength={30000} value={draft[current.id]?.[key] || ''} disabled={busy} onChange={e=>setDraft({...draft,[current.id]:{...draft[current.id],[key]:e.target.value}})}/> : <input id={key} maxLength={30000} value={draft[current.id]?.[key] || ''} disabled={busy} onChange={e=>setDraft({...draft,[current.id]:{...draft[current.id],[key]:e.target.value}})}/>}</div>)}</section>}
      <footer><span>{conflict ? 'Review required' : dirty ? 'Ready when you are' : 'All changes saved'}</span><button className="primary" disabled={busy || !dirty || conflict}>{busy ? 'Saving…' : 'Save changes'}</button></footer></form>
    </>}
  </main>;
}
createRoot(document.getElementById('root')).render(<Admin/>);

import React from 'react';

export default function Memberships({rows,onChange,busy}) {
  const list=Array.isArray(rows)?rows:[];
  const update=(id,patch)=>onChange(list.map(row=>row.id===id?{...row,...patch}:row));
  return <section className="card">
    <h2>Membership tiers</h2>
    <p>Edit the existing live membership tiers. Adding or deleting tiers is intentionally disabled in this first secure CMS batch.</p>
    {list.map(row=><fieldset className="structured-editor" key={row.id}>
      <legend>{row.tier || row.id}</legend>
      <label htmlFor={`tier-${row.id}`}>Tier name</label>
      <input id={`tier-${row.id}`} value={row.tier || ''} maxLength={100} disabled={busy} onChange={e=>update(row.id,{tier:e.target.value})}/>
      <label htmlFor={`price-${row.id}`}>Monthly price (₹)</label>
      <input id={`price-${row.id}`} type="number" min="0" max="1000000" step="1" value={row.price ?? 0} disabled={busy} onChange={e=>update(row.id,{price:Number(e.target.value)})}/>
      <label htmlFor={`perks-${row.id}`}>Perks — one per line</label>
      <textarea id={`perks-${row.id}`} rows={6} disabled={busy} value={(row.perks || []).join('\n')} onChange={e=>update(row.id,{perks:e.target.value.split('\n').map(v=>v.trim()).filter(Boolean)})}/>
      <label htmlFor={`note-${row.id}`}>Note</label>
      <input id={`note-${row.id}`} value={row.note || ''} maxLength={1000} disabled={busy} onChange={e=>update(row.id,{note:e.target.value})}/>
    </fieldset>)}
  </section>;
}

import React from 'react';
export default function Notices({rows, onChange, busy}) {
  function update(id,field,value) { onChange(rows.map(row=>row.id===id?{...row,[field]:value}:row)); }
  return <section className="card"><h2>Public notices</h2><p>Short messages for players. Changes go live in the rehearsal only after you save.</p>
    {rows.length===0 && <p>No public notices yet.</p>}
    {rows.map((row,i)=><fieldset className="notice-editor" key={row.id}><legend>Notice {i+1}</legend>
      <label htmlFor={`notice-text-${row.id}`}>Message</label><textarea id={`notice-text-${row.id}`} value={row.text} maxLength={2000} rows={3} required disabled={busy} onChange={e=>update(row.id,'text',e.target.value)}/>
      <label htmlFor={`notice-link-${row.id}`}>Link (optional)</label><input id={`notice-link-${row.id}`} value={row.link} maxLength={2048} placeholder="/fixtures or https://…" disabled={busy} onChange={e=>update(row.id,'link',e.target.value)}/>
      <button type="button" className="quiet" disabled={busy} onClick={()=>{if(window.confirm('Remove this notice from your draft? Save changes to confirm.'))onChange(rows.filter(x=>x.id!==row.id));}}>Remove notice {i+1}</button>
    </fieldset>)}
    <button type="button" disabled={busy || rows.length>=50} onClick={()=>onChange([...rows,{id:`notice_${crypto.randomUUID()}`,text:'',link:''}])}>Add notice</button>
  </section>;
}

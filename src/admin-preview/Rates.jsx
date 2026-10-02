import React from 'react';

export default function Rates({rows,onChange,busy}) {
  const list=Array.isArray(rows)?rows:[];
  const update=(id,patch)=>onChange(list.map(row=>row.id===id?{...row,...patch}:row));
  return <section className="card">
    <h2>Table rates</h2>
    <p>These are the existing public booking rates. Member price cannot exceed the standard price.</p>
    {list.map(row=><fieldset className="structured-editor rate-editor" key={row.id}>
      <legend>{row.label || row.id}</legend>
      <label htmlFor={`label-${row.id}`}>Table label</label>
      <input id={`label-${row.id}`} value={row.label || ''} maxLength={120} disabled={busy} onChange={e=>update(row.id,{label:e.target.value})}/>
      <div className="structured-grid">
        <div>
          <label htmlFor={`standard-${row.id}`}>Standard ₹/hour</label>
          <input id={`standard-${row.id}`} type="number" min="0" max="1000000" step="1" value={row.pricePerHour ?? 0} disabled={busy} onChange={e=>update(row.id,{pricePerHour:Number(e.target.value)})}/>
        </div>
        <div>
          <label htmlFor={`member-${row.id}`}>Member ₹/hour</label>
          <input id={`member-${row.id}`} type="number" min="0" max="1000000" step="1" value={row.memberPricePerHour ?? 0} disabled={busy} onChange={e=>update(row.id,{memberPricePerHour:Number(e.target.value)})}/>
        </div>
      </div>
    </fieldset>)}
  </section>;
}

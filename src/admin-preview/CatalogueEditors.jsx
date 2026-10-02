import React from 'react';

const money = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const makeId = prefix => `${prefix}_${crypto.randomUUID()}`;

export function MembershipEditor({rows,onChange,busy}) {
  function patch(id,field,value){ onChange(rows.map(row=>row.id===id?{...row,[field]:value}:row)); }
  function add(){
    onChange([...rows,{id:makeId('membership'),tier:'New Tier',price:0,perks:['Member pricing'],note:'Non-transferable'}]);
  }
  function remove(id){
    if(rows.length<=1)return;
    if(window.confirm('Remove this membership tier from the draft?'))onChange(rows.filter(row=>row.id!==id));
  }
  return <section className="card">
    <h2>Membership tiers</h2>
    <p>Manage the public tier names, prices and benefits. Saving uses the same revision protection as other CMS changes.</p>
    <div className="cms-list">
      {rows.map((row,index)=><fieldset className="notice-editor" key={row.id}>
        <legend>Tier {index+1}</legend>
        <label>Tier name</label>
        <input value={row.tier} maxLength={80} disabled={busy} onChange={e=>patch(row.id,'tier',e.target.value)}/>
        <label>Monthly price (₹)</label>
        <input type="number" min="0" max="1000000" step="1" value={money(row.price)} disabled={busy} onChange={e=>patch(row.id,'price',Number(e.target.value))}/>
        <label>Benefits — one per line</label>
        <textarea rows={5} value={(row.perks||[]).join('\n')} disabled={busy} onChange={e=>patch(row.id,'perks',e.target.value.split('\n').map(v=>v.trim()).filter(Boolean).slice(0,20))}/>
        <label>Note</label>
        <input value={row.note||''} maxLength={2000} disabled={busy} onChange={e=>patch(row.id,'note',e.target.value)}/>
        <button type="button" className="quiet" disabled={busy||rows.length<=1} onClick={()=>remove(row.id)}>Remove tier</button>
      </fieldset>)}
    </div>
    <button type="button" disabled={busy||rows.length>=20} onClick={add}>Add tier</button>
  </section>;
}

export function RateEditor({rows,onChange,busy}) {
  function patch(id,field,value){ onChange(rows.map(row=>row.id===id?{...row,[field]:value}:row)); }
  function add(){
    onChange([...rows,{id:makeId('tbl'),label:'New Table',pricePerHour:0,memberPricePerHour:0}]);
  }
  function remove(id){
    if(rows.length<=1)return;
    if(window.confirm('Remove this table/rate row from the draft?'))onChange(rows.filter(row=>row.id!==id));
  }
  return <section className="card">
    <h2>Table rates</h2>
    <p>Edit the public standard and member hourly rates without exposing booking requests or customer data.</p>
    <div className="cms-list">
      {rows.map((row,index)=><fieldset className="notice-editor" key={row.id}>
        <legend>Table {index+1}</legend>
        <label>Label</label>
        <input value={row.label} maxLength={100} disabled={busy} onChange={e=>patch(row.id,'label',e.target.value)}/>
        <label>Standard rate / hour (₹)</label>
        <input type="number" min="0" max="100000" step="1" value={money(row.pricePerHour)} disabled={busy} onChange={e=>patch(row.id,'pricePerHour',Number(e.target.value))}/>
        <label>Member rate / hour (₹)</label>
        <input type="number" min="0" max="100000" step="1" value={money(row.memberPricePerHour)} disabled={busy} onChange={e=>patch(row.id,'memberPricePerHour',Number(e.target.value))}/>
        <button type="button" className="quiet" disabled={busy||rows.length<=1} onClick={()=>remove(row.id)}>Remove table</button>
      </fieldset>)}
    </div>
    <button type="button" disabled={busy||rows.length>=20} onClick={add}>Add table</button>
  </section>;
}

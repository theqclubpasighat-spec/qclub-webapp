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


export function ShopEditor({catalog,onChange,busy}) {
  const value = catalog && typeof catalog === 'object' ? catalog : { heading:'',topLabel:'',description:'',badge1:'',badge2:'',items:[] };
  const rows = Array.isArray(value.items) ? value.items : [];
  function patchCatalog(field,next){ onChange({...value,[field]:next}); }
  function patchItem(id,field,next){ onChange({...value,items:rows.map(row=>row.id===id?{...row,[field]:next}:row)}); }
  function patchOption(itemId,optionId,field,next){
    onChange({...value,items:rows.map(row=>row.id===itemId?{...row,options:(row.options||[]).map(opt=>opt.id===optionId?{...opt,[field]:next}:opt)}:row)});
  }
  return <section className="card">
    <h2>QShop catalogue</h2>
    <p>Edit the public shop copy and existing products. Product IDs, option IDs and stock are protected because checkout recovery depends on them.</p>
    <div className="field"><label>Shop heading</label><input value={value.heading||''} maxLength={300} disabled={busy} onChange={e=>patchCatalog('heading',e.target.value)}/></div>
    <div className="field"><label>Top label</label><input value={value.topLabel||''} maxLength={300} disabled={busy} onChange={e=>patchCatalog('topLabel',e.target.value)}/></div>
    <div className="field"><label>Description</label><textarea rows={4} value={value.description||''} maxLength={5000} disabled={busy} onChange={e=>patchCatalog('description',e.target.value)}/></div>
    <div className="field"><label>Badge 1</label><input value={value.badge1||''} maxLength={300} disabled={busy} onChange={e=>patchCatalog('badge1',e.target.value)}/></div>
    <div className="field"><label>Badge 2</label><input value={value.badge2||''} maxLength={300} disabled={busy} onChange={e=>patchCatalog('badge2',e.target.value)}/></div>
    <div className="cms-list">
      {rows.map((row,index)=><fieldset className="notice-editor" key={row.id}>
        <legend>Product {index+1}</legend>
        <label>Name</label><input value={row.name||''} maxLength={160} disabled={busy} onChange={e=>patchItem(row.id,'name',e.target.value)}/>
        <label>Price (₹)</label><input type="number" min="0.01" max="999999.99" step="0.01" value={money(row.price)} disabled={busy} onChange={e=>patchItem(row.id,'price',Number(e.target.value))}/>
        <label>Description</label><textarea rows={4} value={row.desc||''} maxLength={5000} disabled={busy} onChange={e=>patchItem(row.id,'desc',e.target.value)}/>
        <label>Badge</label><input value={row.badge||''} maxLength={120} disabled={busy} onChange={e=>patchItem(row.id,'badge',e.target.value)}/>
        <label>Primary image</label><input value={row.img||''} maxLength={2000} disabled={busy} onChange={e=>patchItem(row.id,'img',e.target.value)}/>
        <label>Gallery images — one URL/path per line</label><textarea rows={4} value={(row.images||[]).join('\n')} maxLength={12000} disabled={busy} onChange={e=>patchItem(row.id,'images',e.target.value.split('\n').map(v=>v.trim()).filter(Boolean).slice(0,12))}/>
        <label>Amazon / external link</label><input value={row.amazonUrl||''} maxLength={2000} disabled={busy} onChange={e=>patchItem(row.id,'amazonUrl',e.target.value)}/>
        <label>Option group label</label><input value={row.optionGroupLabel||''} maxLength={120} disabled={busy} onChange={e=>patchItem(row.id,'optionGroupLabel',e.target.value)}/>
        {(row.options||[]).map((opt,optIndex)=><fieldset className="notice-editor" key={opt.id}>
          <legend>Option {optIndex+1}</legend>
          <label>Label</label><input value={opt.label||''} maxLength={120} disabled={busy} onChange={e=>patchOption(row.id,opt.id,'label',e.target.value)}/>
          <label>Image</label><input value={opt.img||''} maxLength={2000} disabled={busy} onChange={e=>patchOption(row.id,opt.id,'img',e.target.value)}/>
        </fieldset>)}
        <p><strong>Stock is managed separately.</strong> It is intentionally read-only in this website editor.</p>
      </fieldset>)}
    </div>
    {!rows.length ? <p>No QShop products are present in this rehearsal copy.</p> : null}
  </section>;
}


export function HeroSlidesEditor({slides,onChange,busy}) {
  const rows = Array.isArray(slides) ? slides : [];
  return <section className="card">
    <h2>Hero slides</h2>
    <p>One image URL or site path per line, in display order. Removing a line only removes it from the homepage rotation; it does not delete the Storage object.</p>
    <div className="field">
      <label htmlFor="heroSlides">Hero images</label>
      <textarea id="heroSlides" rows={12} maxLength={60000} disabled={busy}
        value={rows.join('\n')}
        onChange={e=>onChange(e.target.value.split('\n').map(v=>v.trim()).filter(Boolean).slice(0,30))}/>
    </div>
    <p>Keep at least one slide. HTTPS URLs and site paths beginning with / are accepted.</p>
  </section>;
}


export function ThemeEditor({theme,onChange,busy}) {
  const value = theme && typeof theme === 'object' ? theme : {};
  const fields = [
    ['accent','Accent'],
    ['background','Background'],
    ['surface','Surface'],
    ['text','Text'],
    ['mutedText','Muted text'],
    ['border','Border'],
  ];
  function patch(key,next){ onChange({...value,[key]:next.toUpperCase()}); }
  return <section className="card">
    <h2>Theme</h2>
    <p>Edit presentation colours only. These values cannot change payments, bookings, inventory, member records or operational settings.</p>
    <div className="theme-grid">
      {fields.map(([key,label])=><div className="field" key={key}>
        <label htmlFor={`theme-${key}`}>{label}</label>
        <div className="theme-token">
          <input id={`theme-${key}`} value={value[key]||''} maxLength={7} pattern="#[0-9A-Fa-f]{6}" placeholder="#D9C683" disabled={busy} onChange={e=>patch(key,e.target.value)}/>
          <span className="theme-swatch" aria-hidden="true" style={{background:/^#[0-9A-Fa-f]{6}$/.test(value[key]||'')?value[key]:'transparent'}}/>
        </div>
      </div>)}
    </div>
    <p>Use six-digit hex colours such as #D9C683. Theme changes remain rehearsal-only until the public V2 shell is explicitly wired to them.</p>
  </section>;
}


export function NotificationTemplatesEditor({templates,onChange,busy}) {
  const value = templates && typeof templates === 'object' ? templates : {};
  const fields = [
    ['foodSuccess','Q Lounge success'],
    ['foodFailed','Q Lounge failed'],
    ['qshopSuccess','QShop success'],
    ['qshopFailed','QShop failed'],
    ['bookingSuccess','Booking success'],
    ['bookingFailed','Booking failed'],
    ['membershipSuccess','Membership success'],
    ['membershipFailed','Membership failed'],
    ['tournamentSuccess','Tournament success'],
    ['tournamentFailed','Tournament failed'],
    ['otp','OTP'],
    ['jobApplicationReceived','Job application received'],
    ['jobInterviewCall','Job interview call'],
  ];
  function patch(key,next){ onChange({...value,[key]:next.trim()}); }
  return <section className="card">
    <h2>Notification templates</h2>
    <p>Manage approved MSG91 template names only. Auth keys, sender numbers and live-send controls are intentionally excluded from this editor.</p>
    <div className="cms-list">
      {fields.map(([key,label])=><div className="field" key={key}>
        <label htmlFor={`template-${key}`}>{label}</label>
        <input id={`template-${key}`} value={value[key]||''} maxLength={120} pattern="[A-Za-z0-9_.-]*" placeholder="approved_template_name" disabled={busy} onChange={e=>patch(key,e.target.value)}/>
      </div>)}
    </div>
    <p>Saving here does not activate, send or change any live WhatsApp message. The rehearsal dispatcher continues to use server-held environment configuration.</p>
  </section>;
}


export function FeatureFlagsEditor({flags,onChange,busy}) {
  const value = flags && typeof flags === 'object' ? flags : {};
  const fields = [
    ['showQLounge','Q Lounge'],
    ['showQShop','QShop'],
    ['showBooking','Booking'],
    ['showMembership','Membership'],
    ['showTournaments','Tournaments'],
    ['showPlayers','Player profiles'],
    ['showLiveMatches','Live matches'],
    ['showClubMedia','Club media'],
    ['showOffers','Offers'],
    ['showFeedback','Feedback'],
  ];
  function toggle(key){ onChange({...value,[key]:value[key]!==true}); }
  return <section className="card">
    <h2>Feature flags</h2>
    <p>Store visibility intentions for the V2 experience. These switches are configuration-only in this rehearsal and do not hide, enable or reroute any live production page.</p>
    <div className="flag-list">
      {fields.map(([key,label])=><div className="flag-row" key={key}>
        <div><strong>{label}</strong><p>{value[key]===true?'Intended to be shown':'Intended to be hidden'}</p></div>
        <button id={`flag-${key}`} type="button" aria-pressed={value[key]===true} aria-label={`${label}: ${value[key]===true?'On':'Off'}`} disabled={busy} onClick={()=>toggle(key)}>{value[key]===true?'On':'Off'}</button>
      </div>)}
    </div>
    <p>Activation will require a separate reviewed package. This screen only preserves the V2 feature-flag configuration safely.</p>
  </section>;
}


export function SettingsOverview({groups,onOpen}) {
  return <section className="card settings-overview">
    <h2>Settings</h2>
    <p>One place to find the V2 website settings that have been safely reconciled into the rehearsal CMS.</p>
    <div className="settings-groups">
      {groups.map(group=><section className="settings-group" key={group.title}>
        <h3>{group.title}</h3>
        <p>{group.description}</p>
        <div className="settings-links">
          {group.items.map(item=>item.href
            ? <a className="settings-link" key={item.label} href={item.href}>Open {item.label}</a>
            : <button type="button" key={item.label} onClick={()=>onOpen(item.tab)}>Open {item.label}</button>)}
        </div>
      </section>)}
    </div>
    <p><strong>Operational systems stay separate.</strong> QclubLedger, QclubPay, QclubQr, table displays, Kitty/Q Chase, payment credentials and live inventory operations are not managed from this settings hub.</p>
  </section>;
}


export function ReportsAuditOverview({groups}) {
  return <section className="card settings-overview">
    <h2>Reports & audit</h2>
    <p>Open the existing production records that already own billing, game, order and committee history. This page does not copy or summarize customer/payment data into the rehearsal CMS.</p>
    <div className="settings-groups">
      {groups.map(group=><section className="settings-group" key={group.title}>
        <h3>{group.title}</h3>
        <p>{group.description}</p>
        <div className="settings-links">
          {group.items.map(item=><a className="settings-link" key={item.label} href={item.href}>Open {item.label}</a>)}
        </div>
      </section>)}
    </div>
    <p><strong>Source of truth remains unchanged.</strong> Ledger, game records, committee review and order archives continue to read their current production stores and authorization rules.</p>
  </section>;
}


export function RoleToolsOverview({groups}) {
  return <section className="card settings-overview">
    <h2>Role tools</h2>
    <p>V2 grouped operational pages by role. These links reuse the existing production pages; they do not grant a role or bypass the authorization already enforced by each destination.</p>
    <div className="settings-groups">
      {groups.map(group=><section className="settings-group" key={group.title}>
        <h3>{group.title}</h3>
        <p>{group.description}</p>
        <div className="role-tool-list">
          {group.items.map(item=><a className="role-tool" key={item.label} href={item.href}>
            <span><strong>{item.label}</strong><small>{item.note}</small></span><span aria-hidden="true">→</span>
          </a>)}
        </div>
      </section>)}
    </div>
    <p><strong>Security boundary:</strong> this directory is navigation only. Any broader STAFF/COMMITTEE write access must be separately reviewed and tested before activation.</p>
  </section>;
}


export function DataToolsOverview({content,updatedAt}) {
  function downloadBackup() {
    const backup = {
      format:'qclub-projected-cms-backup',
      version:1,
      exportedAt:new Date().toISOString(),
      sourceUpdatedAt:updatedAt || null,
      content:content && typeof content === 'object' ? content : {},
    };
    const blob = new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href=url;
    anchor.download='qclub-cms-backup-'+new Date().toISOString().slice(0,10)+'.json';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }
  return <section className="card settings-overview">
    <h2>Data tools</h2>
    <p>Export a read-only snapshot of the content currently exposed by the protected CMS projection.</p>
    <div className="settings-group">
      <h3>CMS content backup</h3>
      <p>The file contains website content only: public copy, notices, membership presentation, table-rate presentation, QShop presentation, media links, theme tokens, notification template names and feature-flag configuration.</p>
      <button type="button" className="primary" onClick={downloadBackup}>Download CMS backup</button>
    </div>
    <p><strong>Restore and import are intentionally unavailable.</strong> The old V2 restore/CSV tools targeted staging-era tables and could recreate duplicate sources of truth. Operational data remains protected by its existing production systems and backups.</p>
  </section>;
}

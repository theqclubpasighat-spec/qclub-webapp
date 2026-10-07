import React from "react";
import { QRCodeSVG } from "qrcode.react";

const TABLES=[
  {key:"T1",name:"TABLE 1 — LIBERWIN"},
  {key:"T2",name:"TABLE 2 — WIRAKA 777"},
  {key:"T3",name:"TABLE 3 — MINI SNOOKER"},
  {key:"T4",name:"TABLE 4 — AMERICAN POOL"},
];

export default function TableQrPrintPage(){
  const origin=typeof window!=="undefined"?window.location.origin:"https://www.theqclubpasighat.com";
  return <div className="qrprint-root">
    <style>{".qrprint-root{min-height:100vh;background:#fff;color:#111;font-family:Arial,sans-serif;padding:20px}.qrprint-toolbar{max-width:1100px;margin:0 auto 18px;display:flex;justify-content:space-between;align-items:center;gap:12px}.qrprint-grid{max-width:1100px;margin:0 auto;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.qrprint-card{border:2px solid #111;border-radius:16px;padding:22px;text-align:center;break-inside:avoid}.qrprint-title{font-size:24px;font-weight:900;margin-bottom:5px}.qrprint-sub{font-size:13px;margin-bottom:14px}.qrprint-scan{font-size:18px;font-weight:900;margin-top:12px}.qrprint-url{font-size:10px;margin-top:6px;overflow-wrap:anywhere}.qrprint-btn{border:0;border-radius:10px;padding:11px 15px;background:#111;color:#fff;font-weight:800;cursor:pointer}@media(max-width:700px){.qrprint-grid{grid-template-columns:1fr}.qrprint-root{padding:12px}}@media print{.qrprint-toolbar{display:none}.qrprint-root{padding:0}.qrprint-grid{gap:10mm}.qrprint-card{border-radius:0;padding:10mm;page-break-inside:avoid}}"} </style>
    <div className="qrprint-toolbar"><div><strong>The Q Club Pasighat — Permanent Table QR Codes</strong><div>Print, laminate and place one on each physical table.</div></div><button className="qrprint-btn" onClick={()=>window.print()}>Print QR Sheet</button></div>
    <div className="qrprint-grid">
      {TABLES.map(table=>{
        const url=origin+"/table/"+table.key;
        return <div className="qrprint-card" key={table.key}>
          <div className="qrprint-title">{table.name}</div>
          <div className="qrprint-sub">One permanent QR for this table — use the same QR every day.</div>
          <QRCodeSVG value={url} size={240} level="H" includeMargin />
          <div className="qrprint-scan">SCAN TO START • JOIN • ORDER • VIEW TAB</div>
          <div className="qrprint-url">{url}</div>
          <div style={{fontSize:12,marginTop:10}}>Scanning never stops an existing session or creates a second session on an occupied table.</div>
        </div>;
      })}
    </div>
  </div>;
}
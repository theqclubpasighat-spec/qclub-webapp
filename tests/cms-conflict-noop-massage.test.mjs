import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { saveContent } from "../src/server/security/foundation.js";
import { originalFieldsForChanges } from "../src/admin-live/client.mjs";

const actor={role:"ADMIN",staff_id:"admin-main"};
const now=new Date("2026-10-18T16:35:00Z");

function siteDb(state,updatedAt) {
  const records=[];
  const db={
    from(name) {
      assert.equal(name,"qclub_state");
      const q={
        select(){return q;},
        eq(k,v){records.push(["eq",k,v]);return q;},
        update(update){records.push(["update",update]);return q;},
        async single(){return {data:{state,updated_at:updatedAt},error:null};},
        async maybeSingle(){const patch=records.find(x=>x[0]==="update")?.[1];return {data:patch?{updated_at:patch.updated_at}:null,error:null};}
      };
      return q;
    }
  };
  return {db,records};
}

test("original field baseline contains only edited keys and no private state",()=>{
 const original={club:{name:"Q Club",massageChairInfoContent:"Old chair description",contactContent:"Stay"},announcements:[]};
 const baseline=originalFieldsForChanges(original,{club:{massageChairInfoContent:"New chair description"}});
 assert.deepEqual(baseline,{club:{massageChairInfoContent:"Old chair description"}});
 assert.equal(Object.hasOwn(baseline.club,"contactContent"),false);
});

test("stale revision safely saves independent Massage Chair edit without clobbering changes",async()=>{
 const state={club:{massageChairInfoContent:"Original",termsContent:"New terms from another editor"},paymentOrders:[{id:"paid",amount:250}]};
 const fixture=siteDb(state,"2026-10-18T16:34:00Z");
 const result=await saveContent(fixture.db,actor,{
   baseUpdatedAt:"2026-10-18T16:30:00Z",
   changes:{club:{massageChairInfoContent:"New massage prices"}},
   baseFields:{club:{massageChairInfoContent:"Original"}},
 },now);
 assert.equal(result.ok,true);
 const next=fixture.records.find(x=>x[0]==="update")[1].state;
 assert.equal(next.club.termsContent,"New terms from another editor");
 assert.equal(next.club.massageChairInfoContent,"New massage prices");
 assert.deepEqual(next.paymentOrders,[{id:"paid",amount:250}]);
 assert.ok(fixture.records.some(x=>x[0]==="eq"&&x[1]==="updated_at"&&x[2]==="2026-10-18T16:34:00Z"));
});

test("competing changes to Massage Chair cannot be overwritten by a stale editor",async()=>{
 const fixture=siteDb({club:{massageChairInfoContent:"Updated elsewhere"}},"2026-10-18T16:34:00Z");
 await assert.rejects(saveContent(fixture.db,actor,{
   baseUpdatedAt:"2026-10-18T16:30:00Z",
   changes:{club:{massageChairInfoContent:"My change"}},
   baseFields:{club:{massageChairInfoContent:"Original"}},
 },now),e=>e.code==="STATE_CONFLICT");
 assert.equal(fixture.records.some(x=>x[0]==="update"),false);
});

test("missing baseline cannot bypass stale-revision guard",async()=>{
 const fixture=siteDb({club:{massageChairInfoContent:"Original"}},"2026-10-18T16:34:00Z");
 await assert.rejects(saveContent(fixture.db,actor,{
   baseUpdatedAt:"2026-10-18T16:30:00Z",changes:{club:{massageChairInfoContent:"New"}},
 },now),e=>e.code==="STATE_CONFLICT");
});

test("already saved identical CMS changes return success without touching DB revision",async()=>{
 const fixture=siteDb({club:{massageChairInfoContent:"New"}},"2026-10-18T16:34:00Z");
 const result=await saveContent(fixture.db,actor,{
   baseUpdatedAt:"2026-10-18T16:34:00Z",changes:{club:{massageChairInfoContent:"New"}},
 },now);
 assert.equal(result.updatedAt,"2026-10-18T16:34:00Z");
 assert.equal(fixture.records.some(x=>x[0]==="update"),false);
});

test("legacy website state transport prevents unchanged payload timestamp churn",()=>{
 const code=readFileSync(new URL("../src/server/security/website-state.js",import.meta.url),"utf8");
 assert.match(code,/JSON\.stringify\(next\)===JSON\.stringify\(data\.state\)/);
 const migration=readFileSync(new URL("../supabase/migrations/20261018_cms_noop_revision_massage_prices.sql",import.meta.url),"utf8");
 assert.match(migration,/NEW\.state IS NOT DISTINCT FROM OLD\.state/);
 assert.match(migration,/NEW\.updated_at := OLD\.updated_at/);
 for(const collection of ["old_shop >= 8","old_memberships >= 4","old_tournaments >= 4","old_booking_tables >= 3"])
   assert.ok(migration.includes(collection));
 for(const quote of ["₹149 for 10 minutes","₹199 for 15 minutes","₹349 for 30 minutes","₹599 for 60 minutes"])assert.ok(migration.includes(quote));
});

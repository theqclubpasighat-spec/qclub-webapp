import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStateWriteHandler} from '../api/qclub-state-write.js';
const version='2026-06-20-live-lock-v2';
const revision='2026-10-05T01:45:24.404123+00:00';
function response(){return {statusCode:0,body:null,status(v){this.statusCode=v;return this;},json(v){this.body=v;return this;}};}
function request(state,baseUpdatedAt=revision){return {method:'POST',headers:{'x-qclub-app-version':version},body:{key:'main',state,appVersion:version,baseUpdatedAt}};}
function fixture(){
 let row={state:{club:{name:'Fixture'},orders:[{id:'original'}]},updated_at:revision};
 let reads=0,release;const bothRead=new Promise(resolve=>release=resolve);let mode='normal';
 const db={from(){let patch=null,filters={};return {
 select(){return this;},eq(k,v){filters[k]=v;return this;},update(v){patch=v;return this;},
 async single(){const data=structuredClone(row);if(++reads===2)release();await bothRead;return {data,error:null};},
 async maybeSingle(){if(mode==='error')return {data:null,error:{message:'private diagnostic'}};
 if(filters.key!=='main'||filters.updated_at!==row.updated_at)return {data:null,error:null};
 row=structuredClone(patch);return {data:{updated_at:row.updated_at},error:null};}
 };}};
 return {db,row:()=>row,setMode:v=>mode=v,release};
}
test('two clients with the same revision: one save succeeds, the other conflicts',async()=>{
 const f=fixture(),handler=createStateWriteHandler({createDatabase:()=>f.db,clock:()=>new Date('2026-10-05T01:45:24.404Z')});
 const a=response(),b=response();await Promise.all([handler(request({orders:[{id:'first'}]}),a),handler(request({orders:[{id:'second'}]}),b)]);
 assert.deepEqual([a.statusCode,b.statusCode].sort(),[200,409]);
 const winner=a.statusCode===200?a:b;assert.equal(f.row().updated_at,winner.body.updatedAt);
 assert.equal(f.row().updated_at,'2026-10-05T01:45:24.405Z');
 assert.equal(f.row().state.orders[0].id,a.statusCode===200?'first':'second');
});
test('stale client is rejected without replacing stored collections',async()=>{
 const f=fixture();f.release();const res=response();await createStateWriteHandler({createDatabase:()=>f.db})(request({orders:[]},'2026-10-04T00:00:00Z'),res);
 assert.equal(res.statusCode,409);assert.equal(f.row().state.orders[0].id,'original');
});
test('database diagnostics are not returned to the browser',async()=>{
 const f=fixture();f.release();f.setMode('error');const res=response();await createStateWriteHandler({createDatabase:()=>f.db})(request({}),res);
 assert.equal(res.statusCode,500);assert.equal(res.body.error,'Supabase write failed.');
});

test('a different PostgreSQL revision within the same millisecond is stale',async()=>{
 const f=fixture();f.release();const res=response();await createStateWriteHandler({createDatabase:()=>f.db})(request({orders:[]},'2026-10-05T01:45:24.404122+00:00'),res);
 assert.equal(res.statusCode,409);assert.equal(f.row().state.orders[0].id,'original');
});

test('PostgreSQL applies the revision predicate atomically to simultaneous saves',{skip:!process.env.QCLUB_PGLITE_MODULE},async()=>{
 const {PGlite}=await import(process.env.QCLUB_PGLITE_MODULE);const pg=new PGlite();
 try {
 await pg.exec('create table qclub_state(key text primary key,state jsonb,updated_at timestamptz)');
 await pg.query('insert into qclub_state values($1,$2,$3)',['main',JSON.stringify({orders:[{id:'original'}]}),revision]);
 let reads=0,release;const barrier=new Promise(resolve=>release=resolve);
 const db={from(){let patch,filters={};return {
 select(){return this;},eq(k,v){filters[k]=v;return this;},update(v){patch=v;return this;},
 async single(){const r=await pg.query("select state,to_char(updated_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') as updated_at from qclub_state where key=$1",[filters.key]);if(++reads===2)release();await barrier;return {data:r.rows[0],error:null};},
 async maybeSingle(){const r=await pg.query('update qclub_state set state=$1,updated_at=$2 where key=$3 and updated_at=$4 returning updated_at',[JSON.stringify(patch.state),patch.updated_at,filters.key,filters.updated_at]);return {data:r.rows[0]||null,error:null};}
 };}};
 const handler=createStateWriteHandler({createDatabase:()=>db}),a=response(),b=response();
 await Promise.all([handler(request({orders:[{id:'first'}]}),a),handler(request({orders:[{id:'second'}]}),b)]);
 assert.deepEqual([a.statusCode,b.statusCode].sort(),[200,409]);
 const saved=(await pg.query('select state from qclub_state')).rows[0].state;
 assert.equal(saved.orders[0].id,a.statusCode===200?'first':'second');
 }finally{await pg.close();}
});

// Local tests only. No network database connection or real customer data.
import { readFile } from 'node:fs/promises';
import { hashPin } from '../../src/server/security/foundation.js';
export async function createFixtureDatabase() {
  if (!process.env.QCLUB_PGLITE_MODULE) throw new Error('QCLUB_PGLITE_MODULE required');
  const { PGlite } = await import(process.env.QCLUB_PGLITE_MODULE);
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.snooker_auth_sessions(id text primary key default gen_random_uuid()::text, token_hash text unique,role text,staff_id text,display_name text,expires_at timestamptz,revoked_at timestamptz,device_id text,client_version text);
    create table public.qclub_state(key text primary key,state jsonb,updated_at timestamptz);
    grant select,insert,update on public.snooker_auth_sessions,public.qclub_state to service_role;`);
  await pg.exec(await readFile(new URL('../../supabase/migrations/20260929113230_security_foundation.sql',import.meta.url),'utf8'));
  const state = { theme:{accent:'#D9C683',background:'#0D1715',surface:'#15241E',text:'#E8EEE9',mutedText:'#A9BCB3',border:'#304038'}, club: { name:'The Q Club',location:'Pasighat · Arunachal Pradesh',tagline:'Play. Chill. Compete.',aboutContent:'A place for good games and great company.',liveStreamUrl:'https://example.com/live',videoUrl:'',musicUrl:'',heroSlides:['/hero/one.jpg','https://example.com/hero-two.jpg'],tvShowcaseMode:'PRIVATE-FIXTURE' },foodPage:{title:'Fresh from our kitchen',subtitle:'Take a break between frames.'},memberships:[{id:'membership_bronze',tier:'Bronze',price:499,perks:['Member pricing'],note:'Non-transferable'}],shopCatalog:{heading:'The Q Shop',topLabel:'Club essentials',description:'Shop fixture',badge1:'New',badge2:'Members',updatedAt:'PRIVATE-FIXTURE',items:[{id:'shop_1',name:'Cue Tip',desc:'Practice accessory',price:99,badge:'Popular',amazonUrl:'https://example.com/product',img:'/shop/cue-tip.jpg',images:['/shop/cue-tip.jpg'],optionGroupLabel:'Colour',stock:7,private:'keep-shop',options:[{id:'opt_1',label:'Red',img:'/shop/red.jpg',stock:3,private:'keep-option'}]}]},booking:{tables:[{id:'tbl_1',label:'T1 Liberwin',pricePerHour:400,memberPricePerHour:300}],requests:[{id:'booking-private',mobile:'PRIVATE-FIXTURE'}],blockedSlots:[{id:'block-private'}]},admin:{mainPin:'PRIVATE-FIXTURE'},paymentOrders:[{id:'do-not-change',amount:490}],announcements:[{id:'booking-fixture',type:'table_booking',text:'PRIVATE-FIXTURE',bookingId:'keep-booking'},{id:'legacy-fixture',text:'PRIVATE-FIXTURE'}],players:[{phone:'PRIVATE-FIXTURE'}] };
  await pg.query("insert into public.qclub_state values ('main',$1,now())",[JSON.stringify(state)]);
  for (const [id,pin] of [['main','761239'],['staff','852147'],['committee','963258']]) await pg.query('select public.qclub_security_import_credential($1,$2)',[id,await hashPin(pin)]);
  await pg.exec('set role service_role');
  const rpcArgs = {
    qclub_security_reserve_attempt:['p_network_hash'],qclub_security_credentials:[],
    qclub_security_create_session:['p_credential_id','p_version','p_token_hash','p_expires_at','p_device_id','p_client_version'],
    qclub_security_rotate_credential:['p_actor_token_hash','p_credential_id','p_expected_version','p_pin_hash'],
  };
  const identifier = name => { if (!/^[a-z_]+$/.test(name)) throw Error('Invalid test identifier'); return `"${name}"`; };
  const normalize = v => v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.map(normalize) : v && typeof v==='object' ? Object.fromEntries(Object.entries(v).map(([k,x])=>[k,normalize(x)])) : v;
  const db = {
    async rpc(name,args={}) {
      try {
        if (!Object.hasOwn(rpcArgs,name)) throw Error('Unknown test RPC');
        const values=rpcArgs[name].map(k=>args[k]);
        const params=values.map((_,i)=>`$${i+1}`).join(',');
        const result=await pg.query(`select * from public.${identifier(name)}(${params})`,values);
        return {data:normalize(name==='qclub_security_credentials' ? result.rows : result.rows[0][name]),error:null};
      } catch(error) { return {data:null,error}; }
    },
    from(table) {
      if (!['qclub_state','snooker_auth_sessions'].includes(table)) throw Error('Unexpected table');
      let columns='*', patch=null; const conditions=[];
      const query={
        select(value){columns=value;return query;},update(value){patch=value;return query;},
        eq(key,value){conditions.push([key,value,false]);return query;},is(key,value){if(value!==null)throw Error('Only null');conditions.push([key,value,true]);return query;},
        async execute(single=false){
          try {
            const values=[];const param=v=>{values.push(v);return `$${values.length}`;};
            const cols=columns==='*'?'*':columns.split(',').map(identifier).join(',');
            const set=patch ? Object.entries(patch).map(([k,v])=>`${identifier(k)}=${param(k==='state'?JSON.stringify(v):v)}`).join(',') : '';
            const where=conditions.map(([k,v,isNull])=>`${identifier(k)} ${isNull?'is null':`= ${param(v)}`}`).join(' and ');
            const sql=patch?`update public.${identifier(table)} set ${set} where ${where} returning ${cols}`:`select ${cols} from public.${identifier(table)} where ${where}`;
            const result=await pg.query(sql,values);
            return {data:normalize(single ? result.rows[0]||null : result.rows),error:null};
          } catch(error){return {data:null,error};}
        },single(){return query.execute(true);},maybeSingle(){return query.execute(true);},then(resolve,reject){return query.execute().then(resolve,reject);},
      };return query;
    },
  };
  return {db,pg,close:()=>pg.close()};
}

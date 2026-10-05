// Server transport for the legacy website. This does not enable the cutover:
// cloud.js must switch only after public submissions and checkout are migrated.
import {authenticate,SecurityError} from './foundation.js';
const publicValue=v=>v===null||['string','number','boolean'].includes(typeof v)||(Array.isArray(v)&&v.every(x=>x===null||['string','number','boolean'].includes(typeof x)));
const fields=(value,names)=>Object.fromEntries(names.filter(k=>Object.hasOwn(value||{},k)&&publicValue(value[k])).map(k=>[k,value[k]]));
const rows=(value,names)=>(Array.isArray(value)?value:[]).map(v=>fields(v,names));
const CLUB=['name','upiId','upiName','tagline','tagline2','location','musicUrl','videoUrl','heroSpeed','hoursNote','isOpenNow','aboutTitle','heroSlides','termsTitle','footerAbout','refundTitle','tickerSpeed','aboutContent','homeFeatures','privacyTitle','termsContent','contactTitle','liveStreamUrl','refundContent','shopPageTitle','contactContent','membershipNote','privacyContent','tvCustomSlides','tvShowcaseMode','handicapTitle','handicapContent','bookPageTitle','bookPageSubtitle','footerAboutLabel','footerTermsLabel','heroBookBtnLabel','heroShopBtnLabel','shopPageSubtitle','showInstallSteps','foosballInfoTitle','footerDescription','footerRefundLabel','airHockeyInfoTitle','footerContactLabel','footerPrivacyLabel','balancedFormatTitle','foosballInfoContent','membershipPageTitle','airHockeyInfoContent','massageChairInfoTitle','balancedFormatSubtitle','heroMembershipBtnLabel','membershipPageSubtitle','massageChairInfoContent','balancedFormatDescription','tournamentDisclaimerTitle','tournamentDisclaimerContent'];
const PLAYER=['id','name','city','location','photo','games','group','achievements','bestBreak','bio','style','yearsPlaying','snookerWins','snookerLosses','poolWins','poolLosses'];
const MATCH=['id','bestOf','break1','break2','handicap1','handicap2','matchNo','p1','p2','p1Group','p2Group','result','round','score1','score2','status','winner','updatedAt'];
const TABLE=['id','label','memberPricePerHour','pricePerHour'];
const ITEM=['id','name','displayName','description','price','image','imagePath','inStock','onlineOrderEnabled','available','category'];
const PRIVATE={
 ADMIN:['jobApplications','memberRegistry','foodOrders','archivedFoodOrders','shopReceipts','paymentOrders','inventoryItems','speakerAlerts','whatsappJobs','reviewHistory','matchLedger','qChaseActiveGames'],
 STAFF:['memberRegistry','foodOrders','archivedFoodOrders','shopReceipts','inventoryItems','speakerAlerts','whatsappJobs','matchLedger','qChaseActiveGames'],
 COMMITTEE:['reviewHistory'],
};
const WRITABLE={
 ADMIN:['club','offers','photos','booking','players','foodPage','hallOfFame','jobSettings','membersPage','memberships','menuCatalog','shopCatalog','tournaments','mediaLibrary','jobApplications','memberRegistry','foodOrders','archivedFoodOrders','shopReceipts','inventoryItems','speakerAlerts','whatsappJobs','reviewHistory','matchLedger','qChaseActiveGames'],
 STAFF:['booking','foodOrders','archivedFoodOrders','shopReceipts','inventoryItems','speakerAlerts','whatsappJobs','matchLedger','qChaseActiveGames'],
 COMMITTEE:['players','reviewHistory'],
};
export function websitePublicState(state={}){
 const club=fields(state.club,CLUB);
 club.contact=fields(state.club?.contact,['email1','email2','phone1','phone2']);
 const menuCatalog=Object.fromEntries(Object.entries(state.menuCatalog||{}).map(([id,category])=>[id,{...fields(category,['title','image','imagePath']),items:rows(category?.items,ITEM)}]));
 const shopCatalog={...fields(state.shopCatalog,['badge1','badge2','heading','topLabel','description','updatedAt']),items:(state.shopCatalog?.items||[]).map(item=>({...fields(item,['id','name','desc','price','amazonUrl','badge','img','imagePath','images','stock','optionGroupLabel']),options:rows(item.options,['id','img','label','stock'])}))};
 return {club,menuCatalog,shopCatalog,
 offers:rows(state.offers,['id','details','price','title']),
 photos:rows(state.photos,['id','caption','createdAt','url','dataUrl','storagePath']),
 foodPage:fields(state.foodPage,['title','subtitle']),
 players:rows(state.players,PLAYER),
 hallOfFame:rows(state.hallOfFame,['id','name','title','photo','year','achievement','description']),
 membersPage:rows(state.membersPage,['id','name','tier','joinedOn','note','photo','photoPath','createdAt','updatedAt']),
 memberships:rows(state.memberships,['id','tier','price','perks','note']),
 jobSettings:{acceptingApplications:state.jobSettings?.acceptingApplications===true,positions:(state.jobSettings?.positions||[]).map(p=>typeof p==='string'?p:fields(p,['id','title','description']))},
 announcements:rows(state.announcements,['id','text','link','createdAt','expiresAt','type']),
 booking:{tables:rows(state.booking?.tables,TABLE)},
 tournaments:(state.tournaments||[]).map(t=>({...fields(t,['id','name','month','game','format','isCurrent','participantIds','registrationFee','registrationNote','balancedFormatTitle','balancedFormatSubtitle','balancedFormatDescription','createdAt','updatedAt']),matches:rows(t.matches,MATCH)})),
 };
}
export function websiteActorState(state,role){
 if(!Object.hasOwn(PRIVATE,role))throw new SecurityError(403,'FORBIDDEN');
 const view=websitePublicState(state);
 for(const key of PRIVATE[role])view[key]=structuredClone(state[key]||[]);
 if(role==='ADMIN'||role==='STAFF')view.booking=structuredClone(state.booking||{});
 if(role==='ADMIN')view.players=structuredClone(state.players||[]);
 if(role==='COMMITTEE')view.players=rows(state.players,[...PLAYER,'committeeNotes','lastReviewDate','reviewRecommendation','reviewStatus']);
 return view;
}
export function applyWebsitePatch(state,role,patch){
 if(!Object.hasOwn(WRITABLE,role))throw new SecurityError(403,'FORBIDDEN');
 if(!patch||typeof patch!=='object'||Array.isArray(patch)||!Object.keys(patch).length)throw new SecurityError(400,'INVALID_PATCH');
 if(Object.keys(patch).some(k=>!WRITABLE[role].includes(k)))throw new SecurityError(403,'FORBIDDEN');
 if(JSON.stringify(patch).length>1_000_000)throw new SecurityError(413,'PATCH_TOO_LARGE');
 for(const [key,value] of Object.entries(patch)){
  const objects=['club','booking','foodPage','jobSettings','menuCatalog','shopCatalog'];
  if(objects.includes(key)?(!value||typeof value!=='object'||Array.isArray(value)):!Array.isArray(value))throw new SecurityError(400,'INVALID_PATCH');
 }
 const uniqueRows=value=>Array.isArray(value)&&value.every(v=>v&&typeof v==='object'&&typeof v.id==='string')&&new Set(value.map(v=>v.id)).size===value.length;
 // Preserve every server-owned section, including credentials and gateway records.
 const next=structuredClone(state);
 for(const [key,value] of Object.entries(patch))next[key]=structuredClone(value);
 // Restricted roles cannot change catalogue prices through operational payloads.
 if(role==='STAFF'&&patch.booking){
  if(JSON.stringify(patch.booking.tables)!==JSON.stringify(state.booking?.tables))throw new SecurityError(403,'FORBIDDEN');
  next.booking={...state.booking,...fields(patch.booking,['lastSeenRequestAt']),requests:structuredClone(patch.booking.requests||[]),blockedSlots:structuredClone(patch.booking.blockedSlots||[])};
 }
 // Restricted roles cannot erase private fields by posting a public projection.
 if(role==='COMMITTEE'&&patch.players){
  const current=new Map((state.players||[]).map(p=>[p.id,p]));
  if(!uniqueRows(patch.players))throw new SecurityError(400,'INVALID_PATCH');
  next.players=patch.players.map(p=>{if(!current.has(p.id))throw new SecurityError(403,'FORBIDDEN');return {...current.get(p.id),...fields(p,['group','committeeNotes','lastReviewDate','reviewRecommendation','reviewStatus'])};});
  if(next.players.length!==current.size)throw new SecurityError(403,'FORBIDDEN');
 }
 return next;
}
export async function websiteStateTransport(db,req){
 const method=String(req.method||'GET').toUpperCase();
 if(!['GET','PATCH'].includes(method))throw new SecurityError(405,'METHOD_NOT_ALLOWED');
 if(req.headers?.['sec-fetch-site']==='cross-site')throw new SecurityError(403,'CROSS_SITE_REQUEST');
 const actor=req.headers?.authorization?await authenticate(db,req):null;
 if(method==='PATCH'&&!actor)throw new SecurityError(401,'AUTH_REQUIRED');
 const {data,error}=await db.from('qclub_state').select('state,updated_at').eq('key','main').single();
 if(error||!data)throw new SecurityError(503,'STATE_UNAVAILABLE');
 if(method==='GET')return {state:actor?websiteActorState(data.state,actor.role):websitePublicState(data.state),updatedAt:data.updated_at,role:actor?.role||null};
 // Preserve PostgreSQL precision. Do not round both revisions through Date.
 if(req.body?.baseUpdatedAt!==data.updated_at)throw new SecurityError(409,'STATE_CONFLICT');
 const next=applyWebsitePatch(data.state,actor.role,req.body?.patch);
 const updatedAt=new Date(Math.max(Date.now(),Date.parse(data.updated_at)+1)).toISOString();
 const saved=await db.from('qclub_state').update({state:next,updated_at:updatedAt}).eq('key','main').eq('updated_at',data.updated_at).select('updated_at').maybeSingle();
 if(saved.error)throw new SecurityError(503,'STATE_UNAVAILABLE');
 if(!saved.data)throw new SecurityError(409,'STATE_CONFLICT');
 return {ok:true,updatedAt:saved.data.updated_at,state:websiteActorState(next,actor.role)};
}

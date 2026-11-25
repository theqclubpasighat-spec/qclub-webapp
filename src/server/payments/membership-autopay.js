import { tokenHash } from '../security/foundation.js';
import { SecurityError } from '../security/errors.js';
import { rehearsalPublicOrigin } from './sandbox-checkout.js';
import { verifyCashfreeWebhook } from './webhook.js';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail = (status, code) => { throw new SecurityError(status, code); };
const day = 86400000;
const istDate = ms => new Date(ms + 19800000).toISOString().slice(0,10);
const terminal = new Set(['CANCELLED','CUSTOMER_CANCELLED','COMPLETED','EXPIRED','LINK_EXPIRED']);

export function prepareSubscription(state, body, now = Date.now()) {
  const {name, phone, email, tierId, id, token} = body;
  if (!uuid.test(id) || !/^[a-f0-9]{64}$/.test(token) || typeof name !== 'string' ||
      !name.trim() || name.length > 120 || !/^[6-9]\d{9}$/.test(phone) ||
      typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    fail(400,'INVALID_MEMBER_DETAILS');
  const tier = state.memberships?.find(t => t.id === tierId);
  if (!tier || !(Number(tier.price)>0) || !Number.isSafeInteger(Math.round(Number(tier.price)*100)))
    fail(409,'TIER_UNAVAILABLE');
  const members = (state.memberRegistry || []).filter(m => String(m.mobile).replace(/\D/g,'').slice(-10) === phone);
  if (members.length > 1) fail(409,'MEMBER_IDENTITY_CONFLICT');
  const until = members[0]?.validUntil;
  if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) fail(409,'CHECK_MEMBER_EXPIRY');
  // Two days of lead time for the sandbox monthly collection and its notice.
  const earliest = istDate(now + 2*day);
  const afterCoverage = until ? new Date(Date.parse(until+'T00:00:00Z')+day).toISOString().slice(0,10) : earliest;
  return {id, owner_hash:tokenHash(token), tier_id:tierId, tier:tier.tier, amount:Number(tier.price),
    name:name.trim(), phone, email, first_date:earliest > afterCoverage ? earliest : afterCoverage, paid_until:until || null};
}

export function sandboxSubscriptions(env, fetcher=fetch) {
  if (env.VERCEL_ENV==='production' || !env.QCLUB_REHEARSAL_CASHFREE_ID || !env.QCLUB_REHEARSAL_CASHFREE_SECRET)
    fail(503,'SANDBOX_GATEWAY_REQUIRED');
  const origin = rehearsalPublicOrigin(env);
  return async (sub, action) => {
    const id = 'qcsub_'+sub.id;
    const root = 'https://sandbox.cashfree.com/pg/subscriptions';
    const suffix = {create:'',status:'/'+id,payments:'/'+id+'/payments',cancel:'/'+id+'/manage'}[action];
    if (suffix===undefined) fail(400,'INVALID_ACTION');
    let payload;
    if (action==='create') payload = {
      subscription_id:id, customer_details:{customer_name:sub.name,customer_email:sub.email,customer_phone:sub.phone},
      plan_details:{plan_name:sub.tier,plan_type:'PERIODIC',plan_currency:'INR',plan_amount:sub.amount,
        plan_max_amount:sub.amount,plan_intervals:1,plan_interval_type:'MONTH'},
      authorization_details:{payment_methods:['upi'],authorization_amount:1,authorization_amount_refund:true},
      subscription_first_charge_time:sub.first_date+'T12:00:00+05:30',
      subscription_meta:{return_url:origin+'/membership',notification_channel:['SMS']}
    };
    if (action==='cancel') payload = {subscription_id:id,action:'CANCEL'};
    const headers = {'x-api-version':'2025-01-01','x-client-id':env.QCLUB_REHEARSAL_CASHFREE_ID,
      'x-client-secret':env.QCLUB_REHEARSAL_CASHFREE_SECRET,'Content-Type':'application/json'};
    if (payload) headers['x-idempotency-key'] = action==='create' ? sub.id : sub.id.replace(/^./,c=>c==='f'?'0':(parseInt(c,16)+1).toString(16));
    const response = await fetcher(root+suffix,{method:payload?'POST':'GET',headers,
      body:payload?JSON.stringify(payload):undefined,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
    if (!response.ok) fail(response.status===404?404:502,'SANDBOX_GATEWAY_UNAVAILABLE');
    return response.json();
  };
}

function verifyPlan(remote, sub) {
  const plan = remote.plan_details;
  if (remote.subscription_id!=='qcsub_'+sub.id || plan?.plan_currency!=='INR' ||
      plan.plan_type!=='PERIODIC' || plan.plan_interval_type!=='MONTH' || Number(plan.plan_intervals)!==1 ||
      Number(plan.plan_recurring_amount)!==Number(sub.amount) || Number(plan.plan_max_amount)!==Number(sub.amount))
    fail(409,'SUBSCRIPTION_MISMATCH');
}

export async function syncSubscription(db, gateway, sub) {
  const remote = await gateway(sub,'status');
  verifyPlan(remote,sub);
  if (!remote.subscription_status) fail(409,'SUBSCRIPTION_MISMATCH');
  const payments = await gateway(sub,'payments');
  if (!Array.isArray(payments)) fail(502,'INVALID_PAYMENT_LIST');
  for (const p of payments) {
    if (p.payment_type!=='CHARGE' || p.payment_status!=='SUCCESS') continue;
    if (p.subscription_id!==remote.subscription_id || !p.cf_payment_id || Number(p.payment_amount)!==Number(sub.amount) ||
        (p.payment_currency && p.payment_currency!=='INR') || !p.payment_schedule_date) fail(409,'PAYMENT_MISMATCH');
    const cycle = /^\d{4}-\d{2}-\d{2}$/.test(p.payment_schedule_date) ? p.payment_schedule_date : istDate(Date.parse(p.payment_schedule_date));
    const result = await db.rpc('qclub_autopay_paid',{p_id:sub.id,p_payment:String(p.cf_payment_id),p_cycle:cycle,p_amount:sub.amount});
    if (result.error) fail(409,'PAYMENT_RECONCILIATION_REQUIRED');
  }
  const updated = await db.from('qclub_autopay').update({status:remote.subscription_status})
    .eq('id',sub.id).eq('status',sub.status).select('paid_until').maybeSingle();
  if (updated.error || !updated.data) fail(409,'RETRY_STATUS_CHECK');
  return {tier:sub.tier,amount:sub.amount,firstDate:sub.first_date,paidUntil:updated.data.paid_until,status:remote.subscription_status,
    nextDebit:terminal.has(remote.subscription_status)?null:remote.next_schedule_date,
    failed:payments.some(p=>p.payment_type==='CHARGE' && p.payment_status==='FAILED' &&
      !payments.some(other=>other.payment_status==='SUCCESS' && other.payment_type==='CHARGE' && other.payment_schedule_date===p.payment_schedule_date))};
}

export async function subscriptionAction(db, env, action, body) {
  const {id, token} = body;
  if (!uuid.test(id) || !/^[a-f0-9]{64}$/.test(token)) fail(400,'INVALID_SUBSCRIPTION');
  const table = () => db.from('qclub_autopay');
  let {data:sub,error} = await table().select('*').eq('id',id).maybeSingle();
  if (error) fail(503,'SUBSCRIPTION_STORAGE_UNAVAILABLE');
  if (['quote','checkout'].includes(action) && !sub) {
    const snapshot = await db.from('qclub_state').select('state').eq('key','main').single();
    if (snapshot.error) fail(503,'CATALOGUE_UNAVAILABLE');
    const draft = prepareSubscription(snapshot.data.state,body);
    if (action==='quote') return {tier:draft.tier,amount:draft.amount,firstDate:draft.first_date,paidUntil:draft.paid_until};
    if (body.amount!==draft.amount || body.firstDate!==draft.first_date || body.tier!==draft.tier)
      fail(409,'QUOTE_CHANGED');
    const inserted = await table().insert(draft).select('*').single();
    if (inserted.error) fail(409,'EXISTING_SIGNUP_OR_RETRY');
    sub = inserted.data;
  }
  if (!sub || sub.owner_hash!==tokenHash(token)) fail(404,'SUBSCRIPTION_NOT_FOUND');
  if (action==='quote') return {tier:sub.tier,amount:sub.amount,firstDate:sub.first_date,paidUntil:sub.paid_until};
  const gateway = sandboxSubscriptions(env);
  if (action==='checkout') {
    if (terminal.has(sub.status) || sub.first_date < istDate(Date.now())) fail(409,'SIGNUP_EXPIRED');
    const remote = await gateway(sub,'create');
    verifyPlan(remote,sub);
    if (!remote.subscription_session_id) fail(409,'SUBSCRIPTION_MISMATCH');
    return {session:remote.subscription_session_id};
  }
  if (action==='cancel' && !terminal.has(sub.status)) await gateway(sub,'cancel');
  if (!['cancel','status'].includes(action)) fail(400,'INVALID_ACTION');
  return syncSubscription(db,gateway,sub);
}

export async function subscriptionWebhook(db,env,raw,headers) {
  verifyCashfreeWebhook(raw,headers,env.QCLUB_REHEARSAL_CASHFREE_SECRET);
  const data = JSON.parse(raw).data;
  const key = data?.subscription_details?.subscription_id || data?.subscription_id || data?.payment_details?.subscription_id;
  if (!key?.startsWith('qcsub_') || !uuid.test(key.slice(6))) return {ignored:true};
  const result = await db.from('qclub_autopay').select('*').eq('id',key.slice(6)).single();
  if (result.error) fail(503,'SUBSCRIPTION_STORAGE_UNAVAILABLE');
  await syncSubscription(db,sandboxSubscriptions(env),result.data);
  return {ok:true};
}

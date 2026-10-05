import { patchLegacyOrder } from './legacy-state.js';
const list = value => {if(Array.isArray(value))return value;try{const v=JSON.parse(value);return Array.isArray(v)?v:[];}catch{return [];}};
const fail = code => {throw Object.assign(new Error(code),{status:409});};
const append = (state,key,row) => {state[key]=[...(state[key]||[]),row];};

// Called only after gateway verification. All effects and the completion marker
// are committed together. A gateway retry cannot duplicate stock or membership.
export function applyLegacyFulfillment(state, record, now = new Date().toISOString()) {
  if(record.fulfillmentCompletionType==='server_atomic')return record;
  // Do not re-issue historical browser-completed memberships or notifications.
  if(record.fulfilled && record.context!=='shop')return record;
  const tags=record.order_tags||{}, id=record.order_id, context=record.context;
  const name=record.customer_name||'Customer', mobile=record.customer_phone||'';
  const amount=Number(record.expectedAmount), orderNo=`QC-${id.slice(-6)}`;
  let inserted=false;
  if(context==='food') {
    const items=list(tags.food_items_json);if(!items.length)fail('ORDER_ITEMS_MISSING');
    if(!(state.foodOrders||[]).some(x=>x.gatewayOrderId===id||x.id===orderNo)) {
      append(state,'foodOrders',{id:orderNo,gatewayOrderId:id,name,mobile,items,total:String(amount),time:now,status:'Paid',printMeta:{status:'pending_auto_print',requestedAt:now,printedAt:''}});
      inserted=true;
    }
  } else if(context==='shop') {
    const items=list(tags.shop_items_json);if(!items.length)fail('ORDER_ITEMS_MISSING');
    const receipts=state.shopReceipts||[], existing=receipts.find(x=>x.gatewayOrderId===id);
    if(!existing?.stockAdjusted) {
      state.shopCatalog={...state.shopCatalog,items:(state.shopCatalog?.items||[]).map(item=>{
        const lines=items.filter(x=>(x.itemId||x.id)===item.id);
        const qty=rows=>rows.reduce((n,x)=>n+Number(x.qty||x.quantity||0),0);
        return item.options?.length?{...item,options:item.options.map(opt=>({...opt,stock:Math.max(0,Number(opt.stock||0)-qty(lines.filter(x=>x.selectedOptionId===opt.id)))}))}:{...item,stock:Math.max(0,Number(item.stock||0)-qty(lines))};
      })};
      const receipt={...existing,id:existing?.id||`QSHOP-${id.replace(/^order_/,'')}`,orderNo:existing?.orderNo||`QSHOP-${id.replace(/^order_/,'')}`,gatewayOrderId:id,customerName:name,customerMobile:mobile,items,total:amount,paymentStatus:'Paid',pickupStatus:existing?.pickupStatus||'Pending Pickup',createdAt:existing?.createdAt||now,stockAdjusted:true,stockAdjustedAt:now};
      state.shopReceipts=existing?receipts.map(x=>x.gatewayOrderId===id?receipt:x):[...receipts,receipt];
      inserted=true;
    }
  } else if(context==='membership') {
    const tier=tags.tier;if(!tier)fail('MEMBERSHIP_MISSING');
    const expiry=new Date(now);expiry.setUTCMonth(expiry.getUTCMonth()+1);
    const until=tags.valid_until||expiry.toISOString().slice(0,10), today=now.slice(0,10);
    const members=state.memberRegistry||[], existing=members.find(x=>String(x.mobile)===mobile&&String(x.name).toLowerCase()===name.toLowerCase());
    const member={...existing,id:existing?.id||`reg_${id}`,name,mobile,tier,joinedOn:existing?.joinedOn||today,validUntil:until,status:'active',lastPaymentOrderId:id};
    state.memberRegistry=existing?members.map(x=>x===existing?member:x):[...members,member];
    const page=state.membersPage||[], published=page.find(x=>String(x.name).toLowerCase()===name.toLowerCase());
    const display={...published,id:published?.id||`mem_${id}`,name,tier,joinedOn:published?.joinedOn||today,note:published?.note||'Member'};
    state.membersPage=published?page.map(x=>x===published?display:x):[...page,display];
    inserted=true;
  } else if(context==='tournament') {
    const tournament=(state.tournaments||[]).find(t=>t.id===tags.tournament_id);if(!tournament)fail('TOURNAMENT_MISSING');
    let player=(state.players||[]).find(p=>p.id===tags.tournament_player_id);
    if(!player)player=(state.players||[]).find(p=>String(p.name).toLowerCase()===name.toLowerCase());
    if(!player){player={id:`pl_${id}`,name,mobile,city:'Pasighat',createdAt:Date.parse(now)};append(state,'players',player);}
    tournament.participantIds=[...new Set([...(tournament.participantIds||[]),player.id])];inserted=true;
  } else if(context==='booking') {
    const booking=state.booking||{}, requests=booking.requests||[], existing=requests.find(x=>x.id===tags.booking_request_id||x.gatewayOrderId===id);
    const request={...existing,id:existing?.id||tags.booking_request_id||`bk_${id}`,gatewayOrderId:id,name,mobile,itemId:tags.booking_item_id,itemLabel:tags.table_label,bookingDate:tags.booking_date,timeSlot:tags.booking_time_slot,slotLabel:tags.booking_slot,durationHours:Number(tags.booking_duration_hours||1),amount,status:'verified',paymentStatus:'Paid',createdAt:existing?.createdAt||Date.parse(now)};
    state.booking={...booking,requests:existing?requests.map(x=>x===existing?request:x):[...requests,request]};inserted=true;
  } else fail('PAYMENT_CONTEXT_UNSUPPORTED');
  if(inserted) {
    append(state,'speakerAlerts',{id:`paid_${id}`,type:context==='food'?'food_order':`${context}_success`,text:context==='food'?'New food order received. New food order received.':`${name} completed a ${context} payment.`,createdAt:Date.parse(now),playedAt:''});
    const notices={
      membership:{text:`${name} joins as the latest Q Club member !`,link:'/membership'},
      tournament:{text:`${name} registered for ${tags.tournament_name||'the current tournament'} ! Register now`,link:`/tournament-register?id=${encodeURIComponent(tags.tournament_id||'')}`},
      booking:{type:'table_booking',text:`${tags.table_label||'Booked table'} booked by ${name} on ${tags.booking_date||'the selected date'} from ${tags.booking_slot||'the booked slot'}.`,link:'/book'},
    };
    if(notices[context])state.announcements=[{id:`paid_${id}`,createdAt:Date.parse(now),...notices[context]},...(state.announcements||[])].slice(0,20);
  }
  Object.assign(record,{fulfilled:true,fulfilledAt:now,fulfillmentStatus:'fulfilled',fulfillmentCompletionType:'server_atomic',fulfillmentResult:{context,orderNo,inserted,completedAt:now}});
  return record;
}

export async function fulfillLegacyOrder(db, orderId, verify) {
  // Gateway lookup happens outside retries; validate the immutable order identity,
  // amount and currency again against the current record inside each attempt.
  const proof=await verify(orderId);
  const result=await patchLegacyOrder(db,orderId,(record,state)=>{
    const paid=proof.order_status==='PAID'&&proof.order_id===record.order_id&&proof.order_currency==='INR'&&Number(proof.order_amount)===Number(record.expectedAmount);
    if(!paid)fail('PAYMENT_NOT_VERIFIED');
    applyLegacyFulfillment(state,record);
    return {verified:true,status:'verified',paymentStatus:'PAID',cashfreeOrderStatus:'PAID',lastVerifiedAt:new Date().toISOString()};
  });
  return result.value;
}

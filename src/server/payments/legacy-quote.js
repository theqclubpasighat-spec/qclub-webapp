const fail=code=>{throw Object.assign(new Error(code),{status:400});};
const money=v=>{const n=Number(v);if(!Number.isFinite(n)||n<=0||Math.abs(Math.round(n*100)-n*100)>0.00001)fail('INVALID_CATALOGUE_PRICE');return Math.round(n*100);};
const phone=v=>String(v||'').replace(/\D/g,'').slice(-10);
const array=v=>{try{const a=typeof v==='string'?JSON.parse(v):v;if(Array.isArray(a)&&a.length>0&&a.length<=100)return a;}catch{}fail('INVALID_CART');};

// Browser amounts and line prices are only comparison values. The saved order
// contains a fresh catalogue snapshot used by both verification and fulfilment.
export function quoteLegacyOrder(state, raw, customer, requestedAmount, now=new Date()) {
  const tags={...raw}, context=tags.context;
  let paise=0;
  if(context==='food'||context==='shop') {
    const key=context==='food'?'food_items_json':'shop_items_json';
    const catalogue=context==='food'?Object.values(state.menuCatalog||{}).flatMap(c=>c.items||[]):state.shopCatalog?.items||[];
    const seen=new Map();
    const items=array(tags[key]).map(line=>{
      const item=catalogue.find(x=>x.id===(line.itemId||line.id));
      if(!item)fail('ITEM_NOT_AVAILABLE');
      const qty=Number(line.qty??line.quantity);if(!Number.isInteger(qty)||qty<1||qty>100)fail('INVALID_QUANTITY');
      if(context==='food'&&(item.inStock===false||item.available===false||item.onlineOrderEnabled===false))fail('ITEM_NOT_AVAILABLE');
      const option=item.options?.length?item.options.find(x=>x.id===line.selectedOptionId):null;
      if(item.options?.length&&!option)fail('OPTION_REQUIRED');
      const countKey=JSON.stringify([item.id,option?.id||'']);
      seen.set(countKey,(seen.get(countKey)||0)+qty);
      if(context==='shop'&&seen.get(countKey)>Number(option?.stock??item.stock??0))fail('OUT_OF_STOCK');
      const unit=money(item.price);paise+=unit*qty;
      return {id:item.id,itemId:item.id,name:item.name,displayName:item.displayName||item.name,qty,price:unit/100,lineTotal:unit*qty/100,...(option?{selectedOptionId:option.id,selectedOptionLabel:option.label}:{})};
    });
    tags[key]=JSON.stringify(items);
    tags[context+'_total']=String(paise/100);
  } else if(context==='membership') {
    const tier=(state.memberships||[]).find(x=>x.tier===tags.tier);if(!tier)fail('MEMBERSHIP_NOT_AVAILABLE');
    paise=money(tier.price);const until=new Date(now);until.setUTCMonth(until.getUTCMonth()+1);tags.valid_until=until.toISOString().slice(0,10);
  } else if(context==='tournament') {
    const tournament=(state.tournaments||[]).find(x=>x.id===tags.tournament_id);if(!tournament)fail('TOURNAMENT_NOT_AVAILABLE');
    paise=money(tournament.registrationFee??99);tags.tournament_name=tournament.name;tags.tournament_fee=String(paise/100);
  } else if(context==='booking') {
    const table=(state.booking?.tables||[]).find(x=>x.id===tags.booking_item_id);if(!table)fail('TABLE_NOT_AVAILABLE');
    const duration=Number(tags.booking_duration_hours);if(!Number.isInteger(duration)||duration<1||duration>12)fail('INVALID_DURATION');
    const member=(state.memberRegistry||[]).find(x=>x.status==='active'&&(!x.validUntil||x.validUntil>=now.toISOString().slice(0,10))&&phone(x.mobile)===phone(customer.phone)&&String(x.name).toLowerCase()===String(customer.name).toLowerCase());
    const memberRequested=tags.booking_type==='member'||(state.booking?.requests||[]).find(x=>x.id===tags.booking_request_id)?.bookingType==='member';
    if(memberRequested&&!member)fail('MEMBERSHIP_VERIFICATION_REQUIRED');
    paise=money(memberRequested?(table.memberPricePerHour??table.pricePerHour):table.pricePerHour)*duration;
    tags.table_label=table.label;tags.booking_amount=String(paise/100);
  } else fail('INVALID_PAYMENT_CONTEXT');
  if(!Number.isSafeInteger(paise)||paise<=0||paise>100000000)fail('INVALID_ORDER_AMOUNT');
  if(Math.round(Number(requestedAmount)*100)!==paise)fail('PRICE_CHANGED_REFRESH_CHECKOUT');
  return {amount:paise/100,tags};
}

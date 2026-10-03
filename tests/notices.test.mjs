import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentPatch, publicContent } from '../src/server/security/foundation.js';
import { safeNoticeLink } from '../src/server/security/notices.js';
const id='notice_12345678-1234-4123-8123-123456789abc';
const entry={id,text:'Open this evening',link:'/fixtures'};
test('notice links reject executable schemes, credentials and ambiguous URLs',()=>{
  for(const url of ['','/fixtures','https://example.com/news'])assert.equal(safeNoticeLink(url),true,url);
  for(const url of ['javascript:alert(1)','data:text/html,x','//example.com','/\\example.com','https://user:password@example.com',' /fixtures','/\n/example.com','http://example.com',null])assert.equal(safeNoticeLink(url),false,String(url));
});
test('public feed includes only explicitly classified notices, with safe fields and links',()=>{
  assert.deepEqual(publicContent({announcements:[{id:'legacy',text:'Private booking'}, {id:'booking',type:'table_booking',text:'Private'}, {...entry,type:'notice',recipientPhone:'Private',link:'javascript:alert(1)'}]}).announcements,[{...entry,link:''}]);
});
test('notice add edit and removal preserve operational entries and existing metadata',()=>{
  const booking={id:'booking',type:'table_booking',text:'Private',payment:{paid:true}};
  const legacy={id:'legacy',text:'Untyped; do not classify'};
  const before={announcements:[booking,{...entry,type:'notice',createdAt:1,extra:'keep'},legacy],paymentOrders:[{amount:90}]};
  const edited=contentPatch(before,{notices:[{...entry,text:'New text'}]});
  assert.deepEqual(edited.announcements,[booking,{...entry,type:'notice',createdAt:1,extra:'keep',text:'New text'},legacy]);
  assert.deepEqual(contentPatch(edited,{notices:[]}).announcements,[booking,legacy]);
  assert.deepEqual(edited.paymentOrders,before.paymentOrders);
  assert.equal(before.announcements[1].text,entry.text);
  assert.equal(contentPatch({announcements:[booking]},{notices:[entry]}).announcements[1].type,'notice');
});
test('invalid, duplicate and operational-ID notice changes fail closed',()=>{
  const before={announcements:[{id:'booking',type:'table_booking',text:'Private'}]};
  for(const notices of [[entry,entry],[{...entry,id:'booking'}],[{...entry,id:'arbitrary-new'}],[{...entry,text:' '}],[{...entry,type:'table_booking'}],[{...entry,link:'javascript:x'}],Array(51).fill(entry),{}])assert.throws(()=>contentPatch(before,{notices}),e=>e.code==='INVALID_NOTICES');
  assert.throws(()=>contentPatch({announcements:[{type:'notice'}]},{notices:[]}),e=>e.code==='INVALID_NOTICES');
});

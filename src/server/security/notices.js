import { SecurityError } from './errors.js';
const invalid = () => { throw new SecurityError(400, 'INVALID_NOTICES'); };
export function safeNoticeLink(link) {
  if (typeof link !== 'string' || link.length > 2048 || /[\s\\\x00-\x1f\x7f]/.test(link)) return false;
  if (link === '') return true;
  if (link.startsWith('/') && !link.startsWith('//')) return true;
  try { const url = new URL(link); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}
export function noticeProjection(state) {
  return (Array.isArray(state?.announcements) ? state.announcements : [])
    // Untyped legacy entries can contain booking/customer details; do not infer audience.
    .filter(x => x?.type === 'notice' && typeof x.id === 'string' && typeof x.text === 'string')
    .map(x => ({ id: x.id, text: x.text, link: safeNoticeLink(x.link) ? x.link : '' }));
}
export function applyNotices(current, proposed) {
  if (!Array.isArray(proposed) || proposed.length > 50) invalid();
  if (current.announcements !== undefined && !Array.isArray(current.announcements)) invalid();
  const original = current.announcements || [];
  const originalIds = new Set();
  for (const row of original) {
    if (row?.type !== 'notice') continue;
    if (typeof row.id !== 'string' || !row.id || typeof row.text !== 'string' || originalIds.has(row.id)) invalid();
    originalIds.add(row.id);
  }
  const ids = new Set();
  const edits = new Map();
  for (const row of proposed) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some(k => !['id','text','link'].includes(k))) invalid();
    if (typeof row.id !== 'string' || row.id.length > 100 || !row.id || ids.has(row.id)) invalid();
    ids.add(row.id);
    if (typeof row.text !== 'string' || !row.text.trim() || row.text.length > 2000 || !safeNoticeLink(row.link)) invalid();
    const matches = original.filter(x => x?.id === row.id);
    if (matches.length > 1 || matches.some(x => x.type !== 'notice')) invalid();
    if (!matches.length && !/^notice_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(row.id)) invalid();
    edits.set(row.id,{id:row.id,text:row.text.trim(),link:row.link});
  }
  // Retain all operational/legacy entries byte-for-byte and in their existing order.
  const next = [];
  for (const row of original) {
    if (row?.type !== 'notice') { next.push(row); continue; }
    if (edits.has(row.id)) { next.push({...row,...edits.get(row.id)}); edits.delete(row.id); }
  }
  for (const row of edits.values()) next.push({...row,type:'notice',createdAt:Date.now()});
  return next;
}

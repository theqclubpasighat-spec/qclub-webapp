import { applyNotices, noticeProjection } from './notices.js';
// Security foundation: intentionally separate from every current production route.
import { createHash, randomBytes, scrypt as derive, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { isIP } from 'node:net';
const scrypt = promisify(derive);
import { SecurityError } from './errors.js';
export { SecurityError } from './errors.js';
const fail = (status, code) => { throw new SecurityError(status, code); };
export const identities = Object.freeze({
  main: { role: 'ADMIN', staff_id: 'admin-main', display_name: 'Q Club Admin' },
  committee: { role: 'ADMIN', staff_id: 'admin-committee', display_name: 'Committee Admin' },
  staff: { role: 'STAFF', staff_id: 'staff-game-marshall', display_name: 'Game Marshall' },
});
export function validPin(pin) {
  // Keep existing PIN strings valid during import; do not trim or coerce credentials.
  return typeof pin === 'string' && pin.length >= 4 && pin.length <= 64 && !/\s/.test(pin);
}
export async function hashPin(pin) {
  if (!validPin(pin)) fail(400, 'INVALID_PIN_FORMAT');
  const salt = randomBytes(16);
  const hash = await scrypt(pin, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt-v1$${salt.toString('hex')}$${hash.toString('hex')}`;
}
export async function verifyPin(pin, encoded) {
  if (!validPin(pin) || typeof encoded !== 'string' || !/^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(encoded)) return false;
  const [, salt, hash] = encoded.split('$');
  const actual = await scrypt(pin, Buffer.from(salt, 'hex'), 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}
export const tokenHash = token => createHash('sha256').update(token).digest('hex');
export function bearer(req) {
  const h = req.headers?.authorization;
  if (typeof h !== 'string' || !/^Bearer snk_[A-Za-z0-9_-]{43}$/i.test(h)) fail(401, 'AUTH_REQUIRED');
  return h.slice(7);
}
export async function authenticate(db, req, allowed = ['ADMIN', 'STAFF'], now = new Date()) {
  const token = bearer(req);
  const { data, error } = await db.from('snooker_auth_sessions').select('id,role,staff_id,display_name,expires_at,revoked_at')
    .eq('token_hash', tokenHash(token)).maybeSingle();
  if (error) fail(503, 'AUTH_UNAVAILABLE');
  if (!data || data.revoked_at || !Number.isFinite(Date.parse(data.expires_at)) || Date.parse(data.expires_at) <= now.getTime()) fail(401, 'AUTH_REQUIRED');
  // Only server-stored role/identity grants authority. Body/localStorage claims are ignored.
  if (!allowed.includes(data.role)) fail(403, 'FORBIDDEN');
  return data;
}
export function rehearsalConfig(env) {
  if (env.VERCEL_ENV === 'production' || env.QCLUB_SECURITY_REHEARSAL !== 'enabled') fail(503, 'SECURITY_REHEARSAL_DISABLED');
  let url;
  try { url = new URL(env.QCLUB_SECURITY_SUPABASE_URL); } catch { fail(503, 'REHEARSAL_DATABASE_REQUIRED'); }
  const forbidden = ['nvuyttadgqpqgpiftzxy', 'pqoaexwjyknzalhmnapc', 'dgdtxlhtgtvfvtmmqbrn'];
  const local = ['127.0.0.1', 'localhost'].includes(url.hostname);
  const ref = env.QCLUB_SECURITY_PROJECT_REF;
  if (forbidden.includes(ref) || forbidden.some(id => url.hostname.includes(id)) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) fail(503, 'REHEARSAL_DATABASE_REQUIRED');
  if (!(local && url.protocol === 'http:') && !(url.protocol === 'https:' && /^[a-z]{20}$/.test(ref || '') && url.hostname === `${ref}.supabase.co`)) fail(503, 'REHEARSAL_DATABASE_REQUIRED');
  if (!env.QCLUB_SECURITY_SERVICE_ROLE_KEY) fail(503, 'REHEARSAL_DATABASE_REQUIRED');
  return { url: url.origin, key: env.QCLUB_SECURITY_SERVICE_ROLE_KEY };
}
function object(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function textFields(v, names) {
  if (!object(v)) return {};
  return Object.fromEntries(names.filter(k => typeof v[k] === 'string').map(k => [k, v[k]]));
}
function finiteMoney(v, max = 1000000) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
}
function projectMemberships(state) {
  return (Array.isArray(state?.memberships) ? state.memberships : [])
    .filter(x => object(x) && typeof x.id === 'string' && typeof x.tier === 'string')
    .map(x => ({
      id: x.id,
      tier: x.tier,
      price: finiteMoney(x.price) ?? 0,
      perks: (Array.isArray(x.perks) ? x.perks : []).filter(v => typeof v === 'string').slice(0, 20),
      note: typeof x.note === 'string' ? x.note : '',
    }));
}
function projectBookingTables(state) {
  return (Array.isArray(state?.booking?.tables) ? state.booking.tables : [])
    .filter(x => object(x) && typeof x.id === 'string' && typeof x.label === 'string')
    .map(x => ({
      id: x.id,
      label: x.label,
      pricePerHour: finiteMoney(x.pricePerHour, 100000) ?? 0,
      memberPricePerHour: finiteMoney(x.memberPricePerHour, 100000) ?? 0,
    }));
}
function validId(v) { return typeof v === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(v); }
function normalizedMemberships(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) fail(400, 'INVALID_CONTENT_PATCH');
  const ids = new Set();
  return value.map(row => {
    if (!object(row) || Object.keys(row).some(k => !['id','tier','price','perks','note'].includes(k))) fail(400, 'INVALID_CONTENT_PATCH');
    if (!validId(row.id) || ids.has(row.id) || typeof row.tier !== 'string' || !row.tier.trim() || row.tier.length > 80) fail(400, 'INVALID_CONTENT_PATCH');
    ids.add(row.id);
    const price = finiteMoney(row.price);
    if (price === null || !Array.isArray(row.perks) || row.perks.length > 20 || row.perks.some(v => typeof v !== 'string' || !v.trim() || v.length > 300) || typeof row.note !== 'string' || row.note.length > 2000) fail(400, 'INVALID_CONTENT_PATCH');
    return { id: row.id, tier: row.tier.trim(), price, perks: row.perks.map(v => v.trim()), note: row.note.trim() };
  });
}
function normalizedBookingTables(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) fail(400, 'INVALID_CONTENT_PATCH');
  const ids = new Set();
  return value.map(row => {
    if (!object(row) || Object.keys(row).some(k => !['id','label','pricePerHour','memberPricePerHour'].includes(k))) fail(400, 'INVALID_CONTENT_PATCH');
    if (!validId(row.id) || ids.has(row.id) || typeof row.label !== 'string' || !row.label.trim() || row.label.length > 100) fail(400, 'INVALID_CONTENT_PATCH');
    ids.add(row.id);
    const standard = finiteMoney(row.pricePerHour, 100000);
    const member = finiteMoney(row.memberPricePerHour, 100000);
    if (standard === null || member === null) fail(400, 'INVALID_CONTENT_PATCH');
    return { id: row.id, label: row.label.trim(), pricePerHour: standard, memberPricePerHour: member };
  });
}
// Explicit projection: an added private field never becomes public by default.
// This is a new API contract, not a drop-in replacement for cloud.js yet.
export function publicContent(state) {
  return {
    club: textFields(state?.club, ['name', 'location', 'tagline', 'tagline2', 'aboutContent', 'termsContent', 'refundContent', 'privacyContent']),
    foodPage: textFields(state?.foodPage, ['title', 'subtitle']),
    memberships: projectMemberships(state),
    bookingTables: projectBookingTables(state),
    announcements: noticeProjection(state),
  };
}
const CONTENT_KEYS = ['club', 'foodPage', 'memberships', 'bookingTables', 'notices'];
const CLUB_KEYS = ['name', 'location', 'tagline', 'tagline2', 'aboutContent', 'termsContent', 'refundContent', 'privacyContent'];
export function contentPatch(current, changes) {
  if (!object(changes) || !Object.keys(changes).length || Object.keys(changes).some(k => !CONTENT_KEYS.includes(k))) fail(400, 'INVALID_CONTENT_PATCH');
  const next = structuredClone(current);
  for (const [section, fields] of Object.entries(changes)) {
    if (section === 'notices') { next.announcements = applyNotices(current, fields); continue; }
    if (section === 'memberships') { next.memberships = normalizedMemberships(fields); continue; }
    if (section === 'bookingTables') {
      next.booking = { ...(object(current.booking) ? current.booking : {}), tables: normalizedBookingTables(fields) };
      continue;
    }
    const allowed = section === 'club' ? CLUB_KEYS : ['title', 'subtitle'];
    if (!object(fields) || !Object.keys(fields).length || Object.keys(fields).some(k => !allowed.includes(k))) fail(400, 'INVALID_CONTENT_PATCH');
    for (const value of Object.values(fields)) if (typeof value !== 'string' || value.length > 30000) fail(400, 'INVALID_CONTENT_PATCH');
    next[section] = { ...(object(current[section]) ? current[section] : {}), ...fields };
  }
  return next;
}
export async function saveContent(db, actor, body, now = new Date()) {
  if (actor.role !== 'ADMIN') fail(403, 'FORBIDDEN');
  if (typeof body?.baseUpdatedAt !== 'string' || !Number.isFinite(Date.parse(body.baseUpdatedAt))) fail(400, 'REVISION_REQUIRED');
  const { data: row, error } = await db.from('qclub_state').select('state,updated_at').eq('key', 'main').single();
  if (error || !row) fail(503, 'STATE_UNAVAILABLE');
  if (row.updated_at !== body.baseUpdatedAt) fail(409, 'STATE_CONFLICT');
  const next = contentPatch(row.state, body.changes);
  const updatedAt = new Date(Math.max(now.getTime(), Date.parse(row.updated_at) + 1)).toISOString();
  Object.assign(next, { updated_at: updatedAt, updatedAt, __cloudUpdatedAt: updatedAt });
  // Atomic compare-and-swap; unlike a read followed by unconditional upsert.
  const result = await db.from('qclub_state').update({ state: next, updated_at: updatedAt })
    .eq('key', 'main').eq('updated_at', row.updated_at).select('updated_at').maybeSingle();
  if (result.error) fail(503, 'STATE_WRITE_FAILED');
  if (!result.data) fail(409, 'STATE_CONFLICT');
  return { ok: true, updatedAt: result.data.updated_at, content: publicContent(next) };
}
export function requestAddress(req, env) {
  // Vercel overwrites x-forwarded-for. Outside Vercel trust only the socket.
  const value = env.VERCEL === '1' ? req.headers?.['x-forwarded-for'] : req.socket?.remoteAddress;
  if (typeof value !== 'string' || !isIP(value)) fail(503, 'LOGIN_UNAVAILABLE');
  return value;
}
export async function privateLogin(db, req, now = new Date(), networkAddress = req.socket?.remoteAddress) {
  const pin = req.body?.pin;
  if (!validPin(pin)) fail(400, 'INVALID_PIN_FORMAT');
  // Hosting layer must supply a trustworthy network address; no device-ID-only limiter.
  const ip = networkAddress;
  if (typeof ip !== 'string' || !isIP(ip)) fail(503, 'LOGIN_UNAVAILABLE');
  const { data: reservation, error: rateError } = await db.rpc('qclub_security_reserve_attempt', { p_network_hash: tokenHash(ip) });
  if (rateError) fail(503, 'LOGIN_UNAVAILABLE');
  if (!reservation?.allowed) fail(429, 'LOGIN_RATE_LIMITED');
  const { data: rows, error } = await db.rpc('qclub_security_credentials');
  if (error || !Array.isArray(rows)) fail(503, 'LOGIN_UNAVAILABLE');
  const matches = [];
  for (const id of ['main', 'staff', 'committee']) {
    const row = rows.find(r => r.credential_id === id);
    if (row && await verifyPin(pin, row.pin_hash)) matches.push(row);
  }
  if (!matches.length) fail(401, 'INVALID_PIN');
  if (matches.length !== 1) fail(503, 'LOGIN_UNAVAILABLE');
  const matched = matches[0];
  const access_token = `snk_${randomBytes(32).toString('base64url')}`;
  const expires_at = new Date(now.getTime() + 72 * 3600000).toISOString();
  // Same response shape and token format as Android's current Ledger API.
  const actor = identities[matched.credential_id];
  const device_id = typeof req.body?.device_id === 'string' ? req.body.device_id.slice(0, 200) : null;
  const client_version = typeof req.body?.client_version === 'string' ? req.body.client_version.slice(0, 100) : null;
  const stored = await db.rpc('qclub_security_create_session', { p_credential_id: matched.credential_id, p_version: matched.version, p_token_hash: tokenHash(access_token), p_expires_at: expires_at, p_device_id: device_id, p_client_version: client_version });
  if (stored.error || stored.data !== true) fail(503, 'LOGIN_UNAVAILABLE');
  return { access_token, expires_at, ...actor };
}
export async function rotateCredential(db, req) {
  const actor = await authenticate(db, req, ['ADMIN']);
  if (actor.staff_id !== 'admin-main') fail(403, 'FORBIDDEN');
  const { credentialId, expectedVersion, newPin } = req.body || {};
  if (!Object.hasOwn(identities, credentialId) || !Number.isInteger(expectedVersion) || expectedVersion < 1) fail(400, 'INVALID_CREDENTIAL_CHANGE');
  const pin_hash = await hashPin(newPin);
  const { data, error } = await db.rpc('qclub_security_rotate_credential', {
    p_actor_token_hash: tokenHash(bearer(req)), p_credential_id: credentialId,
    p_expected_version: expectedVersion, p_pin_hash: pin_hash,
  });
  if (error) fail(503, 'CREDENTIAL_CHANGE_FAILED');
  if (!data?.ok) fail(data?.conflict ? 409 : 403, data?.conflict ? 'CREDENTIAL_CONFLICT' : 'FORBIDDEN');
  return { ok: true, version: data.version, signInAgain: credentialId === 'main' };
}

// Idempotent logout: deleting local state alone does not revoke a copied bearer token.
export async function revokeSession(db, req, now = new Date()) {
  const hashed = tokenHash(bearer(req));
  const result = await db.from('snooker_auth_sessions').update({ revoked_at: now.toISOString() })
    .eq('token_hash', hashed).is('revoked_at', null).select('id');
  if (result.error) fail(503, 'SIGN_OUT_FAILED');
  return { ok: true };
}

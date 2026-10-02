// Session authority stays on the server. Tokens live only in this tab's memory.
export class AdminApiError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
export function createAdminClient(fetcher = globalThis.fetch) {
  let token = null;
  async function request(action, method = 'GET', body) {
    const response = await fetcher(`/api/qclub-checkout-rehearsal?scope=security&action=${action}`, {
      method, cache: 'no-store', credentials: 'omit', redirect: 'error',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let result;
    try { result = await response.json(); } catch { throw new AdminApiError(503, 'INVALID_RESPONSE'); }
    if (!response.ok) {
      if (response.status === 401) token = null;
      throw new AdminApiError(response.status, result.error || 'REQUEST_FAILED');
    }
    return result;
  }
  return {
    async login(pin) {
      token = null;
      const result = await request('login', 'POST', { pin, client_version: 'admin-rehearsal-1' });
      if (!/^snk_[A-Za-z0-9_-]{43}$/.test(result.access_token || '')) throw new AdminApiError(503, 'INVALID_RESPONSE');
      token = result.access_token;
      try { return await request('session'); } catch (error) { token = null; throw error; }
    },
    content: () => request('content'),
    save: (baseUpdatedAt, changes) => request('content', 'PATCH', { baseUpdatedAt, changes }),
    async logout() {
      try { await request('logout', 'POST'); } finally { token = null; }
    },
    forget: () => { token = null; },
  };
}
export const sections = [
  { id: 'club', title: 'Club information', fields: [['name','Club name'],['location','Location'],['tagline','Tagline'],['tagline2','Second tagline']] },
  { id: 'club', title: 'About & policies', fields: [['aboutContent','About the club'],['termsContent','Terms'],['refundContent','Refund policy'],['privacyContent','Privacy policy']] },
  { id: 'foodPage', title: 'Food page', fields: [['title','Page title'],['subtitle','Page subtitle']] },
];
export function changesBetween(before, after) {
  const changes = {};
  for (const section of sections) for (const [key] of section.fields) {
    const value = after?.[section.id]?.[key] ?? '';
    if (value !== (before?.[section.id]?.[key] ?? '')) (changes[section.id] ||= {})[key] = value;
  }
  if (JSON.stringify(before?.memberships || []) !== JSON.stringify(after?.memberships || [])) changes.memberships = after?.memberships || [];
  if (JSON.stringify(before?.bookingRates || []) !== JSON.stringify(after?.bookingRates || [])) changes.bookingRates = after?.bookingRates || [];
  if (JSON.stringify(before?.announcements || []) !== JSON.stringify(after?.announcements || [])) changes.notices = after?.announcements || [];
  return changes;
}
export function messageFor(error) {
  if (error?.code === 'INVALID_NOTICES') return 'Check your notices: use a message and a valid website path or HTTPS link.';
  if (error?.code === 'INVALID_PIN') return 'That PIN was not recognised.';
  if (error?.status === 401) return 'Your session has ended. Sign in again.';
  if (error?.code === 'SIGN_OUT_FAILED') return 'Signed out on this screen, but the server could not revoke the session. It may remain valid until it expires.';
  if (error?.status === 403) return 'This account cannot edit website content.';
  if (error?.status === 409) return 'Someone else updated the website. Your changes have not been saved.';
  if (error?.status === 429) return 'Too many sign-in attempts. Please wait 15 minutes.';
  return 'Cannot reach the admin service. Please try again.';
}

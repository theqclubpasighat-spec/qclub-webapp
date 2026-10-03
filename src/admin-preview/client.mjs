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
  { id: 'club', title: 'Club information', fields: [
    ['name','Club name'],['location','Location'],['tagline','Tagline'],['tagline2','Second tagline'],['hoursNote','Opening hours note'],
  ] },
  { id: 'club', title: 'About & policies', fields: [
    ['aboutTitle','About title'],['aboutContent','About the club','textarea'],
    ['termsTitle','Terms title'],['termsContent','Terms','textarea'],
    ['refundTitle','Refund title'],['refundContent','Refund policy','textarea'],
    ['privacyTitle','Privacy title'],['privacyContent','Privacy policy','textarea'],
    ['tournamentDisclaimerTitle','Tournament disclaimer title'],['tournamentDisclaimerContent','Tournament disclaimer','textarea'],
  ] },
  { id: 'foodPage', title: 'Food page', fields: [['title','Page title'],['subtitle','Page subtitle']] },
  { id: 'club', title: 'Booking & membership', fields: [
    ['bookPageTitle','Booking page title'],['bookPageSubtitle','Booking page subtitle'],
    ['membershipPageTitle','Membership page title'],['membershipPageSubtitle','Membership page subtitle'],
    ['membershipNote','Membership note','textarea'],
  ] },
  { id: 'club', title: 'Shop & game pages', fields: [
    ['shopPageTitle','QShop page title'],['shopPageSubtitle','QShop page subtitle'],
    ['handicapTitle','Handicap title'],['handicapContent','Handicap content','textarea'],
    ['airHockeyInfoTitle','Air hockey title'],['airHockeyInfoContent','Air hockey content','textarea'],
    ['foosballInfoTitle','Foosball title'],['foosballInfoContent','Foosball content','textarea'],
    ['massageChairInfoTitle','Massage chair title'],['massageChairInfoContent','Massage chair content','textarea'],
  ] },
  { id: 'club', title: 'Home & footer', fields: [
    ['balancedFormatTitle','Home feature title'],['balancedFormatSubtitle','Home feature subtitle'],
    ['balancedFormatDescription','Home feature description','textarea'],
    ['heroBookBtnLabel','Book button label'],['heroMembershipBtnLabel','Membership button label'],['heroShopBtnLabel','QShop button label'],
    ['footerAboutLabel','Footer about label'],['footerAbout','Footer about text','textarea'],['footerDescription','Footer description','textarea'],
    ['footerContactLabel','Footer contact label'],['footerTermsLabel','Footer terms label'],
    ['footerRefundLabel','Footer refund label'],['footerPrivacyLabel','Footer privacy label'],
  ] },
  { id: 'club', title: 'Media links', fields: [
    ['liveStreamUrl','Live stream URL'],['videoUrl','Video URL'],['musicUrl','Music URL'],
  ] },
  { id: 'club', title: 'Contact', fields: [
    ['contactTitle','Contact title'],['contactContent','Contact content','textarea'],
  ] },
];
export function changesBetween(before, after) {
  const changes = {};
  for (const section of sections) for (const [key] of section.fields) {
    const value = after?.[section.id]?.[key] ?? '';
    if (value !== (before?.[section.id]?.[key] ?? '')) (changes[section.id] ||= {})[key] = value;
  }
  if (JSON.stringify(before?.announcements || []) !== JSON.stringify(after?.announcements || [])) changes.notices = after?.announcements || [];
  if (JSON.stringify(before?.memberships || []) !== JSON.stringify(after?.memberships || [])) changes.memberships = after?.memberships || [];
  if (JSON.stringify(before?.bookingTables || []) !== JSON.stringify(after?.bookingTables || [])) changes.bookingTables = after?.bookingTables || [];
  if (JSON.stringify(before?.shopCatalog || {}) !== JSON.stringify(after?.shopCatalog || {})) changes.shopCatalog = after?.shopCatalog || { heading:'',topLabel:'',description:'',badge1:'',badge2:'',items:[] };
  if (JSON.stringify(before?.theme || {}) !== JSON.stringify(after?.theme || {})) changes.theme = after?.theme || {};
  if (JSON.stringify(before?.notificationTemplates || {}) !== JSON.stringify(after?.notificationTemplates || {})) changes.notificationTemplates = after?.notificationTemplates || {};
  if (JSON.stringify(before?.club?.heroSlides || []) !== JSON.stringify(after?.club?.heroSlides || [])) changes.heroSlides = after?.club?.heroSlides || [];
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

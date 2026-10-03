const TOKEN_KEY = "qclub_admin_cms_token_v1";

export class AdminApiError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function normalizedActor(value = {}) {
  const committee = value?.staff_id === "admin-committee";
  return {
    role: committee ? "COMMITTEE" : String(value?.role || ""),
    staff_id: String(value?.staff_id || ""),
    display_name: String(value?.display_name || ""),
    expires_at: value?.expires_at || null,
  };
}

export function createAdminClient(fetcher = globalThis.fetch, storage = globalThis.sessionStorage) {
  let token = "";
  try { token = String(storage?.getItem(TOKEN_KEY) || ""); } catch {}

  const remember = (value) => {
    token = value || "";
    try {
      if (token) storage?.setItem(TOKEN_KEY, token);
      else storage?.removeItem(TOKEN_KEY);
    } catch {}
  };

  async function jsonRequest(url, options = {}) {
    const response = await fetcher(url, {
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });
    let result;
    try { result = await response.json(); }
    catch { throw new AdminApiError(503, "INVALID_RESPONSE"); }
    if (!response.ok) {
      if (response.status === 401) remember("");
      throw new AdminApiError(response.status, result?.error || "REQUEST_FAILED");
    }
    return result;
  }

  return {
    hasSession: () => Boolean(token),
    async restore() {
      if (!token) return null;
      try {
        return normalizedActor(await jsonRequest("/api/qclub-cms?action=session"));
      } catch (error) {
        if (error?.status === 401) return null;
        throw error;
      }
    },
    async login(pin) {
      remember("");
      const result = await jsonRequest("/api/snooker/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({
          pin,
          device_id: "qclub-web-cms",
          client_version: "qclub-live-cms-1",
        }),
      });
      if (!/^snk_[A-Za-z0-9_-]{43}$/.test(result?.access_token || "")) {
        throw new AdminApiError(503, "INVALID_RESPONSE");
      }
      remember(result.access_token);
      return normalizedActor(result);
    },
    content: () => jsonRequest("/api/qclub-cms?action=content"),
    save: (baseUpdatedAt, changes) => jsonRequest("/api/qclub-cms?action=content", {
      method: "PATCH",
      body: JSON.stringify({ baseUpdatedAt, changes }),
    }),
    async logout() {
      try {
        if (token) await jsonRequest("/api/qclub-cms?action=logout", { method: "POST", body: JSON.stringify({}) });
      } finally {
        remember("");
      }
    },
    forget: () => remember(""),
  };
}

export const sections = [
  { id: "club", title: "Club information", fields: [
    ["name","Club name"],["location","Location"],["tagline","Tagline"],["tagline2","Second tagline"],["hoursNote","Opening hours note"],
  ] },
  { id: "club", title: "About & policies", fields: [
    ["aboutTitle","About title"],["aboutContent","About the club","textarea"],
    ["termsTitle","Terms title"],["termsContent","Terms","textarea"],
    ["refundTitle","Refund title"],["refundContent","Refund policy","textarea"],
    ["privacyTitle","Privacy title"],["privacyContent","Privacy policy","textarea"],
    ["tournamentDisclaimerTitle","Tournament disclaimer title"],["tournamentDisclaimerContent","Tournament disclaimer","textarea"],
  ] },
  { id: "foodPage", title: "Food page", fields: [["title","Page title"],["subtitle","Page subtitle"]] },
  { id: "club", title: "Booking & membership", fields: [
    ["bookPageTitle","Booking page title"],["bookPageSubtitle","Booking page subtitle"],
    ["membershipPageTitle","Membership page title"],["membershipPageSubtitle","Membership page subtitle"],
    ["membershipNote","Membership note","textarea"],
  ] },
  { id: "club", title: "Shop & game pages", fields: [
    ["shopPageTitle","QShop page title"],["shopPageSubtitle","QShop page subtitle"],
    ["handicapTitle","Handicap title"],["handicapContent","Handicap content","textarea"],
    ["airHockeyInfoTitle","Air hockey title"],["airHockeyInfoContent","Air hockey content","textarea"],
    ["foosballInfoTitle","Foosball title"],["foosballInfoContent","Foosball content","textarea"],
    ["massageChairInfoTitle","Massage chair title"],["massageChairInfoContent","Massage chair content","textarea"],
  ] },
  { id: "club", title: "Home & footer", fields: [
    ["balancedFormatTitle","Home feature title"],["balancedFormatSubtitle","Home feature subtitle"],
    ["balancedFormatDescription","Home feature description","textarea"],
    ["heroBookBtnLabel","Book button label"],["heroMembershipBtnLabel","Membership button label"],["heroShopBtnLabel","QShop button label"],
    ["footerAboutLabel","Footer about label"],["footerAbout","Footer about text","textarea"],["footerDescription","Footer description","textarea"],
    ["footerContactLabel","Footer contact label"],["footerTermsLabel","Footer terms label"],
    ["footerRefundLabel","Footer refund label"],["footerPrivacyLabel","Footer privacy label"],
  ] },
  { id: "club", title: "Media links", fields: [
    ["liveStreamUrl","Live stream URL"],["videoUrl","Video URL"],["musicUrl","Music URL"],
  ] },
  { id: "club", title: "Contact", fields: [
    ["contactTitle","Contact title"],["contactContent","Contact content","textarea"],
  ] },
];

export function changesBetween(before, after) {
  const changes = {};
  for (const section of sections) for (const [key] of section.fields) {
    const value = after?.[section.id]?.[key] ?? "";
    if (value !== (before?.[section.id]?.[key] ?? "")) (changes[section.id] ||= {})[key] = value;
  }
  if (JSON.stringify(before?.announcements || []) !== JSON.stringify(after?.announcements || [])) changes.notices = after?.announcements || [];
  if (JSON.stringify(before?.memberships || []) !== JSON.stringify(after?.memberships || [])) changes.memberships = after?.memberships || [];
  if (JSON.stringify(before?.bookingTables || []) !== JSON.stringify(after?.bookingTables || [])) changes.bookingTables = after?.bookingTables || [];
  if (JSON.stringify(before?.shopCatalog || {}) !== JSON.stringify(after?.shopCatalog || {})) changes.shopCatalog = after?.shopCatalog || { heading:"",topLabel:"",description:"",badge1:"",badge2:"",items:[] };
  if (JSON.stringify(before?.theme || {}) !== JSON.stringify(after?.theme || {})) changes.theme = after?.theme || {};
  if (JSON.stringify(before?.notificationTemplates || {}) !== JSON.stringify(after?.notificationTemplates || {})) changes.notificationTemplates = after?.notificationTemplates || {};
  if (JSON.stringify(before?.featureFlags || {}) !== JSON.stringify(after?.featureFlags || {})) changes.featureFlags = after?.featureFlags || {};
  if (JSON.stringify(before?.club?.heroSlides || []) !== JSON.stringify(after?.club?.heroSlides || [])) changes.heroSlides = after?.club?.heroSlides || [];
  return changes;
}

export function messageFor(error) {
  if (error?.code === "INVALID_NOTICES") return "Check your notices: use a message and a valid website path or HTTPS link.";
  if (error?.code === "INVALID_PIN") return "That PIN was not recognised.";
  if (error?.status === 401) return "Your session has ended. Sign in again.";
  if (error?.status === 403) return "This account cannot edit website content.";
  if (error?.status === 409) return "Someone else updated the website. Your changes have not been saved.";
  if (error?.status === 429) return "Too many sign-in attempts. Please wait 15 minutes.";
  return "Cannot reach the website manager. Please try again.";
}

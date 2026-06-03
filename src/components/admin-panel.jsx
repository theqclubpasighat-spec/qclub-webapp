import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { PageShell } from "./page-helpers";
import { normalizeWhatsappNumber } from "../lib/qclub-utils";
import { isWhatsappOptedOut } from "../lib/qclub-utils";
import { getWhatsappOptOuts } from "../lib/qclub-utils";
import { getWhatsappMode } from "../lib/qclub-utils";
import { getWhatsappSettings } from "../lib/qclub-utils";
import { tournamentDisplay } from "../lib/qclub-utils";
function AdminCollapse({
  title,
  subtitle = "",
  defaultOpen = false,
  children,
}) {
  return (
    <details
      className="card cols-12"
      open={defaultOpen}
      style={{
        padding: 0,
        overflow: "hidden",
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          padding: "18px 20px",
          listStyle: "none",
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "center",
          borderBottom: "1px solid rgba(255,255,255,.08)",
        }}
      >
        <span>
          <h2 style={{ margin: 0 }}>{title}</h2>
          {subtitle ? (
            <span className="muted" style={{ display: "block", marginTop: 4 }}>
              {subtitle}
            </span>
          ) : null}
        </span>

        <span className="badge">Tap to open / close</span>
      </summary>

      <div style={{ padding: 20 }}>
        {children}
      </div>
    </details>
  );
}
function saveWhatsappSettings(next = {}) {
  const clean = {
    provider: String(next?.provider || "msg91").trim() || "msg91",
    authKey: String(next?.authKey || "").trim(),
    senderNumber: String(next?.senderNumber || "").trim(),
    senderLabel: String(next?.senderLabel || "").trim(),

    qshopSuccessTemplate: String(next?.qshopSuccessTemplate || "").trim(),
    qshopFailedTemplate: String(next?.qshopFailedTemplate || "").trim(),

    bookingSuccessTemplate: String(next?.bookingSuccessTemplate || "").trim(),
    bookingFailedTemplate: String(next?.bookingFailedTemplate || "").trim(),

    membershipSuccessTemplate: String(next?.membershipSuccessTemplate || "").trim(),
    membershipFailedTemplate: String(next?.membershipFailedTemplate || "").trim(),

    otpTemplate: String(next?.otpTemplate || "").trim(),

    tournamentSuccessTemplate: String(next?.tournamentSuccessTemplate || "").trim(),
    tournamentFailedTemplate: String(next?.tournamentFailedTemplate || "").trim(),

    foodSuccessTemplate: String(next?.foodSuccessTemplate || "").trim(),
    foodFailedTemplate: String(next?.foodFailedTemplate || "").trim(),
    jobApplicationReceivedTemplate: String(
  next?.jobApplicationReceivedTemplate || ""
).trim(),
jobInterviewCallTemplate: String(
  next?.jobInterviewCallTemplate || ""
).trim(),
  };

  localStorage.setItem("qclub_whatsapp_settings", JSON.stringify(clean));
  return clean;
}


function buildWhatsappDraft({ phone = "", text = "", label = "" }) {
  const normalizedPhone = normalizeWhatsappNumber(phone);
  const cleanText = String(text || "").trim();

  return {
    label: String(label || "").trim(),
    phone: normalizedPhone,
    text: cleanText,
    url:
      normalizedPhone && cleanText
        ? `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(cleanText)}`
        : "",
  };
}

function formatWhatsappDateTime(value = new Date()) {
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function buildMembershipWhatsappText({
  name = "",
  tier = "",
  validUntil = "",
  activatedAt = "",
}) {
  const safeName = String(name || "").trim() || "Member";
  const safeTier = String(tier || "").trim() || "Membership";
  const safeValidUntil = String(validUntil || "").trim() || "—";
  const safeActivatedAt = formatWhatsappDateTime(activatedAt || new Date());

  return [
    `Hello ${safeName},`,
    `Your ${safeTier} membership at The Q Club has been activated successfully.`,
    `Date & Time: ${safeActivatedAt}`,
    `Valid until: ${safeValidUntil}`,
    `Thank you for joining The Q Club, Pasighat.`,
  ].join("\n");
}

function buildTournamentWhatsappText({
  name = "",
  tournamentName = "",
  fee = "",
  registeredAt = "",
}) {
  const safeName = String(name || "").trim() || "Player";
  const safeTournamentName = String(tournamentName || "").trim() || "Tournament";
  const safeFee = String(fee || "").trim() || "0";
  const safeRegisteredAt = formatWhatsappDateTime(registeredAt || new Date());

  return [
    `Hello ${safeName},`,
    `Thank you for registering for ${safeTournamentName}.`,
    `Date & Time: ${safeRegisteredAt}`,
    `Registration Fee: ₹${safeFee}`,
    `Tournament will begin as scheduled. Fixtures will be generated shortly after registration closes.`,
  ].join("\n");
}

function buildFoodWhatsappText({
  name = "",
  orderNo = "",
  total = "",
  items = [],
  itemCount = 0,
  orderedAt = "",
}) {
  const safeName = String(name || "").trim() || "Customer";
  const safeOrderNo = String(orderNo || "").trim() || "—";
  const safeTotal = String(total || "").trim() || "0";
  const safeOrderedAt = formatWhatsappDateTime(orderedAt || new Date());

  const itemLines = Array.isArray(items) && items.length
    ? items
        .map((item) => {
          const itemName = String(item?.name || "").trim();
          const qty = Number(item?.qty || 0);
          if (!itemName) return "";
          return `- ${itemName}${qty > 0 ? ` x ${qty}` : ""}`;
        })
        .filter(Boolean)
    : [];

  const lines = [
    `Hello ${safeName},`,
    `Your Q Lounge order has been placed successfully at The Q Club.`,
    `Order No: ${safeOrderNo}`,
    `Date & Time: ${safeOrderedAt}`,
  ];

  if (itemLines.length) {
    lines.push("Items:");
    lines.push(...itemLines);
  } else if (itemCount) {
    lines.push(`Items: ${itemCount}`);
  }

  lines.push(`Amount received: ₹${safeTotal}`);
  lines.push(`Thank you for your order.`);

  return lines.join("\n");
}

function buildBookingWhatsappText({
  name = "",
  table = "",
  bookingDate = "",
  bookingSlot = "",
  amount = "",
  bookedAt = "",
}) {
  const safeName = String(name || "").trim() || "Customer";
  const safeTable = String(table || "").trim();
  const safeBookingDate = String(bookingDate || "").trim();
  const safeBookingSlot = String(bookingSlot || "").trim();
  const safeAmount = String(amount || "").trim();
  const safeBookedAt = formatWhatsappDateTime(bookedAt || new Date());

  return [
    `Hello ${safeName},`,
    `Your booking request at The Q Club has been received successfully.`,
    `Date & Time: ${safeBookedAt}`,
    safeTable ? `Table / Game: ${safeTable}` : "",
    safeBookingDate ? `Booking Date: ${safeBookingDate}` : "",
    safeBookingSlot ? `Time Slot: ${safeBookingSlot}` : "",
    safeAmount ? `Amount received: ₹${safeAmount}` : "",
    `We look forward to seeing you at The Q Club.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function setWhatsappMode(mode) {
  const nextMode =
    mode === "disabled"
      ? "disabled"
      : mode === "live"
      ? "live"
      : "draft_only";

  localStorage.setItem("qclub_whatsapp_mode", nextMode);
  return nextMode;
}

function saveWhatsappOptOuts(list) {
  const normalized = Array.isArray(list)
    ? Array.from(new Set(list.map((x) => normalizeWhatsappNumber(x)).filter(Boolean)))
    : [];

  localStorage.setItem("qclub_whatsapp_opt_outs", JSON.stringify(normalized));
  return normalized;
}

function storeLatestWhatsappDraft(draft) {
  const phone = normalizeWhatsappNumber(draft?.phone || "");
  if (!phone) return false;
  if (isWhatsappOptedOut(phone)) return false;

  localStorage.setItem("qclub_last_whatsapp_draft", JSON.stringify(draft));
  return true;
}

function buildMsg91WhatsappPayload(draft, settings = getWhatsappSettings()) {
  const phone = normalizeWhatsappNumber(draft?.phone || "");
  const templateName = String(draft?.templateName || "").trim();
  const senderNumber = String(settings?.senderNumber || draft?.senderNumber || "").trim();

  const templateParams = Array.isArray(draft?.templateParams)
    ? draft.templateParams
        .map((x) => String(x ?? "").trim())
        .filter((x) => x.length > 0)
    : [];

  return {
    integrated_number: senderNumber,
    content_type: "template",
    payload: {
      to: phone,
      messaging_product: "whatsapp",
      type: "template",
      template: {
        name: templateName,
        language: {
          code: "en",
          policy: "deterministic",
        },
        components: templateParams.length
          ? [
              {
                type: "body",
                parameters: templateParams.map((value) => ({
                  type: "text",
                  text: value,
                })),
              },
            ]
          : [],
      },
    },
    meta: {
      label: String(draft?.label || "").trim(),
      textPreview: String(draft?.text || "").trim(),
      provider: "msg91",
    },
  };
}

function getWhatsappTemplateForLabel(label = "", settings = {}) {
  const cleanLabel = String(label || "").trim().toLowerCase();

  if (cleanLabel === "membership_success") return settings.membershipSuccessTemplate || "";
  if (cleanLabel === "membership_failed") return settings.membershipFailedTemplate || "";
  if (cleanLabel === "booking_success") return settings.bookingSuccessTemplate || "";
  if (cleanLabel === "booking_failed") return settings.bookingFailedTemplate || "";
  if (cleanLabel === "qshop_order_success" || cleanLabel === "shop_success") return settings.qshopSuccessTemplate || "";
  if (cleanLabel === "qshop_order_failed" || cleanLabel === "shop_failed") return settings.qshopFailedTemplate || "";
  if (cleanLabel === "food_success") return settings.foodSuccessTemplate || "";
  if (cleanLabel === "food_failed") return settings.foodFailedTemplate || "";
  if (cleanLabel === "tournament_success") return settings.tournamentSuccessTemplate || "";
  if (cleanLabel === "tournament_failed") return settings.tournamentFailedTemplate || "";
  if (
    cleanLabel === "otp" ||
    cleanLabel === "guest_otp" ||
    cleanLabel === "otp_success" ||
    cleanLabel === "guest_access_otp"
  ) return settings.otpTemplate || "";

  return "";
}

async function sendMsg91WhatsappMessage(draft, settings = {}) { 
  const authKey = String(settings?.authKey || "").trim();
  const senderNumber = String(settings?.senderNumber || "").trim();
  const senderLabel = String(settings?.senderLabel || "").trim();
  const templateName = String(draft?.templateName || "").trim();
  const phone = normalizeWhatsappNumber(draft?.phone || "");

  if (!authKey) return { ok: false, error: "Missing MSG91 auth key." };
  if (!senderNumber) return { ok: false, error: "Missing MSG91 sender number." };
  if (!templateName) return { ok: false, error: "Missing MSG91 template name." };
  if (!phone) return { ok: false, error: "Missing recipient phone number." };

  try {
    const res = await fetch("/api/whatsapp-send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        authKey,
        senderNumber,
        senderLabel,
        phone,
        templateName,
        templateParams: Array.isArray(draft?.templateParams)
          ? draft.templateParams
          : [],
        label: String(draft?.label || "").trim(),
        text: String(draft?.text || "").trim(),
      }),
    });

    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }

    if (!res.ok) {
      return {
        ok: false,
        error:
          json?.error ||
          json?.message ||
          `API route failed with status ${res.status}.`,
        response: json,
      };
    }

    return {
      ok: true,
      response: json,
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || "API route request failed.",
    };
  }
}

function handleWhatsappNotification({
  label = "",
  phone = "",
  text = "",
  draft = null,
}) {
  const mode = getWhatsappMode();
  if (mode === "disabled") return false;

  const settings = getWhatsappSettings();

  const baseDraft =
    draft && typeof draft === "object"
      ? draft
      : buildWhatsappDraft({
          label,
          phone,
          text,
        });

  const resolvedLabel = String(baseDraft?.label || label || "").trim();
  const mappedTemplate = getWhatsappTemplateForLabel(resolvedLabel, settings);

  const finalDraft = {
    ...baseDraft,
    label: resolvedLabel,
    templateName: mappedTemplate,
    provider: settings.provider || "msg91",
    senderNumber: settings.senderNumber || "",
    senderLabel: settings.senderLabel || "",
    msg91Payload:
      (settings.provider || "msg91") === "msg91"
        ? buildMsg91WhatsappPayload(
            {
              ...baseDraft,
              label: resolvedLabel,
              templateName: mappedTemplate,
              senderNumber: settings.senderNumber || "",
              senderLabel: settings.senderLabel || "",
            },
            settings
          )
        : null,
  };

  const stored = storeLatestWhatsappDraft(finalDraft);

  if (mode === "draft_only") return stored;
  if ((settings.provider || "msg91") !== "msg91") return stored;

  sendMsg91WhatsappMessage(finalDraft, settings)
    .then((result) => {
      localStorage.setItem(
        "qclub_last_whatsapp_send_result",
        JSON.stringify({
          ok: !!result?.ok,
          error: result?.error || "",
          sentAt: new Date().toISOString(),
          label: finalDraft.label || "",
          phone: finalDraft.phone || "",
          templateName: finalDraft.templateName || "",
          response: result?.response || null,
        })
      );

      if (!result?.ok) {
        alert(`WhatsApp live send failed: ${result?.error || "Unknown error"}`);
      } else {
        alert("WhatsApp live send triggered successfully.");
      }
    })
    .catch((error) => {
      localStorage.setItem(
        "qclub_last_whatsapp_send_result",
        JSON.stringify({
          ok: false,
          error: error?.message || "Unknown WhatsApp send error.",
          sentAt: new Date().toISOString(),
          label: finalDraft.label || "",
          phone: finalDraft.phone || "",
          templateName: finalDraft.templateName || "",
        })
      );
      alert(`WhatsApp live send failed: ${error?.message || "Unknown error"}`);
    });

  return stored;
}

async function uploadImageToStorage(file, folder = "general") {
  if (!file) throw new Error("No file selected.");

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      if (!dataUrl) {
        reject(new Error("Failed to read selected file."));
        return;
      }

      resolve({
        path: `${folder}/${Date.now()}-${file.name || "upload"}`,
        url: dataUrl,
      });
    };
    reader.onerror = () => reject(new Error("Failed to read selected file."));
    reader.readAsDataURL(file);
  });
}

export function AdminPanel({ data, admin, commit, activeTournament }) {
  if (!admin) {
    return (
      <>
        <PageShell title="Admin Panel" />
        <div className="container">
          <div className="card">
            <div className="muted">Admin access required.</div>
          </div>
        </div>
      </>
    );
  }

  const bookingCount = (data.booking?.requests || []).filter(
  (r) =>
    !["failed", "booking_failed", "member_rejected", "rejected"].includes(
      String(r?.status || "").toLowerCase()
    )
).length;
  const playersCount = data.players?.length || 0;
  const tournamentsCount = data.tournaments?.length || 0;
 const hiddenAdminPages = [
  {
    group: "Food / Orders / Printing",
    pages: [
      {
        label: "Food Orders Admin + Print Page",
        path: "/admin/orders",
        note: "Food/Q Lounge orders, receipt print, print status, delivery/archive controls",
      },
            {
        label: "Food Receipt HTML Endpoint",
        path: "/api/food-receipt-html",
        note: "Server-rendered 80mm receipt HTML used by the Android ESC/POS print bridge",
      },
            {
        label: "Food Print Bridge",
        path: "/food-print-bridge",
        note: "Dedicated spare-Android receipt auto-print bridge for paid food orders",
      },
      {
        label: "Food Orders Archive",
        path: "/admin/orders-archive",
        note: "Archived delivered/cancelled food order records",
      },
      {
        label: "Q Shop Successful Order Receipts",
        path: "/shop/successful-order-receipts",
        note: "Successful Q Shop receipts and pickup proof",
      },
      {
        label: "Payment Status",
        path: "/payment-status",
        note: "Payment return/status testing and verification page",
      },
    ],
  },
  {
    group: "Staff / Daily Operations",
    pages: [
      {
        label: "Staff Walk-ins",
        path: "/staff-walkins",
        note: "Staff walk-in booking / counter entry page",
      },
      {
        label: "Inventory",
        path: "/inventory",
        note: "Stock and item control",
      },
      {
        label: "Member Registry",
        path: "/member-registry",
        note: "Membership record and member management",
      },
      {
  label: "Job Applications",
  path: "/jobs",
  note: "Employment application form and applicant intake page",
},
      {
        label: "TV Mode",
        path: "/tv",
        note: "Tournament / club display mode",
      },
    ],
  },
  {
    group: "Q Chase / Rummy Snooker",
    pages: [
      {
        label: "Q Chase Main",
        path: "/rummy-snooker",
        note: "Default Q Chase scoring page",
      },
      {
        label: "Q Chase Table 1 Scorer",
        path: "/rummy-snooker-table-1",
        note: "Snooker Table 1 scorer",
      },
      {
        label: "Q Chase Table 2 Scorer",
        path: "/rummy-snooker-table-2",
        note: "Snooker Table 2 scorer",
      },
      {
        label: "Q Chase Table 3 Scorer",
        path: "/rummy-snooker-table-3",
        note: "Mini/Table 3 scorer",
      },
      {
        label: "Q Chase Table 1 Display",
        path: "/rummy-snooker-table-1-display",
        note: "Public display for Table 1 Q Chase",
      },
      {
        label: "Q Chase Table 2 Display",
        path: "/rummy-snooker-table-2-display",
        note: "Public display for Table 2 Q Chase",
      },
      {
        label: "Q Chase Table 3 Display",
        path: "/rummy-snooker-table-3-display",
        note: "Public display for Table 3 Q Chase",
      },
      {
        label: "Q Chase Records",
        path: "/qchase-records",
        note: "Saved final-lock Q Chase records and print copies",
      },
      {
  label: "Q Chase Monthly Reports",
  path: "/qchase-monthly",
  note: "Monthly player reports with net Q Chase points and WhatsApp sending",
},
    ],
  },
  {
    group: "Kitty",
    pages: [
      {
        label: "Kitty Main",
        path: "/kitty",
        note: "Default Kitty scoring page",
      },
      {
        label: "Kitty Table 1 Scorer",
        path: "/kitty-table-1",
        note: "Snooker Table 1 Kitty scorer",
      },
      {
        label: "Kitty Table 2 Scorer",
        path: "/kitty-table-2",
        note: "Snooker Table 2 Kitty scorer",
      },
      {
        label: "Kitty Table 3 Scorer",
        path: "/kitty-table-3",
        note: "Mini/Table 3 Kitty scorer",
      },
      {
        label: "Kitty Table 1 Display",
        path: "/kitty-table-1-display",
        note: "Public display for Table 1 Kitty",
      },
      {
        label: "Kitty Table 2 Display",
        path: "/kitty-table-2-display",
        note: "Public display for Table 2 Kitty",
      },
      {
        label: "Kitty Table 3 Display",
        path: "/kitty-table-3-display",
        note: "Public display for Table 3 Kitty",
      },
      {
        label: "Kitty Records",
        path: "/kitty-records",
        note: "Saved final-lock Kitty records and dispute history",
      },
      {
  label: "Kitty Monthly Report",
  path: "/kitty-monthly",
  note: "Monthly Kitty player summary with wins, ball-outs, net result, and table charges",
},
    ],
  },
  {
    group: "Tournament / Player Audit",
    pages: [
      {
        label: "Review Panel",
        path: "/review-panel",
        note: "Player classification, review and committee audit",
      },
      {
        label: "Match Ledger",
        path: "/match-ledger",
        note: "Manual match record and performance ledger",
      },
    ],
  },
];

  function toggleClubOpen() {
    commit({
      ...data,
      club: {
        ...(data.club || {}),
        isOpenNow: !(data.club?.isOpenNow ?? true),
      },
    });
  }

  function setCurrentTournament(tournamentId) {
    commit({
      ...data,
      tournaments: (data.tournaments || []).map((t) => ({
        ...t,
        isCurrent: t.id === tournamentId,
      })),
    });
  }

  function editHeroSlides() {
    const current = (data.club?.heroSlides || []).join(" | ");
    const next = prompt("Edit hero slides (separate by |):", current);

    if (!next) return;

    const slides = next
      .split("|")
      .map((x) => x.trim())
      .filter(Boolean);

    commit({
      ...data,
      club: {
        ...(data.club || {}),
        heroSlides: slides,
      },
    });
  }

  const lastWhatsappDraft = (() => {
    try {
      return JSON.parse(localStorage.getItem("qclub_last_whatsapp_draft") || "null");
    } catch {
      return null;
    }
  })();

  const hasWhatsappDraft =
    lastWhatsappDraft &&
    typeof lastWhatsappDraft === "object" &&
    (lastWhatsappDraft.phone || lastWhatsappDraft.text || lastWhatsappDraft.url);

  const currentDraftPhone = normalizeWhatsappNumber(lastWhatsappDraft?.phone || "");
  const currentDraftIsOptedOut = currentDraftPhone
    ? isWhatsappOptedOut(currentDraftPhone)
    : false;

  const whatsappPersistence = data.whatsappPersistence || {};

const whatsappSettings = {
  ...getWhatsappSettings(),
  ...((whatsappPersistence && whatsappPersistence.settings) || {}),
};

const whatsappMode =
  String(whatsappPersistence?.mode || "").trim() || getWhatsappMode();

const whatsappOptOuts = Array.isArray(whatsappPersistence?.optOuts)
  ? whatsappPersistence.optOuts
  : getWhatsappOptOuts();
  const [jobSearch, setJobSearch] = useState("");
  const jobApplications = Array.isArray(data.jobApplications)
  ? data.jobApplications
  : [];

const jobSearchText = jobSearch.trim().toLowerCase();

const filteredJobApplications = jobApplications.filter((app) => {
  if (!jobSearchText) return true;

  return [
    app.name,
    app.phone,
    app.email,
    app.applicationId,
    app.position,
  ]
    .join(" ")
    .toLowerCase()
    .includes(jobSearchText);
});

const jobCounts = jobApplications.reduce(
  (acc, app) => {
    const status = String(app.status || "new").toLowerCase();

    if (status.includes("shortlist")) acc.shortlisted += 1;
    else if (status.includes("select")) acc.selected += 1;
    else if (status.includes("reject")) acc.rejected += 1;
    else acc.new += 1;

    return acc;
  },
  { new: 0, shortlisted: 0, selected: 0, rejected: 0 }
);

function commitWhatsappPersistence(patch = {}) {
  commit({
    ...data,
    whatsappPersistence: {
      ...whatsappPersistence,
      ...patch,
      settings: {
        ...((whatsappPersistence && whatsappPersistence.settings) || {}),
        ...((patch && patch.settings) || {}),
      },
    },
  });
}

function persistWhatsappSettings(next = {}) {
  const clean = saveWhatsappSettings(next);
  commitWhatsappPersistence({
    settings: clean,
  });
  return clean;
}

function persistWhatsappMode(mode) {
  const savedMode = setWhatsappMode(mode);
  commitWhatsappPersistence({
    mode: savedMode,
  });
  return savedMode;
}

function persistWhatsappOptOuts(list) {
  const normalized = saveWhatsappOptOuts(list);
  commitWhatsappPersistence({
    optOuts: normalized,
  });
  return normalized;
}

  function createMembershipTestDraft() {
    const demoDraft = buildWhatsappDraft({
      phone: "9774219051",
      label: "membership_success",
      text: buildMembershipWhatsappText({
        name: "WhatsApp Test User",
        tier: "Bronze",
        validUntil: "2026-04-30",
      }),
    });

    demoDraft.templateParams = [
      "WhatsApp Test User",
      "MEM-TEST-001",
      "Bronze",
    ];

    handleWhatsappNotification({
      draft: demoDraft,
    });

    alert("Membership test WhatsApp draft created.");
    window.location.reload();
  }

  function createTournamentSuccessTestDraft() {
    const demoDraft = buildWhatsappDraft({
      phone: "9774219051",
      label: "tournament_success",
      text: buildTournamentWhatsappText({
        name: "WhatsApp Test User",
        tournamentName: "9 Ball Battle",
        fee: "99",
      }),
    });

    demoDraft.templateParams = [
      "WhatsApp Test User",
      "9 Ball Battle",
      "99",
    ];

    handleWhatsappNotification({
      draft: demoDraft,
    });

    alert("Tournament SUCCESS WhatsApp test draft created.");
    window.location.reload();
  }

  function createTournamentFailedTestDraft() {
    const demoDraft = buildWhatsappDraft({
      phone: "9774219051",
      label: "tournament_failed",
      text:
        "Hello WhatsApp Test User.\n\n" +
        "Your registration payment for 9 Ball Battle at The Q Club was not completed successfully.\n" +
        "If you still wish to register, please try again.\n\n" +
        "- The Q Club Pasighat",
    });

    demoDraft.templateParams = [
      "WhatsApp Test User",
      "9 Ball Battle",
      "99",
    ];

    handleWhatsappNotification({
      draft: demoDraft,
    });

    alert("Tournament FAILED WhatsApp test draft created.");
    window.location.reload();
  }

  function createFoodSuccessTestDraft() {
    const demoDraft = buildWhatsappDraft({
      phone: "9774219051",
      label: "food_success",
      text: buildFoodWhatsappText({
        name: "WhatsApp Test User",
        orderNo: "QC-TEST-001",
        total: "198",
        items: [
          { name: "Blue Lagoon", qty: 1 },
          { name: "Virgin Mojito", qty: 1 },
        ],
      }),
    });

    demoDraft.templateParams = [
      "WhatsApp Test User",
      "QC-TEST-001",
      "198",
    ];

    handleWhatsappNotification({
      draft: demoDraft,
    });

    alert("Food SUCCESS WhatsApp test draft created.");
    window.location.reload();
  }

  function createFoodFailedTestDraft() {
    const demoDraft = buildWhatsappDraft({
      phone: "9774219051",
      label: "food_failed",
      text:
        "Hello WhatsApp Test User.\n\n" +
        "Your food order payment at The Q Club was not completed successfully.\n" +
        "If you still wish to place the order, please try again.\n\n" +
        "- The Q Club Pasighat",
    });

    demoDraft.templateParams = [
      "WhatsApp Test User",
      "QC-TEST-001",
      "198",
    ];

    handleWhatsappNotification({
      draft: demoDraft,
    });

    alert("Food FAILED WhatsApp test draft created.");
    window.location.reload();
  }

  function createBookingTestDraft() {
    const demoDraft = buildWhatsappDraft({
      phone: "9774219051",
      label: "booking_success",
      text: buildBookingWhatsappText({
        name: "WhatsApp Test User",
        table: "Snooker Table 12x6",
        bookingDate: "2026-04-01",
        bookingSlot: "18:00-19:00",
        amount: "300",
      }),
    });

    demoDraft.templateParams = [
      "WhatsApp Test User",
      "BK-12345",
      "Snooker Table 12x6",
      "04-04-2026",
      "6:00 PM to 7:00 PM",
    ];

    handleWhatsappNotification({
      draft: demoDraft,
    });

    alert("Booking test WhatsApp draft created.");
    window.location.reload();
  }

  async function copyMsg91Payload() {
    if (!lastWhatsappDraft?.msg91Payload) {
      alert("No MSG91 payload available to copy.");
      return;
    }

    const text = JSON.stringify(lastWhatsappDraft.msg91Payload, null, 2);

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        alert("MSG91 payload copied.");
        return;
      }
    } catch {}

    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "true");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      alert("MSG91 payload copied.");
    } catch {
      alert("Unable to copy payload automatically.");
    }
  }

  async function sendCurrentDraftToDryRunApi() {
    if (!lastWhatsappDraft) {
      alert("No saved WhatsApp draft found.");
      return;
    }

    const payload =
      lastWhatsappDraft.msg91Payload || {
        phone: lastWhatsappDraft.phone || "",
        provider: lastWhatsappDraft.provider || "msg91",
        templateName: lastWhatsappDraft.templateName || "",
        label: lastWhatsappDraft.label || "",
      };

    try {
      const res = await fetch("/api/whatsapp-send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const json = await res.json();

      alert(
        json?.ok
          ? "Dry run API accepted the current draft."
          : `Dry run API rejected it: ${json?.error || "Unknown error"}`
      );

      console.log("WhatsApp dry run response:", json);
    } catch (error) {
      console.error("WhatsApp dry run request failed:", error);
      alert("Dry run API request failed.");
    }
  }

  return (
    <>
      <PageShell title="Admin Panel" subtitle="Club management overview" />

      <div className="container">
        <div className="grid">
          <div className="card cols-4">
            <h2>Bookings</h2>
            <div className="bigStat">{bookingCount}</div>
            <div className="muted">Total booking requests</div>
            <div style={{ marginTop: 14 }}>
              <Link className="btn primary" to="/book">
                Open Bookings
              </Link>
            </div>
          </div>

          <div className="card cols-4">
            <h2>Players</h2>
            <div className="bigStat">{playersCount}</div>
            <div className="muted">Registered players</div>
            <div style={{ marginTop: 14 }}>
              <Link className="btn primary" to="/players">
                Manage Players
              </Link>
            </div>
          </div>

          <div className="card cols-4">
            <h2>Tournaments</h2>
            <div className="bigStat">{tournamentsCount}</div>
            <div className="muted">Total tournaments</div>
            <div style={{ marginTop: 14 }}>
              <Link className="btn primary" to="/tournaments">
                Manage Tournaments
              </Link>
            </div>
          </div>

          <div className="card cols-6">
            <h2>Club Status</h2>
            <div className="muted" style={{ marginBottom: 12 }}>
              Toggle whether the club is currently open or closed.
            </div>

            <div className="row">
              <span className="badge">
                <span className={data.club?.isOpenNow ? "dot" : "dot red"} />
                {data.club?.isOpenNow ? "OPEN NOW" : "CLOSED NOW"}
              </span>

              <button className="btn primary" onClick={toggleClubOpen} type="button">
                Toggle Open / Closed
              </button>
            </div>
          </div>

          
          <AdminCollapse
            title="Homepage Hero Slider"
            subtitle="Upload and manage homepage hero slider images."
          >

            <div
              className="row"
              style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}
            >
              <label className="btn">
                Upload Hero Slide
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;

                    try {
                      const uploaded = await uploadImageToStorage(file, "hero-slides");

                      commit({
                        ...data,
                        club: {
                          ...(data.club || {}),
                          heroSlides: [
                            ...((data.club?.heroSlides || []).filter(Boolean)),
                            uploaded.url,
                          ],
                        },
                      });

                      e.target.value = "";
                    } catch (err) {
                      console.error(err);
                      alert("Failed to upload hero slide.");
                    }
                  }}
                />
              </label>

              <button className="btn" onClick={editHeroSlides}>
                Edit Hero Slides
              </button>

              <span className="badge">
                <span className="dot" />
                {(data.club?.heroSlides || []).length} custom slide(s)
              </span>
            </div>

            <div className="muted" style={{ marginTop: 12 }}>
              Uploaded images will be added directly to the homepage hero slider.
            </div>

            {(data.club?.heroSlides || []).length > 0 ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: 12,
                  marginTop: 16,
                }}
              >
                {(data.club?.heroSlides || []).map((src, idx) => (
                  <div
                    key={`${src}-${idx}`}
                    className="card"
                    style={{ margin: 0, padding: 10 }}
                  >
                    <img
                      src={src}
                      alt={`Hero Slide ${idx + 1}`}
                      style={{
                        width: "100%",
                        height: 120,
                        objectFit: "cover",
                        borderRadius: 12,
                        display: "block",
                        marginBottom: 10,
                      }}
                    />

                    <div
                      className="row"
                      style={{ justifyContent: "space-between", alignItems: "center" }}
                    >
                      <span className="muted">Slide {idx + 1}</span>

                      <button
                        className="btn danger"
                        onClick={() => {
                          if (!confirm("Delete this hero slide?")) return;

                          commit({
                            ...data,
                            club: {
                              ...(data.club || {}),
                              heroSlides: (data.club?.heroSlides || []).filter(
                                (_, i) => i !== idx
                              ),
                            },
                          });
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </AdminCollapse>

          <AdminCollapse
            title="WhatsApp Settings"
            subtitle="Local provider settings for MSG91 integration."
          >

            <div className="grid" style={{ marginTop: 8 }}>
              <div className="cols-3">
                <div className="muted">Provider</div>
                <div style={{ fontWeight: 800, marginTop: 6 }}>
                  {whatsappSettings.provider || "msg91"}
                </div>
              </div>

              <div className="cols-3">
                <div className="muted">Sender Number</div>
                <div style={{ fontWeight: 800, marginTop: 6 }}>
                  {whatsappSettings.senderNumber || "—"}
                </div>
              </div>

              <div className="cols-3">
                <div className="muted">Sender Label</div>
                <div style={{ fontWeight: 800, marginTop: 6 }}>
                  {whatsappSettings.senderLabel || "—"}
                </div>
              </div>

              <div className="cols-3">
                <div className="muted">Auth Key</div>
                <div style={{ fontWeight: 800, marginTop: 6 }}>
                  {whatsappSettings.authKey ? "Saved" : "Not set"}
                </div>
              </div>

              <div className="cols-3">
                <div className="muted">Q Shop Success</div>
                <div style={{ fontWeight: 800, marginTop: 6 }}>
                  {whatsappSettings.qshopSuccessTemplate || "—"}
                </div>
              </div>

              <div className="cols-3">
                <div className="muted">Q Shop Failed</div>
                <div style={{ fontWeight: 800, marginTop: 6 }}>
                  {whatsappSettings.qshopFailedTemplate || "—"}
                </div>
              </div>

              <div className="cols-3">
                <div className="muted">Booking Success</div>
                <div style={{ fontWeight: 800, marginTop: 6 }}>
                  {whatsappSettings.bookingSuccessTemplate || "—"}
                </div>
              </div>

              <div className="cols-3">
                <div className="muted">Booking Failed</div>
                <div style={{ fontWeight: 800, marginTop: 6 }}>
                  {whatsappSettings.bookingFailedTemplate || "—"}
                </div>
              </div>

              <div className="cols-3">
                <div className="muted">Membership Success</div>
                <div style={{ fontWeight: 800, marginTop: 6 }}>
                  {whatsappSettings.membershipSuccessTemplate || "—"}
                </div>
              </div>

              <div className="cols-3">
                <div className="muted">Membership Failed</div>
                <div style={{ fontWeight: 800, marginTop: 6 }}>
                  {whatsappSettings.membershipFailedTemplate || "—"}
                </div>
              </div>

              <div className="cols-3">
                <div className="muted">OTP Template</div>
                <div style={{ fontWeight: 800, marginTop: 6 }}>
                  {whatsappSettings.otpTemplate || "—"}
                </div>
              </div>

              <div className="cols-3">
                <div className="muted">Tournament Success</div>
                <div style={{ fontWeight: 800, marginTop: 6 }}>
                  {whatsappSettings.tournamentSuccessTemplate || "—"}
                </div>
              </div>

              <div className="cols-3">
                <div className="muted">Tournament Failed</div>
                <div style={{ fontWeight: 800, marginTop: 6 }}>
                  {whatsappSettings.tournamentFailedTemplate || "—"}
                </div>
              </div>

              <div className="cols-3">
                <div className="muted">Food Success</div>
                <div style={{ fontWeight: 800, marginTop: 6 }}>
                  {whatsappSettings.foodSuccessTemplate || "—"}
                </div>
              </div>

              <div className="cols-3">
                <div className="muted">Food Failed</div>
                <div style={{ fontWeight: 800, marginTop: 6 }}>
                  {whatsappSettings.foodFailedTemplate || "—"}
                </div>
              </div>
              <div className="cols-3">
  <div className="muted">Job Application Received</div>
  
  <div style={{ fontWeight: 800, marginTop: 6 }}>
    {whatsappSettings.jobApplicationReceivedTemplate || "—"}
  </div>
</div>
<div className="cols-3">
  <div className="muted">Job Interview Call</div>
  <div style={{ fontWeight: 800, marginTop: 6 }}>
    {whatsappSettings.jobInterviewCallTemplate || "—"}
  </div>
</div>
            </div>

            <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn secondary"
                type="button"
                onClick={() => {
                  const provider = prompt(
                    "WhatsApp provider:",
                    whatsappSettings.provider || "msg91"
                  );
                  if (provider === null) return;

                  const senderNumber = prompt(
                    "Sender WhatsApp number:",
                    whatsappSettings.senderNumber || ""
                  );
                  if (senderNumber === null) return;

                  const senderLabel = prompt(
                    "Sender label / business display name:",
                    whatsappSettings.senderLabel || ""
                  );
                  if (senderLabel === null) return;

                  const authKey = prompt(
                    "Provider auth key / API key:",
                    whatsappSettings.authKey || ""
                  );
                  if (authKey === null) return;

                  const qshopSuccessTemplate = prompt(
                    "Q Shop SUCCESS template name:",
                    whatsappSettings.qshopSuccessTemplate || ""
                  );
                  if (qshopSuccessTemplate === null) return;

                  const qshopFailedTemplate = prompt(
                    "Q Shop FAILED template name:",
                    whatsappSettings.qshopFailedTemplate || ""
                  );
                  if (qshopFailedTemplate === null) return;

                  const bookingSuccessTemplate = prompt(
                    "Booking SUCCESS template name:",
                    whatsappSettings.bookingSuccessTemplate || ""
                  );
                  if (bookingSuccessTemplate === null) return;

                  const bookingFailedTemplate = prompt(
                    "Booking FAILED template name:",
                    whatsappSettings.bookingFailedTemplate || ""
                  );
                  if (bookingFailedTemplate === null) return;

                  const membershipSuccessTemplate = prompt(
                    "Membership SUCCESS template name:",
                    whatsappSettings.membershipSuccessTemplate || ""
                  );
                  if (membershipSuccessTemplate === null) return;

                  const membershipFailedTemplate = prompt(
                    "Membership FAILED template name:",
                    whatsappSettings.membershipFailedTemplate || ""
                  );
                  if (membershipFailedTemplate === null) return;

                  const otpTemplate = prompt(
                    "OTP template name:",
                    whatsappSettings.otpTemplate || ""
                  );
                  if (otpTemplate === null) return;

                  const tournamentSuccessTemplate = prompt(
                    "Tournament SUCCESS template name:",
                    whatsappSettings.tournamentSuccessTemplate || ""
                  );
                  if (tournamentSuccessTemplate === null) return;

                  const tournamentFailedTemplate = prompt(
                    "Tournament FAILED template name:",
                    whatsappSettings.tournamentFailedTemplate || ""
                  );
                  if (tournamentFailedTemplate === null) return;

                  const foodSuccessTemplate = prompt(
                    "Food SUCCESS template name:",
                    whatsappSettings.foodSuccessTemplate || ""
                  );
                  if (foodSuccessTemplate === null) return;

                  const foodFailedTemplate = prompt(
                    "Food FAILED template name:",
                    whatsappSettings.foodFailedTemplate || ""
                  );
                  if (foodFailedTemplate === null) return;
                  const jobApplicationReceivedTemplate = prompt(
  "Job Application Received template name:",
  whatsappSettings.jobApplicationReceivedTemplate || ""
);
if (jobApplicationReceivedTemplate === null) return;
const jobInterviewCallTemplate = prompt(
  "Job Interview Call template name:",
  whatsappSettings.jobInterviewCallTemplate || ""
);
if (jobInterviewCallTemplate === null) return;

                  persistWhatsappSettings({
                    provider,
                    senderNumber,
                    senderLabel,
                    authKey,
                    qshopSuccessTemplate,
                    qshopFailedTemplate,
                    bookingSuccessTemplate,
                    bookingFailedTemplate,
                    membershipSuccessTemplate,
                    membershipFailedTemplate,
                    otpTemplate,
                    tournamentSuccessTemplate,
                    tournamentFailedTemplate,
                    foodSuccessTemplate,
                    foodFailedTemplate,
                    jobApplicationReceivedTemplate,
                    jobInterviewCallTemplate,
                  });

                  alert("WhatsApp settings saved persistently.");
                }}
              >
                Edit Settings
              </button>

              <button
                className="btn danger"
                type="button"
                onClick={() => {
                  persistWhatsappSettings({});
alert("WhatsApp settings cleared.");
window.location.reload();
                }}
              >
                Clear Settings
              </button>
            </div>
          </AdminCollapse>

          <AdminCollapse
            title="WhatsApp Draft Tester"
            subtitle="Preview the latest saved WhatsApp draft or live-send payload."
          >

            <div
              style={{
                marginBottom: 12,
                padding: 12,
                border: "1px solid rgba(255,255,255,.10)",
                borderRadius: 14,
                background: "rgba(255,255,255,.03)",
              }}
            >
              <div className="muted">WhatsApp Mode</div>

              <div style={{ marginTop: 6, fontWeight: 800 }}>
                {whatsappMode === "disabled"
                  ? "Disabled"
                  : whatsappMode === "live"
                  ? "Live Send"
                  : "Draft Only"}
              </div>

              <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => {
                    persistWhatsappMode("draft_only")
                    alert("WhatsApp mode set to Draft Only.");
                    window.location.reload();
                  }}
                >
                  Set Draft Only
                </button>

                <button
                  className="btn primary"
                  type="button"
                  onClick={() => {
                    persistWhatsappMode("live")
                    alert("WhatsApp mode set to Live Send.");
                    window.location.reload();
                  }}
                >
                  Set Live Send
                </button>

                <button
                  className="btn danger"
                  type="button"
                  onClick={() => {
                    persistWhatsappMode("disabled")
                    alert("WhatsApp mode set to Disabled.");
                    window.location.reload();
                  }}
                >
                  Disable WhatsApp
                </button>

                <button
                  className="btn primary"
                  type="button"
                  onClick={createMembershipTestDraft}
                >
                  Test Membership
                </button>

                <button
                  className="btn primary"
                  type="button"
                  onClick={createTournamentSuccessTestDraft}
                >
                  Test Tournament Success
                </button>

                <button
                  className="btn danger"
                  type="button"
                  onClick={createTournamentFailedTestDraft}
                >
                  Test Tournament Failed
                </button>

                <button
                  className="btn primary"
                  type="button"
                  onClick={createFoodSuccessTestDraft}
                >
                  Test Food Success
                </button>

                <button
                  className="btn danger"
                  type="button"
                  onClick={createFoodFailedTestDraft}
                >
                  Test Food Failed
                </button>

                <button
                  className="btn primary"
                  type="button"
                  onClick={createBookingTestDraft}
                >
                  Test Booking
                </button>
              </div>
            </div>

            {!hasWhatsappDraft ? (
              <div className="muted">No saved WhatsApp draft found yet.</div>
            ) : (
              <>
                <div className="grid" style={{ marginTop: 8 }}>
                  <div className="cols-4">
                    <div className="muted">Label</div>
                    <div style={{ fontWeight: 800, marginTop: 6 }}>
                      {lastWhatsappDraft.label || "—"}
                    </div>
                  </div>

                  <div className="cols-3">
                    <div className="muted">Phone</div>
                    <div style={{ fontWeight: 800, marginTop: 6 }}>
                      {lastWhatsappDraft.phone || "—"}
                    </div>
                  </div>

                  <div className="cols-3">
                    <div className="muted">Template</div>
                    <div style={{ fontWeight: 800, marginTop: 6 }}>
                      {lastWhatsappDraft.templateName || "—"}
                    </div>
                  </div>

                  <div className="cols-3">
                    <div className="muted">Provider</div>
                    <div style={{ fontWeight: 800, marginTop: 6 }}>
                      {lastWhatsappDraft.provider || "—"}
                    </div>
                  </div>

                  <div className="cols-3">
                    <div className="muted">MSG91 Payload</div>
                    <div style={{ marginTop: 6, fontWeight: 800 }}>
                      {lastWhatsappDraft.msg91Payload ? "Ready" : "Not ready"}
                    </div>
                  </div>

                  <div className="cols-12">
                    <div className="muted">Opt-out Status</div>
                    <div style={{ marginTop: 6, fontWeight: 800 }}>
                      {currentDraftIsOptedOut
                        ? "This number is opted out"
                        : "This number is allowed"}
                    </div>
                  </div>

                  <div className="cols-12">
                    <div className="muted" style={{ marginBottom: 6 }}>
                      Message Preview
                    </div>
                    <textarea
                      readOnly
                      value={lastWhatsappDraft.text || ""}
                      style={{ minHeight: 140 }}
                    />
                  </div>

                  <div className="cols-12">
                    <div className="muted" style={{ marginBottom: 6 }}>
                      MSG91 Payload Preview
                    </div>
                    <textarea
                      readOnly
                      value={
                        lastWhatsappDraft.msg91Payload
                          ? JSON.stringify(lastWhatsappDraft.msg91Payload, null, 2)
                          : ""
                      }
                      style={{ minHeight: 220 }}
                    />
                  </div>
                </div>

                <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
                  <button
                    className="btn primary"
                    type="button"
                    onClick={() => {
                      if (!lastWhatsappDraft?.url) {
                        alert("WhatsApp draft link is not ready.");
                        return;
                      }
                      if (currentDraftIsOptedOut) {
                        alert("This number is opted out from WhatsApp messages.");
                        return;
                      }
                      window.open(lastWhatsappDraft.url, "_blank", "noopener,noreferrer");
                    }}
                  >
                    Open in WhatsApp
                  </button>

                  <button
                    className="btn secondary"
                    type="button"
                    onClick={copyMsg91Payload}
                  >
                    Copy MSG91 Payload
                  </button>

                  <button
                    className="btn secondary"
                    type="button"
                    onClick={sendCurrentDraftToDryRunApi}
                  >
                    Send to Dry Run API
                  </button>

                  <button
                    className="btn warn"
                    type="button"
                    onClick={() => {
                      if (!currentDraftPhone) {
                        alert("No valid WhatsApp number found.");
                        return;
                      }

                      const optOuts = getWhatsappOptOuts();

                      if (optOuts.includes(currentDraftPhone)) {
                        persistWhatsappOptOuts(optOuts.filter((x) => x !== currentDraftPhone));
                        alert("Number removed from opt-out list.");
                      } else {
                        persistWhatsappOptOuts([...optOuts, currentDraftPhone]);
                        alert("Number added to opt-out list.");
                      }

                      window.location.reload();
                    }}
                  >
                    {currentDraftIsOptedOut ? "Remove Opt-Out" : "Opt Out This Number"}
                  </button>

                  <button
                    className="btn danger"
                    type="button"
                    onClick={() => {
                      localStorage.removeItem("qclub_last_whatsapp_draft");
                      window.location.reload();
                    }}
                  >
                    Clear Saved Draft
                  </button>
                </div>
              </>
            )}
          </AdminCollapse>

          <AdminCollapse
            title="WhatsApp Opt-Out List"
            subtitle="Numbers in this list will not be opened or saved as WhatsApp drafts."
          >

            {whatsappOptOuts.length === 0 ? (
              <div className="muted">No opted-out numbers yet.</div>
            ) : (
              <div className="grid" style={{ marginTop: 8 }}>
                {whatsappOptOuts.map((phone) => (
                  <div
                    key={phone}
                    className="cols-4"
                    style={{
                      border: "1px solid rgba(255,255,255,.10)",
                      borderRadius: 14,
                      padding: 12,
                      background: "rgba(255,255,255,.03)",
                    }}
                  >
                    <div className="muted">Phone</div>
                    <div style={{ fontWeight: 800, marginTop: 6 }}>{phone}</div>

                    <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
                      <button
                        className="btn danger"
                        type="button"
                        onClick={() => {
                          persistWhatsappOptOuts(
                            whatsappOptOuts.filter((x) => x !== phone)
                          );
                          alert("Number removed from opt-out list.");
                          window.location.reload();
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="row" style={{ marginTop: 14, gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn secondary"
                type="button"
                onClick={() => {
                  const phone = prompt("Enter WhatsApp number to opt out:", "");
                  if (!phone) return;

                  const normalized = normalizeWhatsappNumber(phone);
                  if (!normalized) {
                    alert("Invalid number.");
                    return;
                  }

                  persistWhatsappOptOuts([...whatsappOptOuts, normalized]);
                  alert("Number added to opt-out list.");
                  window.location.reload();
                }}
              >
                + Add Number Manually
              </button>
            </div>
          </AdminCollapse>
          <AdminCollapse
  title="Job Applications"
  subtitle={`${data.jobApplications?.length || 0} applications received`}
>
  <div className="grid" style={{ marginBottom: 12 }}>
  <div className="card cols-3" style={{ margin: 0 }}>
    <div className="muted">New</div>
    <div className="bigStat">{jobCounts.new}</div>
  </div>

  <div className="card cols-3" style={{ margin: 0 }}>
    <div className="muted">Shortlisted</div>
    <div className="bigStat">{jobCounts.shortlisted}</div>
  </div>

  <div className="card cols-3" style={{ margin: 0 }}>
    <div className="muted">Selected</div>
    <div className="bigStat">{jobCounts.selected}</div>
  </div>

  <div className="card cols-3" style={{ margin: 0 }}>
    <div className="muted">Rejected</div>
    <div className="bigStat">{jobCounts.rejected}</div>
  </div>

  <label className="cols-12">
    Search Applications
    <input
      value={jobSearch}
      onChange={(e) => setJobSearch(e.target.value)}
      placeholder="Search by name, phone, email, application ID or position"
    />
  </label>
</div>
  <div style={{ marginBottom: 12 }}>
    <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <input
        type="checkbox"
        checked={!!data.jobSettings?.acceptingApplications}
        onChange={(e) =>
          commit({
            ...data,
            jobSettings: {
              ...(data.jobSettings || {}),
              acceptingApplications: e.target.checked,
            },
          })
        }
      />
      Accepting Job Applications
    </label>
  </div>

  {filteredJobApplications.map((app) => (
    <div
      key={app.id}
      className="card"
      style={{ marginBottom: 12 }}
    >
      <div><b>{app.name}</b></div>
      <div>Application ID: {app.applicationId || app.id || "—"}</div>

<div>Position: {app.position || "—"}</div>

<div>Phone: {app.phone || "—"}</div>
<div>Email: {app.email || "—"}</div>

<div>Age: {app.age || "—"}</div>

<div>Address: {app.address || "—"}</div>

<div>Aadhaar: {app.aadhaarNumber || "—"}</div>
<div>PAN: {app.panNumber || "—"}</div>

<div>Education: {app.education || "—"}</div>

<div>Languages: {app.languages || "—"}</div>

<div>Experience: {app.experience || "—"}</div>

<div>Smartphone/Computer: {app.techComfort || "—"}</div>

<div>Evening Duty: {app.eveningDuty || "—"}</div>

<div>Cleaning Duties: {app.cleaningDuty || "—"}</div>

<div>Tobacco/Gutka Use: {app.tobaccoUse || "—"}</div>

<div>
  Applied On: {app.createdAt
    ? new Date(app.createdAt).toLocaleString()
    : "—"}
</div>

      {app.photo?.url && (
  <img
    src={app.photo.url}
          alt=""
          style={{
            width: 120,
            height: 120,
            objectFit: "cover",
            borderRadius: 8,
            marginTop: 8,
          }}
        />
      )}
      <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>

  {app.photo?.url && (
    <a
      href={app.photo.url}
      target="_blank"
      rel="noreferrer"
      className="btn"
    >
      View Photo
    </a>
  )}

  {app.aadhaarFile?.url && (
    <a
      href={app.aadhaarFile.url}
      target="_blank"
      rel="noreferrer"
      className="btn"
    >
      View Aadhaar
    </a>
  )}

  {app.panFile?.url && (
    <a
      href={app.panFile.url}
      target="_blank"
      rel="noreferrer"
      className="btn"
    >
      View PAN
    </a>
  )}

</div>

      <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>

        <button
          onClick={() =>
            commit({
              ...data,
              jobApplications: data.jobApplications.map((x) =>
                x.id === app.id
                  ? { ...x, status: "Shortlisted" }
                  : x
              ),
            })
          }
        >
          Shortlist
        </button>
        <button
  className="btn primary"
  type="button"
  onClick={async () => {
    const interviewDate = prompt("Interview Date:", "");
    if (interviewDate === null) return;

    const interviewTime = prompt("Interview Time:", "");
    if (interviewTime === null) return;

    const settings = getWhatsappSettings();
    const templateName = settings.jobInterviewCallTemplate || "job_interview_call";

    const res = await fetch("/api/whatsapp-send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        authKey: settings.authKey,
        senderNumber: settings.senderNumber,
        senderLabel: settings.senderLabel,
        phone: normalizeWhatsappNumber(app.phone),
        templateName,
        templateParams: [
          app.name || "Applicant",
          app.applicationId || app.id || "—",
          interviewDate,
          interviewTime,
        ],
        label: "job_interview_call",
        text: `Hello ${app.name || "Applicant"}, you have been shortlisted for interview at The Q Club Pasighat. Application ID: ${app.applicationId || app.id || "—"}. Interview Date: ${interviewDate}. Interview Time: ${interviewTime}.`,
      }),
    });

    if (!res.ok) {
      alert("Interview WhatsApp failed. On localhost this is expected. Test after Vercel deploy.");
      return;
    }

    commit({
      ...data,
      jobApplications: data.jobApplications.map((x) =>
        x.id === app.id
          ? {
              ...x,
              status: "Shortlisted",
              interviewDate,
              interviewTime,
              interviewWhatsappSentAt: new Date().toISOString(),
            }
          : x
      ),
    });

    alert("Interview WhatsApp sent and applicant marked shortlisted.");
  }}
>
  Send Interview Call
</button>

        <button
          onClick={() =>
            commit({
              ...data,
              jobApplications: data.jobApplications.map((x) =>
                x.id === app.id
                  ? { ...x, status: "Selected" }
                  : x
              ),
            })
          }
        >
          Select
        </button>

        <button
          onClick={() =>
            commit({
              ...data,
              jobApplications: data.jobApplications.map((x) =>
                x.id === app.id
                  ? { ...x, status: "Rejected" }
                  : x
              ),
            })
          }
        >
          Reject
        </button>

        <button
          onClick={() => {
            if (!window.confirm("Delete application?")) return;

            commit({
              ...data,
              jobApplications: data.jobApplications.filter(
                (x) => x.id !== app.id
              ),
            });
          }}
        >
          Delete
        </button>
      </div>

      <div style={{ marginTop: 8 }}>
        Status:{" "}
<span
  className={
    String(app.status || "new").toLowerCase().includes("select")
      ? "badge"
      : String(app.status || "new").toLowerCase().includes("reject")
      ? "badge danger"
      : String(app.status || "new").toLowerCase().includes("shortlist")
      ? "badge warn"
      : "badge"
  }
>
  {app.status || "new"}
</span>
      </div>
    </div>
  ))}
</AdminCollapse>
<AdminCollapse
            title="Hidden Admin Pages / Audit Links"
            subtitle="Internal and semi-hidden pages for audit, monitoring and quick access."
          >

  <div className="grid" style={{ marginTop: 12 }}>
    {hiddenAdminPages.map((section) => (
      <div className="card cols-6" key={section.group} style={{ margin: 0 }}>
        <h3 style={{ marginTop: 0 }}>{section.group}</h3>

        <div style={{ display: "grid", gap: 8 }}>
          {section.pages.map((page) => (
            <a
  key={page.path}
  className="btn"
  href={page.path}
  style={{
    width: "100%",
    justifyContent: "flex-start",
    textAlign: "left",
    whiteSpace: "normal",
    lineHeight: 1.25,
  }}
>
  <span>
    <b>{page.label}</b>
    <br />
    <span className="muted">{page.path} — {page.note}</span>
  </span>
</a>
          ))}
        </div>
      </div>
    ))}
  </div>
          </AdminCollapse>
          <AdminCollapse
            title="Quick Admin Actions"
            subtitle="Frequently used admin shortcuts."
            defaultOpen
          >
            <div className="grid" style={{ marginTop: 12 }}>
              <div className="cols-3">
                <Link className="btn primary" to="/live" style={{ width: "100%" }}>
                  Live Matches
                </Link>
              </div>
              <div className="cols-3">
                <Link className="btn primary" to="/book" style={{ width: "100%" }}>
                  Bookings
                </Link>
              </div>
              <div className="cols-3">
                <Link className="btn primary" to="/membership" style={{ width: "100%" }}>
                  Membership
                </Link>
              </div>
              <div className="cols-3">
                <Link className="btn primary" to="/players" style={{ width: "100%" }}>
                  Players
                </Link>
              </div>
              <div className="cols-3">
                <Link className="btn primary" to="/photos" style={{ width: "100%" }}>
                  Photos
                </Link>
              </div>
              <div className="cols-3">
                <Link className="btn primary" to="/tournaments" style={{ width: "100%" }}>
                  Tournaments
                </Link>
              </div>
              <div className="cols-3">
                <Link className="btn primary" to="/fixtures" style={{ width: "100%" }}>
                  Fixtures
                </Link>
              </div>
              <div className="cols-3">
                <Link className="btn primary" to="/leaderboard" style={{ width: "100%" }}>
                  Leaderboards
                </Link>
              </div>
              <div className="cols-3">
                <Link className="btn primary" to="/" style={{ width: "100%" }}>
                  Home
                </Link>
              </div>
            </div>
          </AdminCollapse>
        </div>
      </div>
    </>
  );
}
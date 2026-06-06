const MSG91_WHATSAPP_URL =
  "https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/";

function env(name = "") {
  return String(process.env[name] || "").trim();
}

function getMode() {
  const raw = env("MSG91_WHATSAPP_MODE") || "dry_run";
  return raw.toLowerCase() === "live" ? "live" : "dry_run";
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

function cleanText(value = "", maxLength = 1200) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function readProvider(body) {
  return cleanText(body?.provider || body?.meta?.provider || "msg91", 40).toLowerCase();
}

function readLabel(body) {
  return cleanText(
    body?.messageType ||
      body?.label ||
      body?.meta?.label ||
      body?.msg91Payload?.meta?.label ||
      "",
    120
  ).toLowerCase();
}

function readRequestedTemplateName(body) {
  return cleanText(
    body?.templateName ||
      body?.payload?.template?.name ||
      body?.msg91Payload?.payload?.template?.name ||
      "",
    120
  );
}

function readTemplateParams(body) {
  if (Array.isArray(body?.templateParams)) {
    return body.templateParams.map((x) => cleanText(x)).filter(Boolean);
  }

  const nested =
    body?.msg91Payload?.payload?.template?.components ||
    body?.payload?.template?.components ||
    [];

  if (!Array.isArray(nested)) return [];

  return nested
    .flatMap((component) => component?.parameters || [])
    .map((param) => cleanText(param?.text || param?.value || ""))
    .filter(Boolean);
}

const MSG91_TEMPLATE_PARAM_SPECS = {
  food_success: {
    params: ["customer_name", "food_order_no", "amount"],
    fromInputIndexes: [0, 1, 3],
  },
  food_failed: {
    params: ["customer_name", "food_order_no", "amount"],
  },
  qshop_order_success: {
  params: ["customer_name", "qshop_order_no", "qshop_items", "amount"],
},
  qshop_order_failed: {
    params: ["customer_name", "qshop_order_no", "amount"],
  },
  shop_success: {
  params: ["customer_name", "qshop_order_no", "qshop_items", "amount"],
},
  shop_failed: {
    params: ["customer_name", "qshop_order_no", "amount"],
  },
  booking_success: {
    params: ["customer_name", "booking_ref", "table_label", "booking_date", "booking_slot"],
  },
  booking_failed: {
    params: ["customer_name", "booking_ref", "table_label", "booking_date", "booking_slot"],
  },
  membership_success: {
    params: ["customer_name", "tier", "activated_at", "valid_until"],
  },
  membership_failed: {
    params: ["customer_name", "tier", "amount"],
  },
  tournament_success: {
    params: ["customer_name", "tournament_name", "tournament_fee"],
  },
  tournament_failed: {
    params: ["customer_name", "tournament_name", "tournament_fee"],
  },
  "q chase final result": {
  params: [
    "player_name",
    "game_no",
    "table_name",
    "date_time",
    "players_line",
    "multiplier",
    "raw_snooker_points",
    "handicap_adjustment",
    "adjusted_snooker_points",
    "q_points",
    "final_score",
    "rank",
    "winner_line",
    "ranking_line",
  ],
},

"kitty final result": {
  params: [
    "player_name",
    "game_no",
    "table_name",
    "game_type",
    "date",
    "start_time",
    "end_time",
    "duration",
    "winner",
    "kitty_entry",
    "ball_out_penalty",
    "kitty_add_on",
    "ball_out_pays",
    "not_out_pays",
    "your_result",
    "kitty_points_won_by_winner",
    "winner_net_kitty_points",
    "player_summary",
    "table_charge",
    "final_locked_at",
  ],
},
};

function normalizeTemplateParamsForLabel(label = "", templateParams = []) {
  const spec = MSG91_TEMPLATE_PARAM_SPECS[label] || null;
  if (!spec) return templateParams;

  const sourceIndexes =
    Array.isArray(spec.fromInputIndexes) && spec.fromInputIndexes.length
      ? spec.fromInputIndexes
      : spec.params.map((_, index) => index);

  if (label === "food_success" && templateParams.length === spec.params.length) {
    return templateParams.map((value) => cleanText(value || "—") || "—");
  }

  return sourceIndexes.map((index) => cleanText(templateParams[index] || "—") || "—");
}

function templateAllowlist() {
  return {
    membership_success: env("MSG91_MEMBERSHIP_SUCCESS_TEMPLATE"),
    membership_failed: env("MSG91_MEMBERSHIP_FAILED_TEMPLATE"),
    tournament_success: env("MSG91_TOURNAMENT_SUCCESS_TEMPLATE"),
    tournament_failed: env("MSG91_TOURNAMENT_FAILED_TEMPLATE"),
    food_success: env("MSG91_FOOD_SUCCESS_TEMPLATE") || "food_success_items",
    food_failed: env("MSG91_FOOD_FAILED_TEMPLATE"),
    booking_success: env("MSG91_BOOKING_SUCCESS_TEMPLATE"),
    booking_failed: env("MSG91_BOOKING_FAILED_TEMPLATE"),
    qshop_order_success: env("MSG91_QSHOP_SUCCESS_TEMPLATE"),
    qshop_order_failed: env("MSG91_QSHOP_FAILED_TEMPLATE"),
    shop_success: env("MSG91_QSHOP_SUCCESS_TEMPLATE"),
    shop_failed: env("MSG91_QSHOP_FAILED_TEMPLATE"),
    otp: env("MSG91_OTP_TEMPLATE"),
    guest_otp: env("MSG91_OTP_TEMPLATE"),
    otp_success: env("MSG91_OTP_TEMPLATE"),
    job_application_received:
      env("MSG91_JOB_APPLICATION_RECEIVED_TEMPLATE") || "job_application_received",
    job_interview_call:
  env("MSG91_JOB_INTERVIEW_CALL_TEMPLATE") || "job_interview_call",

"q chase final result":
  env("MSG91_QCHASE_RESULT_HANDICAP_TEMPLATE") || "qchase_result_handicap_v2",
  "kitty final result":
  env("MSG91_KITTY_RESULT_TEMPLATE") || "kitty_result_settlement",
  };
}

function findParamSpecLabelForTemplateName(templateName = "") {
  const cleanTemplateName = cleanText(templateName, 120);
  if (!cleanTemplateName) return "";
  if (MSG91_TEMPLATE_PARAM_SPECS[cleanTemplateName]) return cleanTemplateName;

  const allowlist = templateAllowlist();
  const found = Object.entries(allowlist).find(([, allowedTemplate]) => {
    return allowedTemplate && allowedTemplate === cleanTemplateName;
  });

  return MSG91_TEMPLATE_PARAM_SPECS[found?.[0]] ? found[0] : "";
}

function resolveTemplateName(body) {
  const label = readLabel(body);
  const requestedTemplateName = readRequestedTemplateName(body);
  const allowlist = templateAllowlist();
  const mapped = allowlist[label] || "";
  const approvedTemplates = new Set(Object.values(allowlist).filter(Boolean));

  if (mapped) {
    return {
      label,
      templateName: mapped,
      requestedTemplateName,
      allowed: true,
      source: "message_type_mapping",
    };
  }

  if (requestedTemplateName && approvedTemplates.has(requestedTemplateName)) {
    return {
      label,
      templateName: requestedTemplateName,
      requestedTemplateName,
      allowed: true,
      source: "approved_template_name",
    };
  }

  return {
    label,
    templateName: "",
    requestedTemplateName,
    allowed: false,
    source: "",
  };
}

function buildMsg91RequestBody({ phone, templateName, templateParams }) {
  return {
    integrated_number: env("MSG91_SENDER_NUMBER"),
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
                  text: cleanText(value),
                })),
              },
            ]
          : [],
      },
    },
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed",
    });
  }

  try {
    const body = req.body || {};
    const mode = getMode();
    const phone = normalizePhone(body?.phone || body?.recipient?.phone || "");
    const provider = readProvider(body);
    const templateResolution = resolveTemplateName(body);
    const rawTemplateParams = readTemplateParams(body);
    const paramSpecLabel =
      templateResolution.label || findParamSpecLabelForTemplateName(templateResolution.templateName);
    const templateParams = normalizeTemplateParamsForLabel(paramSpecLabel, rawTemplateParams);
    const authKey = env("MSG91_AUTH_KEY");
    const senderNumber = env("MSG91_SENDER_NUMBER");

    const errors = [];

    if (provider !== "msg91") errors.push("Unsupported provider");
    if (!phone) errors.push("Missing phone");
    if (!senderNumber) errors.push("MSG91_SENDER_NUMBER is missing on server");
    if (!templateResolution.allowed) errors.push("Template is not approved for this message type");
    if (!templateResolution.templateName) errors.push("Missing approved template name");

    if (errors.length) {
      return res.status(400).json({
        ok: false,
        dryRun: mode !== "live",
        error: "Validation failed",
        errors,
        validated: {
          phone,
          provider,
          label: templateResolution.label,
          requestedTemplateName: templateResolution.requestedTemplateName,
          templateName: templateResolution.templateName,
          templateSource: templateResolution.source,
          templateParamsCount: templateParams.length,
          templateParamOrder: MSG91_TEMPLATE_PARAM_SPECS[paramSpecLabel]?.params || null,
          rawTemplateParamsCount: rawTemplateParams.length,
          mode,
        },
      });
    }

    const msg91RequestBody = buildMsg91RequestBody({
      phone,
      templateName: templateResolution.templateName,
      templateParams,
    });

    if (mode !== "live") {
      return res.status(200).json({
        ok: true,
        dryRun: true,
        message: "MSG91 dry-run accepted. No live send attempted.",
        validated: {
          phone,
          provider,
          label: templateResolution.label,
          templateName: templateResolution.templateName,
          templateSource: templateResolution.source,
          templateParamsCount: templateParams.length,
          templateParamOrder: MSG91_TEMPLATE_PARAM_SPECS[paramSpecLabel]?.params || null,
          rawTemplateParamsCount: rawTemplateParams.length,
          mode,
        },
      });
    }

    if (!authKey) {
      return res.status(500).json({
        ok: false,
        dryRun: false,
        error: "MSG91_AUTH_KEY is missing on server",
      });
    }

    const upstream = await fetch(MSG91_WHATSAPP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authkey: authKey,
      },
      body: JSON.stringify(msg91RequestBody),
    });

    const rawText = await upstream.text();

    let upstreamJson = null;
    try {
      upstreamJson = rawText ? JSON.parse(rawText) : null;
    } catch {
      upstreamJson = null;
    }

    return res.status(upstream.status).json({
      ok: upstream.ok,
      dryRun: false,
      message: upstream.ok ? "MSG91 live request sent." : "MSG91 live request failed.",
      validated: {
        phone,
        provider,
        label: templateResolution.label,
        templateName: templateResolution.templateName,
        templateSource: templateResolution.source,
        templateParamsCount: templateParams.length,
        templateParamOrder: MSG91_TEMPLATE_PARAM_SPECS[paramSpecLabel]?.params || null,
        rawTemplateParamsCount: rawTemplateParams.length,
        mode,
      },
      upstreamStatus: upstream.status,
      upstreamResponse: upstreamJson || rawText,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Server error",
      details: String(error?.message || error),
    });
  }
}

const MSG91_WHATSAPP_URL =
  "https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/";

function getMode() {
  const raw = String(process.env.MSG91_WHATSAPP_MODE || "dry_run").trim().toLowerCase();
  return raw === "live" ? "live" : "dry_run";
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

function readTemplateName(body) {
  return String(
    body?.templateName ||
      body?.payload?.template?.name ||
      body?.msg91Payload?.payload?.template?.name ||
      ""
  ).trim();
}

function readProvider(body) {
  return String(body?.provider || body?.meta?.provider || "msg91")
    .trim()
    .toLowerCase();
}

function buildMsg91RequestBody(body) {
  const phone = normalizePhone(body?.phone || body?.recipient?.phone || "");
  const templateName = readTemplateName(body);
  const integratedNumber = String(
    body?.integrated_number ||
      body?.senderNumber ||
      body?.msg91Payload?.integrated_number ||
      ""
  ).trim();

  return {
    integrated_number: integratedNumber,
    content_type: "template",
    payload: {
      messaging_product: "whatsapp",
      type: "template",
      template: {
        name: templateName,
        language: {
          code: "en",
          policy: "deterministic",
        },
        to_and_components: [
          {
            to: [phone],
            components: {},
          },
        ],
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
    const templateName = readTemplateName(body);

    const msg91AuthKey = String(process.env.MSG91_AUTH_KEY || "").trim();
    const msg91RequestBody = buildMsg91RequestBody(body);
    const integratedNumber = String(msg91RequestBody?.integrated_number || "").trim();

    const errors = [];

    if (!phone) errors.push("Missing phone");
    if (!provider) errors.push("Missing provider");

    if (provider === "msg91") {
      if (!templateName) errors.push("Missing template name for MSG91");
      if (!integratedNumber) errors.push("Missing integrated WhatsApp number");
    }

    if (errors.length) {
      return res.status(400).json({
        ok: false,
        dryRun: mode !== "live",
        error: "Validation failed",
        errors,
        validated: {
          phone,
          provider,
          templateName,
          integratedNumber,
          mode,
        },
        received: body,
      });
    }

    if (provider !== "msg91") {
      return res.status(400).json({
        ok: false,
        dryRun: true,
        error: "Unsupported provider",
        validated: {
          phone,
          provider,
          templateName,
          integratedNumber,
          mode,
        },
      });
    }

    if (mode !== "live") {
      return res.status(200).json({
        ok: true,
        dryRun: true,
        message: "MSG91 dry-run accepted. No live send attempted.",
        validated: {
          phone,
          provider,
          templateName,
          integratedNumber,
          mode,
        },
        wouldSendTo: MSG91_WHATSAPP_URL,
        msg91RequestBody,
      });
    }

    if (!msg91AuthKey) {
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
        authkey: msg91AuthKey,
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
      message: upstream.ok
        ? "MSG91 live request sent."
        : "MSG91 live request failed.",
      validated: {
        phone,
        provider,
        templateName,
        integratedNumber,
        mode,
      },
      msg91RequestBody,
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
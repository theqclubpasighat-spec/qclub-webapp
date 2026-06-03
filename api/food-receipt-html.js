function decodePayload(value = "") {
  try {
    const clean = String(value || "").trim();
    if (!clean) return null;

    const json = Buffer.from(clean, "base64url").toString("utf8");
    const parsed = JSON.parse(json);

    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function safeText(value = "") {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeNum(value = 0) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function formatDate(value) {
  const dt = value ? new Date(value) : new Date();
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });
}

export default function handler(req, res) {
  const receipt = decodePayload(req.query?.payload || "");

  if (!receipt) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(400).send(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Invalid Receipt</title>
        </head>
        <body style="font-family: Arial, sans-serif; padding: 12px;">
          Invalid or missing receipt payload.
        </body>
      </html>
    `);
  }

  const items = Array.isArray(receipt.items) ? receipt.items : [];
  const total = safeNum(receipt.total);

  const itemRows = items.map((item) => {
    const name = safeText(item?.name || "Item");
    const qty = safeNum(item?.qty || 0);
    const amount = safeNum(item?.lineTotal ?? (safeNum(item?.price) * qty));

    return `
      <tr>
        <td style="padding:5px 0;border-bottom:1px dashed #999;">
          ${name} × ${qty}
        </td>
        <td style="padding:5px 0;border-bottom:1px dashed #999;text-align:right;">
          ₹${amount}
        </td>
      </tr>
    `;
  }).join("");

  const html = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>The Q Club Receipt</title>
    <style>
      @page {
        size: 80mm auto;
        margin: 4mm;
      }

      html,
      body {
        margin: 0;
        padding: 0;
        background: #ffffff;
        color: #111111;
        font-family: Arial, sans-serif;
      }

      .receipt {
        width: 72mm;
        max-width: 72mm;
        margin: 0 auto;
        font-size: 12px;
        line-height: 1.35;
      }

      .center {
        text-align: center;
      }

      .club {
        font-size: 18px;
        font-weight: 900;
      }

      .dash {
        border-top: 1px dashed #111;
        margin: 8px 0;
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th {
        text-align: left;
        border-bottom: 1px solid #111;
        padding-bottom: 4px;
      }

      th:last-child {
        text-align: right;
      }

      .total {
        display: flex;
        justify-content: space-between;
        font-size: 15px;
        font-weight: 900;
      }

      .footer {
        text-align: center;
        font-weight: 700;
      }
    </style>
  </head>
  <body>
    <div class="receipt">
      <div class="center club">The Q Club</div>
      <div class="center">Pasighat</div>

      <div class="dash"></div>

      <div><b>Order No:</b> ${safeText(receipt.id || "—")}</div>
      <div><b>Date & Time:</b> ${safeText(formatDate(receipt.createdAt))}</div>
      <div><b>Name:</b> ${safeText(receipt.customerName || "—")}</div>
      <div><b>Mobile:</b> ${safeText(receipt.customerMobile || "—")}</div>
      <div><b>Status:</b> ${safeText(receipt.status || "Paid")}</div>

      <div class="dash"></div>

      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows || `
            <tr>
              <td style="padding:5px 0;border-bottom:1px dashed #999;">Item</td>
              <td style="padding:5px 0;border-bottom:1px dashed #999;text-align:right;">₹0</td>
            </tr>
          `}
        </tbody>
      </table>

      <div class="dash"></div>

      <div class="total">
        <span>Total</span>
        <span>₹${total}</span>
      </div>

      <div class="dash"></div>

      <div class="footer">Thank you for ordering at The Q Club</div>
      <div class="center" style="margin-top:6px;">Please wait for up to 15 minutes.</div>
      <div class="center" style="margin-top:4px;">
        Please collect from the counter when your name is called.
      </div>
    </div>
  </body>
</html>
`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.status(200).send(html);
}
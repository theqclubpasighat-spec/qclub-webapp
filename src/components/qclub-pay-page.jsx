import React, { useCallback, useEffect, useState } from "react";

const API_ROOT = "/api/snooker/v1";

function money(value) {
  return "₹" + Number(value || 0).toFixed(2);
}

export default function QclubPayPage() {
  const params = new URLSearchParams(window.location.search);
  const paymentId = params.get("payment_id") || "";
  const signature = params.get("sig") || "";
  const [payment, setPayment] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async function() {
    if (!paymentId || !signature) {
      setError("This payment link is incomplete.");
      return;
    }
    try {
      const response = await fetch(
        API_ROOT + "/payments/public/" + encodeURIComponent(paymentId) + "?sig=" + encodeURIComponent(signature),
        { cache: "no-store" }
      );
      const payload = await response.json().catch(function() { return null; });
      if (!response.ok) throw new Error((payload && (payload.message || payload.error)) || "Payment link unavailable.");
      setPayment(payload);
      setError("");
    } catch (err) {
      setError(err.message || "Payment link unavailable.");
    }
  }, [paymentId, signature]);

  useEffect(function() {
    refresh();
  }, [refresh]);

  useEffect(function() {
    if (!payment || payment.status !== "PENDING") return undefined;
    const timer = window.setInterval(refresh, 5000);
    return function() { window.clearInterval(timer); };
  }, [payment, refresh]);

  async function payNow() {
    if (!payment || !payment.payment_session_id) return;
    setBusy(true);
    setError("");
    try {
      if (!window.Cashfree) throw new Error("Cashfree checkout is unavailable. Please refresh and try again.");
      const cashfree = window.Cashfree({ mode: "production" });
      await cashfree.checkout({
        paymentSessionId: payment.payment_session_id,
        redirectTarget: "_self",
      });
    } catch (err) {
      setError(err.message || "Unable to open Cashfree checkout.");
      setBusy(false);
    }
  }

  const paid = payment && ["VERIFIED", "RECEIVED"].includes(payment.status);
  const pending = payment && payment.status === "PENDING" && payment.payment_session_id;

  return (
    <div style={{ minHeight: "100vh", background: "#07110c", color: "#f7fbf8", display: "grid", placeItems: "center", padding: 20, fontFamily: "Inter,system-ui,sans-serif" }}>
      <div style={{ width: "min(520px,100%)", border: "1px solid #31513f", background: "linear-gradient(155deg,#10261a,#07110c)", borderRadius: 24, padding: 24, boxShadow: "0 24px 70px rgba(0,0,0,.35)" }}>
        <div style={{ fontSize: 34 }}>🎱</div>
        <h1 style={{ margin: "8px 0 4px" }}>The Q Club Pasighat</h1>
        <div style={{ color: "#9fb3a6", marginBottom: 20 }}>Secure Cashfree payment</div>

        {error ? <div style={{ border: "1px solid #7d3434", background: "#3d1616", color: "#ffd1d1", padding: 12, borderRadius: 12, marginBottom: 14 }}>{error}</div> : null}

        {!payment && !error ? <div style={{ color: "#9fb3a6" }}>Checking payment…</div> : null}

        {payment ? (
          <>
            <div style={{ border: "1px solid #1e3a2c", background: "#09170f", borderRadius: 16, padding: 16 }}>
              <div style={{ color: "#93a89b", fontSize: 12 }}>Bill</div>
              <strong style={{ fontSize: 20 }}>{payment.bill_no || "Q Club Bill"}</strong>
              <div style={{ marginTop: 14, color: "#93a89b", fontSize: 12 }}>Amount</div>
              <strong style={{ fontSize: 30 }}>{money(payment.amount_inr)}</strong>
              <div style={{ marginTop: 14 }}>
                <span style={{ display: "inline-block", padding: "6px 9px", borderRadius: 999, background: paid ? "#0f3c26" : "#3b2d0d", color: paid ? "#90f1b9" : "#f4da87", fontWeight: 800, fontSize: 12 }}>
                  {paid ? "PAYMENT RECEIVED" : payment.status}
                </span>
              </div>
            </div>

            {pending ? (
              <button onClick={payNow} disabled={busy} style={{ width: "100%", marginTop: 16, border: "1px solid #46e596", background: "linear-gradient(135deg,#35d07f,#18a761)", color: "#031209", borderRadius: 12, padding: 14, fontWeight: 900, fontSize: 16, cursor: "pointer" }}>
                {busy ? "OPENING CASHFREE…" : "PAY SECURELY WITH CASHFREE"}
              </button>
            ) : null}

            {!pending && !paid ? <div style={{ marginTop: 16, color: "#f2d981" }}>This payment session is no longer payable. Please contact The Q Club for a fresh link.</div> : null}

            <button onClick={refresh} style={{ width: "100%", marginTop: 10, border: "1px solid #335344", background: "#13241b", color: "#f7fbf8", borderRadius: 12, padding: 12, fontWeight: 800, cursor: "pointer" }}>Check Payment Status</button>
          </>
        ) : null}

        <div style={{ color: "#73877b", fontSize: 11, lineHeight: 1.5, marginTop: 18 }}>
          Payment details are handled by Cashfree. The Q Club does not collect card or UPI credentials on this page.
        </div>
      </div>
    </div>
  );
}

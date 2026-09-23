import React, { useCallback, useEffect, useRef, useState } from "react";

const API_ROOT = "/api/snooker/v1";

function money(value) {
  return "₹" + Number(value || 0).toFixed(2);
}

function statusLabel(status) {
  const value = String(status || "PENDING").toUpperCase();
  if (["VERIFIED", "SUCCESS", "PAID", "RECEIVED"].includes(value)) return "PAYMENT VERIFIED";
  if (value === "FAILED") return "PAYMENT FAILED";
  if (value === "EXPIRED") return "PAYMENT EXPIRED";
  if (value === "CANCELLED") return "PAYMENT CANCELLED";
  return "WAITING FOR PAYMENT";
}

export default function QclubQrPage() {
  const params = new URLSearchParams(window.location.search);
  const paymentId = params.get("payment_id") || "";
  const signature = params.get("sig") || "";
  const [payment, setPayment] = useState(null);
  const [error, setError] = useState("");
  const [qrError, setQrError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const componentRef = useRef(null);
  const startedRef = useRef("");

  const refresh = useCallback(async function() {
    if (!paymentId || !signature) {
      setError("This secure QR link is incomplete.");
      return;
    }
    try {
      const response = await fetch(
        API_ROOT + "/payments/public/" + encodeURIComponent(paymentId) + "?sig=" + encodeURIComponent(signature),
        { cache: "no-store" }
      );
      const payload = await response.json().catch(function() { return null; });
      if (!response.ok) throw new Error((payload && (payload.message || payload.error)) || "Secure QR is unavailable.");
      setPayment(payload);
      setError("");
    } catch (err) {
      setError(err && err.message ? err.message : "Secure QR is unavailable.");
    }
  }, [paymentId, signature]);

  useEffect(function() {
    refresh();
  }, [refresh]);

  useEffect(function() {
    if (!payment || payment.status !== "PENDING") return undefined;
    const timer = window.setInterval(refresh, 3000);
    return function() { window.clearInterval(timer); };
  }, [payment, refresh]);

  useEffect(function() {
    if (!payment || payment.status !== "PENDING" || !payment.payment_session_id) return undefined;

    let disposed = false;
    let component = null;
    const key = payment.payment_id + ":" + payment.payment_session_id + ":" + reloadKey;

    async function mountQr() {
      try {
        setQrError("");
        if (!window.Cashfree) {
          throw new Error("Cashfree Element SDK is unavailable. Refresh this page and try again.");
        }

        const node = document.getElementById("qclub-public-cashfree-qr");
        if (!node) return;
        node.innerHTML = "";

        const cashfree = window.Cashfree({ mode: "production" });
        component = cashfree.create("upiQr", {
          values: { size: "300px" },
        });
        componentRef.current = component;

        component.on("loaderror", function(data) {
          if (disposed) return;
          const message = data && data.error && data.error.message
            ? data.error.message
            : "Cashfree could not load the secure UPI QR.";
          setQrError(message);
        });

        component.on("ready", function() {
          if (disposed || startedRef.current === key) return;
          startedRef.current = key;
          Promise.resolve(cashfree.pay({
            paymentMethod: component,
            paymentSessionId: payment.payment_session_id,
            redirect: "if_required",
            returnUrl: window.location.href,
          })).then(function(result) {
            if (disposed || !result) return;
            if (result.error) {
              setQrError(result.error.message || "Cashfree could not start the UPI QR payment.");
              return;
            }
            if (result.paymentDetails) refresh();
          }).catch(function(err) {
            if (!disposed) {
              setQrError(err && err.message ? err.message : "Cashfree could not start the UPI QR payment.");
            }
          });
        });

        component.mount("#qclub-public-cashfree-qr");
      } catch (err) {
        if (!disposed) setQrError(err && err.message ? err.message : "Secure UPI QR is unavailable.");
      }
    }

    mountQr();

    return function() {
      disposed = true;
      if (component && typeof component.unmount === "function") {
        try { component.unmount(); } catch {}
      }
      if (componentRef.current === component) componentRef.current = null;
    };
  }, [payment && payment.payment_id, payment && payment.payment_session_id, payment && payment.status, reloadKey, refresh]);

  const paid = payment && ["VERIFIED", "RECEIVED"].includes(String(payment.status || "").toUpperCase());
  const pending = payment && payment.status === "PENDING" && payment.payment_session_id;

  return (
    <div style={{ minHeight: "100vh", background: "radial-gradient(circle at top,#173524 0,#09150f 48%,#040806 100%)", color: "#f7fbf8", display: "grid", placeItems: "center", padding: 16, fontFamily: "Inter,system-ui,sans-serif" }}>
      <div style={{ width: "min(560px,100%)", border: "2px solid #d8b64e", background: "#09150f", borderRadius: 24, padding: 22, textAlign: "center", boxShadow: "0 24px 80px rgba(0,0,0,.55)" }}>
        <div style={{ color: "#d8b64e", fontSize: 12, letterSpacing: ".18em", fontWeight: 900 }}>THE Q CLUB PASIGHAT</div>
        <h1 style={{ margin: "6px 0 2px", fontSize: 28 }}>UPI PAYMENT</h1>
        <div style={{ color: "#93a89b", marginBottom: 14 }}>Secure Cashfree Element QR</div>

        {error ? <div style={{ border: "1px solid #7d3434", background: "#3d1616", color: "#ffd1d1", padding: 12, borderRadius: 12, marginBottom: 14 }}>{error}</div> : null}

        {!payment && !error ? <div style={{ color: "#9fb3a6" }}>Loading secure payment…</div> : null}

        {payment ? (
          <>
            <div style={{ fontSize: 13, color: "#93a89b" }}>{payment.bill_no || "Q Club Bill"}</div>
            <div style={{ fontSize: "clamp(40px,10vw,64px)", lineHeight: 1, fontWeight: 950, color: "#7df0ad", margin: "10px 0 16px" }}>{money(payment.amount_inr)}</div>

            {pending ? (
              <>
                <div style={{ display: "inline-flex", background: "#fff", borderRadius: 20, padding: 16, minWidth: "min(332px,86vw)", minHeight: "332px", alignItems: "center", justifyContent: "center" }}>
                  <div id="qclub-public-cashfree-qr" style={{ width: "min(300px,76vw)", minHeight: "300px", display: "grid", placeItems: "center" }} />
                </div>
                <div style={{ fontWeight: 850, fontSize: 18, marginTop: 12 }}>Scan with any UPI app</div>
              </>
            ) : null}

            {qrError ? (
              <div style={{ border: "1px solid #7d3434", background: "#3d1616", color: "#ffd1d1", padding: 10, borderRadius: 10, marginTop: 12 }}>{qrError}</div>
            ) : null}

            <div style={{
              margin: "16px auto 8px",
              borderRadius: 12,
              padding: "12px 14px",
              fontWeight: 950,
              letterSpacing: ".08em",
              background: paid ? "#0d4529" : pending ? "#122b59" : "#501c1c",
              color: paid ? "#8df0b7" : pending ? "#9cc6ff" : "#ffb0b0",
            }}>
              {statusLabel(payment.status)}
            </div>

            {!pending && !paid ? <div style={{ color: "#f2d981", marginTop: 10 }}>This Cashfree payment session is no longer payable. Create a fresh UPI payment from Q Club Ledger.</div> : null}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center", marginTop: 16 }}>
              <button onClick={refresh} style={{ border: "1px solid #335344", background: "#13241b", color: "#f7fbf8", borderRadius: 11, padding: "11px 14px", fontWeight: 800, cursor: "pointer" }}>Check Status</button>
              {pending ? <button onClick={function() { startedRef.current = ""; setReloadKey(function(v) { return v + 1; }); }} style={{ border: "1px solid #d8b64e", background: "#3b2d0d", color: "#f4da87", borderRadius: 11, padding: "11px 14px", fontWeight: 800, cursor: "pointer" }}>Reload Secure QR</button> : null}
            </div>
          </>
        ) : null}

        <div style={{ color: "#73877b", fontSize: 11, lineHeight: 1.5, marginTop: 18 }}>
          The QR is rendered directly by Cashfree Element SDK. The Q Club does not create or store a static UPI QR.
        </div>
      </div>
    </div>
  );
}

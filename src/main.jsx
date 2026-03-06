import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from 'virtual:pwa-register'
import App from "./App.jsx";
import "./styles.css";

// PWA service worker
// During cloud-sync debugging, keep this disabled to avoid stale cached bundles.
// Re-enable after confirming sync is stable.
// registerSW({
//   immediate: true,
// })

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

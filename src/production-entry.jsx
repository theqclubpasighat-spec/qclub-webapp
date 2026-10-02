import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./styles.css";
import "./v2-live/v2-live.css";
import "./v2-live/v2-public-pages.css";
import "./v2-live/v2-public-pages-batch2.css";

// Preserve the existing production entry. Service-worker registration stays disabled.
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

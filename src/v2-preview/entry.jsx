import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import PreviewApp from "./PreviewApp.jsx";
import "./preview.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter basename="/__v2-preview">
      <PreviewApp />
    </BrowserRouter>
  </React.StrictMode>
);

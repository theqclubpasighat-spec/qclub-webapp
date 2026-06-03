import React, { useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";

export function BottomPadding() {
  return <div style={{ height: 28 }} />;
}

export function PageShell({ title, subtitle, right, noNav = false }) {
  const navigate = useNavigate();
  const location = useLocation();

  const scorerOnlyPaths = [
    "/rummy-snooker",
    "/rummy-snooker-table-1",
    "/rummy-snooker-table-2",
    "/rummy-snooker-table-3",
    "/rummy-snooker-table-1-display",
    "/rummy-snooker-table-2-display",
    "/rummy-snooker-table-3-display",
    "/qchase-records",

    "/kitty",
    "/kitty-table-1",
    "/kitty-table-2",
    "/kitty-table-3",
    "/kitty-table-1-display",
    "/kitty-table-2-display",
    "/kitty-table-3-display",
    "/kitty-records",
  ];

  const hidePageNav = noNav || scorerOnlyPaths.includes(location.pathname);

  return (
    <div className="container">
      <div className="pageHead">
        <div className="pageHeadLeft">
          {!hidePageNav ? (
            <>
              <button
                className="iconBtn"
                onClick={() => {
                  if (window.history.length > 1) {
                    navigate(-1);
                  } else {
                    navigate("/");
                  }
                }}
                aria-label="Back"
              >
                ←
              </button>

              <Link className="iconBtn" to="/" aria-label="Home">
                ⌂
              </Link>
            </>
          ) : null}

          <div>
            <div className="pageTitle">{title}</div>
            {subtitle ? <div className="muted">{subtitle}</div> : null}
          </div>
        </div>

        <div className="pageHeadRight">{right || null}</div>
      </div>
    </div>
  );
}
export function QClubAccessBadge({
  admin = false,
  staffAdmin = false,
  scorerMode = false,
  scorerLabel = "SCORER PIN MODE",
}) {
  const mode = admin
    ? "MAIN ADMIN MODE"
    : staffAdmin
    ? "STAFF ADMIN MODE"
    : scorerMode
    ? scorerLabel
    : "PUBLIC MODE";

  const bg = admin
    ? "#dc2626"
    : staffAdmin
    ? "#f59e0b"
    : scorerMode
    ? "#2563eb"
    : "#334155";

  function exitAdminMode() {
    const ok = window.confirm(
      "Exit Admin Mode on this browser?\n\nThis will remove Main Admin / Staff Admin access from this laptop browser."
    );

    if (!ok) return;

    try {
      localStorage.removeItem("qclub_admin_role");
    } catch {}

    window.location.reload();
  }

  function exitScorerMode() {
    const ok = window.confirm(
      "Exit Scorer PIN Mode on this browser?\n\nThis will remove Q Chase / Kitty scorer access from this laptop browser."
    );

    if (!ok) return;

    try {
      localStorage.removeItem("qclub_rummy_access");
      localStorage.removeItem("qclub_kitty_access");
    } catch {}

    window.location.reload();
  }

  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "8px 12px",
          borderRadius: 999,
          background: bg,
          color: "#fff",
          fontWeight: 900,
          fontSize: 12,
          letterSpacing: ".04em",
          boxShadow: "0 8px 24px rgba(0,0,0,.25)",
        }}
        title={
          admin
            ? "Full Main Admin access is active on this browser."
            : staffAdmin
            ? "Staff Admin access is active on this browser."
            : scorerMode
            ? "Only scorer PIN access is active on this browser."
            : "No admin or scorer access detected."
        }
      >
        {mode}
      </span>

      {admin || staffAdmin ? (
        <button
          className="btn danger"
          type="button"
          onClick={exitAdminMode}
          title="Remove Main Admin / Staff Admin access from this browser"
        >
          Exit Admin Mode
        </button>
      ) : scorerMode ? (
        <button
          className="btn"
          type="button"
          onClick={exitScorerMode}
          title="Remove Q Chase / Kitty scorer PIN access from this browser"
        >
          Exit Scorer Mode
        </button>
      ) : null}
    </div>
  );
}
export function StaticPage({ title, children }) {
  useEffect(() => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, []);

  return (
    <>
      <PageShell title={title} subtitle="The Q Club • Pasighat" />
      <div className="container legalWrap">
        <div className="legalCard">{children}</div>
      </div>
    </>
  );
}

export function renderEditableContent(content) {
  const blocks = String(content || "")
    .split(/\n\s*\n/g)
    .map((x) => x.trim())
    .filter(Boolean);

  return blocks.map((block, idx) => {
    const lines = block.split("\n").map((x) => x.trim()).filter(Boolean);
    if (!lines.length) return null;

    if (lines[0].startsWith("## ")) {
      const heading = lines[0].replace(/^##\s+/, "");
      const rest = lines.slice(1);
      const listItems = rest.filter((line) => line.startsWith("- "));
      const textLines = rest.filter((line) => !line.startsWith("- "));

      return (
        <div key={idx}>
          <h3>{heading}</h3>
          {textLines.length ? <p>{textLines.join(" ")}</p> : null}
          {listItems.length ? (
            <ul>
              {listItems.map((item, itemIdx) => (
                <li key={itemIdx}>{item.replace(/^-\s+/, "")}</li>
              ))}
            </ul>
          ) : null}
        </div>
      );
    }

    const listItems = lines.filter((line) => line.startsWith("- "));
    const textLines = lines.filter((line) => !line.startsWith("- "));

    return (
      <div key={idx}>
        {textLines.length ? (
          <p>
            {textLines.map((line, lineIdx) => (
              <React.Fragment key={lineIdx}>
                {lineIdx > 0 ? <br /> : null}
                {line}
              </React.Fragment>
            ))}
          </p>
        ) : null}
        {listItems.length ? (
          <ul>
            {listItems.map((item, itemIdx) => (
              <li key={itemIdx}>{item.replace(/^-\s+/, "")}</li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  });
}

export function editStaticPage(
  admin,
  data,
  commit,
  titleKey,
  contentKey,
  fallbackTitle,
  fallbackContent
) {
  if (!admin) return;

  const nextTitle = prompt("Page title:", data.club?.[titleKey] || fallbackTitle);
  if (nextTitle === null) return;

  const nextContent = prompt(
    "Page content. Use blank lines between paragraphs, ## for headings, and - for bullet points.",
    data.club?.[contentKey] || fallbackContent
  );
  if (nextContent === null) return;

  commit({
    ...data,
    club: {
      ...data.club,
      [titleKey]: nextTitle.trim() || fallbackTitle,
      [contentKey]: nextContent.trim() || fallbackContent,
    },
  });
}
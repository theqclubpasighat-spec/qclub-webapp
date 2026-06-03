import React from "react";
import {
  renderEditableContent,
  editStaticPage,
} from "./page-helpers";

export function AboutContent({ data, admin, commit, defaultData }) {
  const fallbackTitle = "About The Q Club";
  const fallbackContent = defaultData().club.aboutContent;
  const content = data.club?.aboutContent || fallbackContent;

  return (
    <>
      {admin ? (
        <div className="row" style={{ justifyContent: "flex-end", marginBottom: 12 }}>
          <button className="btn" onClick={() => editStaticPage(admin, data, commit, "aboutTitle", "aboutContent", fallbackTitle, fallbackContent)}>
            Edit Page
          </button>
        </div>
      ) : null}
      {renderEditableContent(content)}
    </>
  );
}

export function ContactContent({ data, admin, commit, defaultData }) {
  const fallbackTitle = "Contact Us";
  const fallbackContent = defaultData().club.contactContent;
  const content = data.club?.contactContent || fallbackContent;

  return (
    <>
      {admin ? (
        <div className="row" style={{ justifyContent: "flex-end", marginBottom: 12 }}>
          <button className="btn" onClick={() => editStaticPage(admin, data, commit, "contactTitle", "contactContent", fallbackTitle, fallbackContent)}>
            Edit Page
          </button>
        </div>
      ) : null}
      {renderEditableContent(content)}
    </>
  );
}

export function TermsContent({ data, admin, commit, defaultData }) {
  const fallbackTitle = "Terms & Conditions";
  const fallbackContent = defaultData().club.termsContent;
  const content = data.club?.termsContent || fallbackContent;

  return (
    <>
      {admin ? (
        <div className="row" style={{ justifyContent: "flex-end", marginBottom: 12 }}>
          <button className="btn" onClick={() => editStaticPage(admin, data, commit, "termsTitle", "termsContent", fallbackTitle, fallbackContent)}>
            Edit Page
          </button>
        </div>
      ) : null}
      {renderEditableContent(content)}
    </>
  );
}

export function RefundContent({ data, admin, commit, defaultData }) {
  const fallbackTitle = "Refund Policy";
  const fallbackContent = defaultData().club.refundContent;
  const content = data.club?.refundContent || fallbackContent;

  return (
    <>
      {admin ? (
        <div className="row" style={{ justifyContent: "flex-end", marginBottom: 12 }}>
          <button className="btn" onClick={() => editStaticPage(admin, data, commit, "refundTitle", "refundContent", fallbackTitle, fallbackContent)}>
            Edit Page
          </button>
        </div>
      ) : null}
      {renderEditableContent(content)}
    </>
  );
}

export function PrivacyContent({ data, admin, commit, defaultData }) {
  const fallbackTitle = "Privacy Policy";
  const fallbackContent = defaultData().club.privacyContent;
  const content = data.club?.privacyContent || fallbackContent;

  return (
    <>
      {admin ? (
        <div className="row" style={{ justifyContent: "flex-end", marginBottom: 12 }}>
          <button className="btn" onClick={() => editStaticPage(admin, data, commit, "privacyTitle", "privacyContent", fallbackTitle, fallbackContent)}>
            Edit Page
          </button>
        </div>
      ) : null}
      {renderEditableContent(content)}
    </>
  );
}

export function AirHockeyInfoContent({ data, admin, commit, defaultData }) {
  const fallbackTitle = "Air Hockey at The Q Club";
  const fallbackContent = defaultData().club.airHockeyInfoContent;
  const content = data.club?.airHockeyInfoContent || fallbackContent;

  return (
    <>
      {admin ? (
        <div className="row" style={{ justifyContent: "flex-end", marginBottom: 12 }}>
          <button
            className="btn"
            onClick={() =>
              editStaticPage(
                admin,
                data,
                commit,
                "airHockeyInfoTitle",
                "airHockeyInfoContent",
                fallbackTitle,
                fallbackContent
              )
            }
          >
            Edit Page
          </button>
        </div>
      ) : null}
      {renderEditableContent(content)}
    </>
  );
}

export function FoosballInfoContent({ data, admin, commit, defaultData }) {
  const fallbackTitle = "Foosball at The Q Club";
  const fallbackContent = defaultData().club.foosballInfoContent;
  const content = data.club?.foosballInfoContent || fallbackContent;

  return (
    <>
      {admin ? (
        <div className="row" style={{ justifyContent: "flex-end", marginBottom: 12 }}>
          <button
            className="btn"
            onClick={() =>
              editStaticPage(
                admin,
                data,
                commit,
                "foosballInfoTitle",
                "foosballInfoContent",
                fallbackTitle,
                fallbackContent
              )
            }
          >
            Edit Page
          </button>
        </div>
      ) : null}
      {renderEditableContent(content)}
    </>
  );
}

export function MassageChairInfoContent({ data, admin, commit, defaultData }) {
  const fallbackTitle = "Massage Chair at The Q Club";
  const fallbackContent = defaultData().club.massageChairInfoContent;
  const content = data.club?.massageChairInfoContent || fallbackContent;

  return (
    <>
      {admin ? (
        <div className="row" style={{ justifyContent: "flex-end", marginBottom: 12 }}>
          <button
            className="btn"
            onClick={() =>
              editStaticPage(
                admin,
                data,
                commit,
                "massageChairInfoTitle",
                "massageChairInfoContent",
                fallbackTitle,
                fallbackContent
              )
            }
          >
            Edit Page
          </button>
        </div>
      ) : null}
      {renderEditableContent(content)}
    </>
  );
}

export function TournamentLegalContent({ data, admin, commit, defaultData }) {
  const fallbackTitle = "Tournament Legal Notice";
  const fallbackContent = defaultData().club.tournamentDisclaimerContent;
  const content = data.club?.tournamentDisclaimerContent || fallbackContent;

  return (
    <>
      {admin ? (
        <div className="row" style={{ justifyContent: "flex-end", marginBottom: 12 }}>
          <button
            className="btn"
            onClick={() =>
              editStaticPage(
                admin,
                data,
                commit,
                "tournamentDisclaimerTitle",
                "tournamentDisclaimerContent",
                fallbackTitle,
                fallbackContent
              )
            }
          >
            Edit Notice
          </button>
        </div>
      ) : null}
      {renderEditableContent(content)}
    </>
  );
}

export function HandicapContent({ data, admin, commit, defaultData }) {
  const fallbackTitle = "Handicap & Classification";
  const fallbackContent = defaultData().club.handicapContent;
  const content = data.club?.handicapContent || fallbackContent;

  return (
    <>
      {admin ? (
        <div className="row" style={{ justifyContent: "flex-end", marginBottom: 12 }}>
          <button
            className="btn"
            onClick={() =>
              editStaticPage(
                admin,
                data,
                commit,
                "handicapTitle",
                "handicapContent",
                fallbackTitle,
                fallbackContent
              )
            }
          >
            Edit Rules
          </button>
        </div>
      ) : null}
      {renderEditableContent(content)}
    </>
  );
}
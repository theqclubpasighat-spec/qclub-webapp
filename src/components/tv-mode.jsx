import { PageShell } from "./page-helpers";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { tournamentGameKey, tournamentDisplay } from "../lib/qclub-utils";
import { calcLeaderboard, playersForTournament } from "../lib/qclub-utils";

function uid() {
  return `tv_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function handicapFromGroups(group1, group2, game = "snooker") {
  const gameKey = tournamentGameKey(game);
  if (gameKey !== "snooker") return { handicap1: 0, handicap2: 0 };

  const g1 = String(group1 || "C").toUpperCase();
  const g2 = String(group2 || "C").toUpperCase();
  const rank = { A: 3, B: 2, C: 1 };
  const r1 = rank[g1] || 1;
  const r2 = rank[g2] || 1;

  if (r1 === r2) return { handicap1: 0, handicap2: 0 };

  const diff = Math.abs(r1 - r2);
  const points = diff === 1 ? 6 : 12;

  if (r1 > r2) return { handicap1: 0, handicap2: points };
  return { handicap1: points, handicap2: 0 };
}

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function nextPowerOfTwo(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function generateKnockout(participantIds, allPlayers = [], game = "snooker") {
  const ids = [...participantIds].filter(Boolean);
  if (ids.length < 2) return [];

  const getPlayerGroup = (id) =>
    (allPlayers || []).find((p) => p.id === id)?.group || "C";

  const shuffled = shuffle(ids);
  const matches = [];
  const bracketSize = nextPowerOfTwo(shuffled.length);
  const byes = bracketSize - shuffled.length;

  const byePlayers = shuffled.slice(0, byes);
  const round1Players = shuffled.slice(byes);
  const round1WinnerSlots = [];

  for (let i = 0; i < round1Players.length; i += 2) {
    const p1 = round1Players[i];
    const p2 = round1Players[i + 1];
    if (!p1 || !p2) continue;

    const matchNo = round1WinnerSlots.length + 1;
    matches.push({
      id: uid(),
      round: 1,
      matchNo,
      p1,
      p2,
      p1Group: getPlayerGroup(p1),
      p2Group: getPlayerGroup(p2),
      ...handicapFromGroups(getPlayerGroup(p1), getPlayerGroup(p2), game),
      score1: "",
      score2: "",
      winner: "",
      result: "",
      margin: "",
      status: "scheduled",
      bestOf: 3,
      break1: "",
      break2: "",
      notes: "",
      enteredBy: "",
      verifiedBy: "",
      updatedAt: Date.now(),
    });

    round1WinnerSlots.push(`WINNER_R1_M${matchNo}`);
  }

  let currentRoundPlayers = [...byePlayers, ...round1WinnerSlots];
  let roundNumber = 2;

  while (currentRoundPlayers.length > 1) {
    const nextRoundPlayers = [];

    for (let i = 0; i < currentRoundPlayers.length; i += 2) {
      const p1 = currentRoundPlayers[i];
      const p2 = currentRoundPlayers[i + 1];

      if (!p1 && !p2) continue;
      if (p1 && !p2) {
        nextRoundPlayers.push(p1);
        continue;
      }
      if (!p1 && p2) {
        nextRoundPlayers.push(p2);
        continue;
      }

      const matchNo = nextRoundPlayers.length + 1;
      const isFinal = currentRoundPlayers.length === 2;

      matches.push({
        id: uid(),
        round: roundNumber,
        matchNo,
        p1,
        p2,
        p1Group: String(p1).startsWith("WINNER_") ? "" : getPlayerGroup(p1),
        p2Group: String(p2).startsWith("WINNER_") ? "" : getPlayerGroup(p2),
        ...(String(p1).startsWith("WINNER_") || String(p2).startsWith("WINNER_")
          ? { handicap1: 0, handicap2: 0 }
          : handicapFromGroups(getPlayerGroup(p1), getPlayerGroup(p2), game)),
        score1: "",
        score2: "",
        winner: "",
        result: "",
        margin: "",
        status: "scheduled",
        bestOf: isFinal ? 5 : 3,
        break1: "",
        break2: "",
        notes: "",
        enteredBy: "",
        verifiedBy: "",
        updatedAt: Date.now(),
      });

      nextRoundPlayers.push(`WINNER_R${roundNumber}_M${matchNo}`);
    }

    currentRoundPlayers = nextRoundPlayers;
    roundNumber += 1;
  }

  return matches;
}

function generateKnockoutForTournamentSilently(data, commit, tournamentId) {
  const tournaments = data.tournaments || [];
  const tournament = tournaments.find((t) => t.id === tournamentId);
  if (!tournament) return false;

  const participantIds = Array.isArray(tournament.participantIds)
    ? tournament.participantIds.filter(Boolean)
    : [];

  if (participantIds.length < 2) return false;

  const matches = generateKnockout(
    participantIds,
    data.players || [],
    tournamentGameKey(tournament?.game)
  );

  const fixtureAnnouncement = {
    id: uid(),
    text: `Knockout fixtures generated for ${tournament.name || "current tournament"} !`,
    link: "/fixtures",
    createdAt: Date.now(),
  };

  commit({
    ...data,
    tournaments: tournaments.map((t) =>
      t.id === tournamentId
        ? {
            ...t,
            format: "knockout",
            matches,
          }
        : t
    ),
    announcements: [fixtureAnnouncement, ...(data.announcements || [])].slice(0, 20),
  });

  return true;
}

function buildRevealCards(tournament, allPlayers = []) {
  const participantIds = Array.isArray(tournament?.participantIds)
    ? tournament.participantIds.filter(Boolean)
    : [];

  const pool = shuffle(
    participantIds
      .map((id) => allPlayers.find((p) => p.id === id))
      .filter(Boolean)
  );

  if (pool.length < 2) return [];

  const bracketSize = nextPowerOfTwo(pool.length);
  const byes = bracketSize - pool.length;
  const cards = [];

  for (let i = 0; i < byes; i += 1) {
    const player = pool[i];
    if (!player) continue;
    cards.push({
      id: `bye_${player.id}_${i}`,
      type: "bye",
      round: 1,
      matchNo: cards.length + 1,
      p1: player,
      p2: null,
    });
  }

  const remaining = pool.slice(byes);
  for (let i = 0; i < remaining.length; i += 2) {
    const p1 = remaining[i];
    const p2 = remaining[i + 1];
    if (!p1 || !p2) continue;
    cards.push({
      id: `pair_${p1.id}_${p2.id}_${i}`,
      type: "match",
      round: 1,
      matchNo: cards.length + 1,
      p1,
      p2,
    });
  }

  return cards;
}

export function TVMode({ data, activeTournament, players, admin, staffAdmin, commit }) {
  const [selectedTvTournamentId, setSelectedTvTournamentId] = useState(
    activeTournament?.id || data.tournaments?.[0]?.id || ""
  );

  const tvTournament =
    (data.tournaments || []).find((t) => t.id === selectedTvTournamentId) ||
    activeTournament ||
    null;

  const tvMatches = tvTournament?.matches || [];
  const matches = tvMatches;
  const isSnooker = tournamentGameKey(tvTournament?.game) === "snooker";

  const [tvMode, setTvMode] = useState("showcase"); // showcase | fixtures | auto
  const [slideIndex, setSlideIndex] = useState(0);
  const [fixturePage, setFixturePage] = useState(0);
  const [autoPhase, setAutoPhase] = useState("showcase");
  const [showFixtureBanner, setShowFixtureBanner] = useState(false);
  const tvSlideFileInputRef = useRef(null);

  const [fixtureRevealStage, setFixtureRevealStage] = useState("idle");
  const [hasPlayedFixtureReveal, setHasPlayedFixtureReveal] = useState(false);
  const [revealedPairCount, setRevealedPairCount] = useState(0);
  const [activeRevealIndex, setActiveRevealIndex] = useState(0);

  const leaderboard = tvTournament
    ? calcLeaderboard(playersForTournament(tvTournament, data.players || []), tvTournament)
    : [];

  const tournamentPlayersForTv = tvTournament
    ? playersForTournament(tvTournament, data.players || [])
    : [];

  const revealCards = useMemo(
    () => buildRevealCards(tvTournament, data.players || []),
    [tvTournament, data.players]
  );

  const nextMatches = matches.filter((m) => m.status !== "done");
  const doneMatches = matches.filter((m) => m.status === "done");

  function playerById(id) {
    return (players || []).find((x) => x.id === id) || null;
  }

  function playerName(id) {
    return playerById(id)?.name || "Player";
  }

  function scoreText(m) {
    const s1 = m?.score1 === "" || m?.score1 == null ? "-" : m.score1;
    const s2 = m?.score2 === "" || m?.score2 == null ? "-" : m.score2;
    return `${s1} : ${s2}`;
  }

  function chunkItems(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  const fixturePages = chunkItems(nextMatches.length ? nextMatches : doneMatches, 4);
  const currentFixturePage = fixturePages[fixturePage] || [];

  useEffect(() => {
    setFixturePage(0);
    setFixtureRevealStage("idle");
    setHasPlayedFixtureReveal(false);
    setShowFixtureBanner(false);
    setRevealedPairCount(0);
    setActiveRevealIndex(0);
  }, [selectedTvTournamentId]);

  useEffect(() => {
    if (!showFixtureBanner) return;
    const t = setTimeout(() => setShowFixtureBanner(false), 4500);
    return () => clearTimeout(t);
  }, [showFixtureBanner]);

  useEffect(() => {
    const t = setInterval(() => {
      setSlideIndex((prev) => prev + 1);
    }, 7000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (fixturePages.length <= 1) return;

    const shouldRotateFixtures =
      tvMode === "fixtures" || (tvMode === "auto" && autoPhase === "fixtures");

    if (!shouldRotateFixtures) return;

    const t = setInterval(() => {
      setFixturePage((prev) => (prev + 1) % fixturePages.length);
    }, 10000);

    return () => clearInterval(t);
  }, [fixturePages.length, tvMode, autoPhase]);

  useEffect(() => {
    if (tvMode !== "auto") return;

    setAutoPhase("showcase");

    const t = setInterval(() => {
      setAutoPhase((prev) => {
        if (prev === "showcase") {
          return matches.length ? "fixtures" : "showcase";
        }
        return "showcase";
      });
    }, 15000);

    return () => clearInterval(t);
  }, [tvMode, matches.length]);

  useEffect(() => {
    let t;

    if (fixtureRevealStage === "closed") {
      t = setTimeout(() => setFixtureRevealStage("generating"), 900);
    } else if (fixtureRevealStage === "generating") {
      t = setTimeout(() => setFixtureRevealStage("locked"), 2200);
    } else if (fixtureRevealStage === "locked") {
      setRevealedPairCount(1);
      setActiveRevealIndex(0);
    }

    return () => {
      if (t) clearTimeout(t);
    };
  }, [fixtureRevealStage]);

  useEffect(() => {
    if (fixtureRevealStage !== "locked") return;
    if (!revealCards.length) return;

    if (activeRevealIndex >= revealCards.length - 1) {
      const finishTimer = setTimeout(() => {
        setFixtureRevealStage("ready");
      }, 1800);
      return () => clearTimeout(finishTimer);
    }

    const t = setTimeout(() => {
      setActiveRevealIndex((prev) => prev + 1);
      setRevealedPairCount((prev) => Math.min(prev + 1, revealCards.length));
    }, 2200);

    return () => clearTimeout(t);
  }, [fixtureRevealStage, activeRevealIndex, revealCards.length]);

  useEffect(() => {
    if (fixtureRevealStage !== "ready") return;
    const t = setTimeout(() => {
      setFixtureRevealStage("done");
      setHasPlayedFixtureReveal(true);
      setTvMode("fixtures");
    }, 2600);
    return () => clearTimeout(t);
  }, [fixtureRevealStage]);

  function triggerFixtureReveal() {
    setFixturePage(0);
    setShowFixtureBanner(false);
    setHasPlayedFixtureReveal(false);
    setRevealedPairCount(0);
    setActiveRevealIndex(0);
    setTvMode("showcase");
    setFixtureRevealStage("idle");

    setTimeout(() => {
      setShowFixtureBanner(true);
      setFixtureRevealStage("closed");
    }, 40);
  }

  const heroSlides = (data.club?.heroSlides || []).filter(Boolean).map((url, idx) => ({
    id: `hero_${idx}`,
    kind: "image",
    title: idx === 0 ? "Welcome to The Q Club" : "Premium Gaming Lounge",
    subtitle:
      idx === 0
        ? "Snooker • Pool • Air Hockey • Foosball • Tea • Coffee • Lounge"
        : "The coolest place in the oldest town.",
    image: url,
  }));

  const gallerySlides = (data.photos || [])
    .map((p, idx) => ({
      id: p.id || `gallery_${idx}`,
      kind: "image",
      title: p.title || "Club Gallery",
      subtitle: p.caption || "Moments from The Q Club",
      image: p.url || p.dataUrl || "",
    }))
    .filter((x) => x.image)
    .slice(0, 8);

  const memberSlides = (players || [])
    .filter((p) => p.photo)
    .map((p) => ({
      id: `player_${p.id}`,
      kind: "image",
      title: p.name || "Member Spotlight",
      subtitle: p.city ? `${p.city} • Q Club Player` : "Q Club Player",
      image: p.photo,
    }))
    .slice(0, 8);

  const hallOfFameSlides = (data.hallOfFame || [])
    .filter((h) => h.photo)
    .map((h) => ({
      id: `hof_${h.id}`,
      kind: "image",
      title: h.title || h.name || "Hall of Fame",
      subtitle: h.note || h.category || "Club Highlight",
      image: h.photo,
    }))
    .slice(0, 6);

  const textSlides = [
    {
      id: "amenities",
      kind: "text",
      title: "Club Amenities",
      subtitle:
        "2 Full-size 12x6 Snooker Tables • Mini Snooker • American Pool • Air Hockey • Foosball • Massage Chair",
    },
    {
      id: "beverages",
      kind: "text",
      title: "Food & Beverage",
      subtitle: "Tea • Coffee • Mocktails • Momos • Sausages • Chicken • More at The Q Club",
    },
    {
      id: "memberships",
      kind: "text",
      title: "Membership Open",
      subtitle: "Join Bronze • Silver • Gold • Platinum for member perks and special rates",
    },
    {
      id: "booking",
      kind: "text",
      title: "Book Your Table",
      subtitle: "Scan and book at theqclubpasighat.com",
    },
    {
      id: "tournament",
      kind: "text",
      title: tvTournament ? tournamentDisplay(tvTournament) : "Monthly Club Tournaments",
      subtitle: tvTournament?.registrationNote || "Skill-based club tournaments, fixtures, rankings, and more.",
    },
  ];

  const customSlides = (data.club?.tvCustomSlides || []).map((s, idx) => ({
    id: s.id || `custom_${idx}`,
    kind: s.kind || "text",
    title: s.title || "Showcase Slide",
    subtitle: s.subtitle || "",
    image: s.image || "",
    isCustom: true,
  }));

  const editableSlides = [...textSlides, ...customSlides];
  const tvShowcaseMode = data.club?.tvShowcaseMode === "custom_only" ? "custom_only" : "mixed";

  const showcaseSlides =
    tvShowcaseMode === "custom_only"
      ? customSlides.length
        ? customSlides
        : [{ id: "custom_only_empty", kind: "text", title: "No Custom TV Slides Yet", subtitle: "Add or upload custom slides to use Custom Slides Only mode." }]
      : [...heroSlides, ...editableSlides, ...memberSlides, ...gallerySlides, ...hallOfFameSlides];

  const safeSlides = showcaseSlides.length
    ? showcaseSlides
    : [{ id: "fallback", kind: "text", title: "Welcome to The Q Club", subtitle: "Premium gaming lounge • Snooker • Pool • Air Hockey • Lounge" }];

  const activeSlide = safeSlides[slideIndex % safeSlides.length];
  const canEditTvSlides = admin || staffAdmin;

  function setTvShowcaseMode(nextMode) {
    if (!canEditTvSlides) return;
    commit({
      ...data,
      club: {
        ...(data.club || {}),
        tvCustomSlides: data.club?.tvCustomSlides || [],
        tvShowcaseMode: nextMode === "custom_only" ? "custom_only" : "mixed",
      },
    });
  }

  function triggerTvSlideImagePicker() {
    if (!canEditTvSlides || !tvSlideFileInputRef.current) return;
    tvSlideFileInputRef.current.value = "";
    tvSlideFileInputRef.current.click();
  }

  function handleTvSlideImageFileChange(e) {
    if (!canEditTvSlides) return;
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      if (!dataUrl) return;

      const title = prompt("Slide title:", "The Q Club Showcase");
      if (title === null) return;
      const subtitle = prompt("Slide subtitle:", "Premium gaming lounge in Pasighat.");
      if (subtitle === null) return;

      commit({
        ...data,
        club: {
          ...(data.club || {}),
          tvCustomSlides: [
            ...(data.club?.tvCustomSlides || []),
            { id: uid(), kind: "image", title: title.trim(), subtitle: subtitle.trim(), image: dataUrl },
          ],
        },
      });
    };
    reader.readAsDataURL(file);
  }

  function moveCurrentTvSlide(direction) {
    if (!canEditTvSlides || !activeSlide?.isCustom) {
      alert("Only custom TV slides can be reordered.");
      return;
    }

    const slides = [...(data.club?.tvCustomSlides || [])];
    const idx = slides.findIndex((s) => s.id === activeSlide.id);
    if (idx === -1) return;
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= slides.length) return;

    [slides[idx], slides[targetIdx]] = [slides[targetIdx], slides[idx]];

    commit({
      ...data,
      club: {
        ...(data.club || {}),
        tvCustomSlides: slides,
      },
    });
  }

  function addCustomTvSlide() {
    if (!canEditTvSlides) return;
    const title = prompt("Slide title:", "Welcome to The Q Club");
    if (title === null) return;
    const subtitle = prompt("Slide subtitle:", "Premium gaming lounge in Pasighat.");
    if (subtitle === null) return;
    const image = prompt("Optional image URL / data URL:", "");
    if (image === null) return;

    commit({
      ...data,
      club: {
        ...(data.club || {}),
        tvCustomSlides: [
          ...(data.club?.tvCustomSlides || []),
          {
            id: uid(),
            kind: image.trim() ? "image" : "text",
            title: title.trim(),
            subtitle: subtitle.trim(),
            image: image.trim(),
          },
        ],
      },
    });
  }

  function editCurrentTvSlide() {
    if (!canEditTvSlides || !activeSlide?.isCustom) {
      alert("Only custom TV slides are editable. Built-in slides are automatic.");
      return;
    }

    const current = (data.club?.tvCustomSlides || []).find((s) => s.id === activeSlide.id);
    if (!current) return;

    const title = prompt("Edit slide title:", current.title || "");
    if (title === null) return;
    const subtitle = prompt("Edit slide subtitle:", current.subtitle || "");
    if (subtitle === null) return;
    const image = prompt("Edit image URL / data URL:", current.image || "");
    if (image === null) return;

    commit({
      ...data,
      club: {
        ...(data.club || {}),
        tvCustomSlides: (data.club?.tvCustomSlides || []).map((s) =>
          s.id === current.id
            ? { ...s, title: title.trim(), subtitle: subtitle.trim(), image: image.trim(), kind: image.trim() ? "image" : "text" }
            : s
        ),
      },
    });
  }

  function deleteCurrentTvSlide() {
    if (!canEditTvSlides || !activeSlide?.isCustom) {
      alert("Only custom TV slides can be deleted.");
      return;
    }
    if (!confirm("Delete this custom TV slide?")) return;

    commit({
      ...data,
      club: {
        ...(data.club || {}),
        tvCustomSlides: (data.club?.tvCustomSlides || []).filter((s) => s.id !== activeSlide.id),
      },
    });
  }

  const showFixtureView =
    tvMode === "fixtures" || (tvMode === "auto" && autoPhase === "fixtures");

  function renderSlide(slide) {
    const bgImage = slide?.image || "";
    return (
      <div
        style={{
          position: "relative",
          minHeight: "64vh",
          borderRadius: 24,
          overflow: "hidden",
          background: bgImage
            ? `linear-gradient(180deg, rgba(4,8,18,.20), rgba(4,8,18,.80)), url(${bgImage}) center/cover no-repeat`
            : "linear-gradient(135deg, rgba(8,12,24,.98), rgba(18,31,58,.98))",
          border: "1px solid rgba(255,255,255,.08)",
          boxShadow: "0 20px 60px rgba(0,0,0,.35)",
          display: "flex",
          alignItems: "flex-end",
        }}
      >
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,.08) 0%, rgba(0,0,0,.30) 45%, rgba(0,0,0,.78) 100%)" }} />
        <div style={{ position: "relative", zIndex: 1, width: "100%", padding: "28px", display: "grid", gap: 12 }}>
          <div style={{ display: "inline-flex", width: "fit-content", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 999, background: "rgba(255,255,255,.10)", border: "1px solid rgba(255,255,255,.14)", fontWeight: 800, fontSize: 14 }}>
            <span className="dot" />Showcase Mode
          </div>
          <div style={{ fontSize: "clamp(34px, 5vw, 68px)", fontWeight: 900, lineHeight: 1.02, maxWidth: 980, textShadow: "0 4px 24px rgba(0,0,0,.35)" }}>{slide?.title}</div>
          <div style={{ fontSize: "clamp(16px, 2vw, 28px)", lineHeight: 1.35, color: "rgba(255,255,255,.88)", maxWidth: 960 }}>{slide?.subtitle}</div>
        </div>
      </div>
    );
  }

  function renderFixtureCard(m) {
    const p1 = playerById(m.p1);
    const p2 = playerById(m.p2);

    return (
      <div key={m.id} style={{ borderRadius: 22, padding: 20, background: "linear-gradient(180deg, rgba(14,22,38,.96), rgba(8,12,22,.96))", border: "1px solid rgba(255,255,255,.08)", boxShadow: "0 12px 34px rgba(0,0,0,.22)" }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 16, gap: 8 }}>
          <span className="badge"><span className="dot" />Round {m.round || 1}</span>
          <span className="badge"><span className={m.status === "live" ? "dot warn" : "dot"} />{m.status === "done" ? "Completed" : m.status === "live" ? "Live" : "Upcoming"}</span>
        </div>
        <div style={{ display: "grid", gap: 16 }}>
          {[
            { p: p1, name: playerName(m.p1), score: m?.score1 === "" || m?.score1 == null ? "-" : m.score1 },
            { p: p2, name: playerName(m.p2), score: m?.score2 === "" || m?.score2 == null ? "-" : m.score2 },
          ].map((row, idx) => (
            <div key={idx} style={{ display: "grid", gridTemplateColumns: "72px 1fr auto", gap: 14, alignItems: "center" }}>
              {row.p?.photo ? (
                <img src={row.p.photo} alt={row.name} style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 16, border: "1px solid rgba(255,255,255,.12)" }} />
              ) : (
                <div style={{ width: 72, height: 72, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 30, background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.12)" }}>{String(row.name || "?").slice(0, 1).toUpperCase()}</div>
              )}
              <div style={{ fontSize: "clamp(18px, 2vw, 28px)", fontWeight: 800, lineHeight: 1.1, minWidth: 0 }}>{row.name}</div>
              <div style={{ minWidth: 54, textAlign: "center", fontSize: "clamp(22px, 3vw, 40px)", fontWeight: 900 }}>{row.score}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderFixtureView() {
    const focusMatch = nextMatches[0] || doneMatches[0] || null;
    return (
      <div style={{ display: "grid", gap: 18 }}>
        <div style={{ borderRadius: 24, padding: 24, background: "linear-gradient(135deg, rgba(7,13,24,.98), rgba(15,28,52,.98))", border: "1px solid rgba(255,255,255,.08)", boxShadow: "0 20px 60px rgba(0,0,0,.28)" }}>
          <div className="row" style={{ justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>Fixture Broadcast</div>
              <div style={{ fontSize: "clamp(26px, 4vw, 48px)", fontWeight: 900, lineHeight: 1.05 }}>{tvTournament ? tournamentDisplay(tvTournament) : "No Selected Tournament"}</div>
              <div className="muted" style={{ marginTop: 8, fontSize: 16 }}>{focusMatch ? `Showing ${nextMatches.length ? "upcoming/live" : "completed"} fixtures` : "No fixtures available yet"}</div>
            </div>
            <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
              <span className="badge"><span className="dot" />Total: {matches.length}</span>
              <span className="badge"><span className="dot warn" />Pending: {nextMatches.length}</span>
              <span className="badge"><span className="dot" />Done: {doneMatches.length}</span>
              {fixturePages.length > 1 ? <span className="badge"><span className="dot" />Page {fixturePage + 1} / {fixturePages.length}</span> : null}
            </div>
          </div>
        </div>

        {focusMatch ? (
          <div style={{ borderRadius: 24, padding: 22, background: "linear-gradient(180deg, rgba(12,19,34,.96), rgba(8,12,22,.96))", border: "1px solid rgba(255,255,255,.08)" }}>
            <div style={{ fontSize: 14, opacity: 0.82, marginBottom: 10 }}>{focusMatch.status === "live" ? "Now Playing" : "Next Featured Match"}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 12 }}>
              <div style={{ textAlign: "center" }}><div style={{ fontSize: "clamp(24px, 3vw, 44px)", fontWeight: 900 }}>{playerName(focusMatch.p1)}</div></div>
              <div style={{ fontSize: "clamp(28px, 4vw, 56px)", fontWeight: 900 }}>{scoreText(focusMatch)}</div>
              <div style={{ textAlign: "center" }}><div style={{ fontSize: "clamp(24px, 3vw, 44px)", fontWeight: 900 }}>{playerName(focusMatch.p2)}</div></div>
            </div>
          </div>
        ) : (
          <div className="card"><div className="muted">Fixtures will appear here once generated.</div></div>
        )}

        {currentFixturePage.length ? <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>{currentFixturePage.map(renderFixtureCard)}</div> : null}
      </div>
    );
  }

  function renderFixtureReveal() {
    if (fixtureRevealStage === "idle" || fixtureRevealStage === "done") return null;

    const stageMeta = {
      closed: {
        kicker: "Registration Locked",
        title: "Tournament Entry Closed",
        subtitle: tvTournament?.registrationNote || "All registered participants are being prepared for the live draw.",
        glow: "rgba(255, 186, 64, 0.28)",
        accent: "#ffcc66",
      },
      generating: {
        kicker: "Live Draw Engine",
        title: "Name Blocks Mixing In The Draw",
        subtitle: "Registered participants are rapidly mixing before the opening fixtures lock into place.",
        glow: "rgba(0, 200, 255, 0.26)",
        accent: "#7ee7ff",
      },
      locked: {
        kicker: "Round One Reveal",
        title: "Opening Matches Emerging",
        subtitle: "Each opening fixture is now being revealed one by one for the TV broadcast.",
        glow: "rgba(110, 150, 255, 0.26)",
        accent: "#9ec0ff",
      },
      ready: {
        kicker: "Broadcast Ready",
        title: "Round One Fixtures Confirmed",
        subtitle: "The opening round draw is complete. Full fixture board coming up next.",
        glow: "rgba(56, 211, 159, 0.28)",
        accent: "#7fffd4",
      },
    };

    const meta = stageMeta[fixtureRevealStage] || stageMeta.closed;
    const activeCard = revealCards[Math.min(activeRevealIndex, Math.max(0, revealCards.length - 1))] || null;
    const visibleCards = revealCards.slice(0, revealedPairCount);
    const revealPlayers = tournamentPlayersForTv.slice(0, 18);
    const isGenerating = fixtureRevealStage === "generating";
    const isRevealStage = fixtureRevealStage === "locked" || fixtureRevealStage === "ready";

    return (
      <div style={{ position: "relative", minHeight: "72vh", borderRadius: 30, overflow: "hidden", background: "radial-gradient(circle at 50% 0%, rgba(34,70,130,.94), rgba(7,11,22,.98) 42%, rgba(3,7,15,1) 100%)", border: "1px solid rgba(255,255,255,.08)", boxShadow: "0 30px 90px rgba(0,0,0,.44)", padding: 30 }}>
        <style>{`
          @keyframes qclubGlowPulse {0%,100%{opacity:.72;transform:scale(1)}50%{opacity:1;transform:scale(1.05)}}
          @keyframes qclubSweep {0%{transform:translateX(-24%) skewX(-18deg);opacity:.08}50%{opacity:.58}100%{transform:translateX(124%) skewX(-18deg);opacity:.08}}
          @keyframes qclubTileMixA {0%{transform:translate3d(0,0,0) scale(1)}25%{transform:translate3d(48px,-18px,0) scale(1.04)}50%{transform:translate3d(-54px,22px,0) scale(.97)}75%{transform:translate3d(24px,14px,0) scale(1.02)}100%{transform:translate3d(0,0,0) scale(1)}}
          @keyframes qclubTileMixB {0%{transform:translate3d(0,0,0) scale(1)}25%{transform:translate3d(-42px,20px,0) scale(1.05)}50%{transform:translate3d(56px,-14px,0) scale(.96)}75%{transform:translate3d(-26px,-18px,0) scale(1.02)}100%{transform:translate3d(0,0,0) scale(1)}}
          @keyframes qclubCardIn {0%{opacity:0;transform:translateY(26px) scale(.95)}100%{opacity:1;transform:translateY(0) scale(1)}}
          @keyframes qclubCenterFlash {0%,100%{opacity:.18}50%{opacity:.48}}
        `}</style>

        <div style={{ position: "absolute", inset: 0, background: `radial-gradient(circle at 50% 34%, ${meta.glow}, transparent 42%)`, pointerEvents: "none" }} />

        {(isGenerating || isRevealStage) && [0, 1, 2, 3].map((line) => (
          <div
            key={line}
            style={{ position: "absolute", left: "-24%", top: `${17 + line * 18}%`, width: "48%", height: 14, borderRadius: 999, background: "linear-gradient(90deg, transparent, rgba(255,255,255,.08), rgba(0,191,255,.22), rgba(255,255,255,.08), transparent)", filter: "blur(1px)", animation: `qclubSweep 1.05s linear infinite`, animationDelay: `${line * 0.16}s` }}
          />
        ))}

        <div style={{ position: "relative", zIndex: 1, display: "grid", gap: 22, minHeight: "64vh", alignContent: "start" }}>
          <div style={{ display: "inline-flex", width: "fit-content", alignItems: "center", gap: 10, padding: "10px 16px", borderRadius: 999, background: "rgba(255,255,255,.10)", border: `1px solid ${meta.accent}55`, fontWeight: 900, fontSize: 14, letterSpacing: ".05em", color: "#eef3ff" }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: meta.accent, boxShadow: `0 0 14px ${meta.accent}` }} />
            {meta.kicker}
          </div>

          <div style={{ fontSize: "clamp(36px, 5vw, 72px)", fontWeight: 900, lineHeight: 1.02, textShadow: "0 6px 28px rgba(0,0,0,.34)", maxWidth: 1020 }}>{meta.title}</div>
          <div style={{ fontSize: "clamp(16px, 2vw, 24px)", lineHeight: 1.45, color: "rgba(255,255,255,.86)", maxWidth: 980 }}>{meta.subtitle}</div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr minmax(340px, 520px) 1fr", gap: 22, alignItems: "center" }}>
            <div style={{ display: "grid", gap: 10 }}>
              {revealPlayers.filter((_, idx) => idx % 2 === 0).slice(0, 8).map((p, idx) => (
                <div key={p.id || idx} style={{ borderRadius: 18, padding: "13px 15px", background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.10)", fontWeight: 800, fontSize: 16, boxShadow: "0 8px 22px rgba(0,0,0,.16)", animation: isGenerating ? `qclubTileMixA 1.1s ease-in-out infinite` : "none", animationDelay: `${idx * 0.08}s`, opacity: isRevealStage ? 0.28 : 1, transition: "opacity .35s ease" }}>{p.name || "Player"}</div>
              ))}
            </div>

            <div style={{ position: "relative", minHeight: 360, display: "grid", placeItems: "center" }}>
              <div style={{ position: "absolute", inset: "10% 10% auto 10%", height: 120, borderRadius: 999, background: "radial-gradient(circle, rgba(0,191,255,.18), rgba(255,255,255,.02), transparent 70%)", filter: "blur(14px)", animation: "qclubCenterFlash 1.3s ease-in-out infinite" }} />

              {activeCard ? (
                <div key={activeCard.id} style={{ width: "100%", maxWidth: 470, borderRadius: 28, padding: 24, background: "linear-gradient(180deg, rgba(255,255,255,.10), rgba(255,255,255,.04))", border: "1px solid rgba(255,255,255,.14)", boxShadow: "0 24px 60px rgba(0,0,0,.28)", animation: "qclubCardIn .45s ease both" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 14 }}>
                    <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".11em", color: meta.accent, fontWeight: 900 }}>Round {activeCard.round} • Match {activeCard.matchNo}</div>
                    <div style={{ padding: "6px 10px", borderRadius: 999, border: `1px solid ${meta.accent}55`, background: "rgba(255,255,255,.05)", fontSize: 12, fontWeight: 800 }}>{activeCard.type === "bye" ? "BYE" : "HEAD TO HEAD"}</div>
                  </div>

                  <div style={{ display: "grid", gap: 14 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 12, alignItems: "center" }}>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: "clamp(24px, 3vw, 40px)", fontWeight: 900, lineHeight: 1.08 }}>{activeCard.p1?.name || "Player"}</div>
                      </div>
                      <div style={{ fontSize: "clamp(22px, 3vw, 34px)", fontWeight: 900, color: activeCard.type === "bye" ? meta.accent : "rgba(255,255,255,.88)" }}>{activeCard.type === "bye" ? ":" : "VS"}</div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: "clamp(24px, 3vw, 40px)", fontWeight: 900, lineHeight: 1.08 }}>{activeCard.type === "bye" ? "Bye" : activeCard.p2?.name || "Player"}</div>
                      </div>
                    </div>

                    <div style={{ textAlign: "center", color: "rgba(255,255,255,.78)", fontWeight: 700, lineHeight: 1.5 }}>
                      {activeCard.type === "bye"
                        ? `${activeCard.p1?.name || "Player"} proceeds directly to Round 2.`
                        : `${activeCard.p1?.name || "Player"} versus ${activeCard.p2?.name || "Player"}`}
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ fontWeight: 800, color: "rgba(255,255,255,.78)" }}>Preparing live draw...</div>
              )}
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              {revealPlayers.filter((_, idx) => idx % 2 === 1).slice(0, 8).map((p, idx) => (
                <div key={p.id || idx} style={{ borderRadius: 18, padding: "13px 15px", background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.10)", fontWeight: 800, fontSize: 16, boxShadow: "0 8px 22px rgba(0,0,0,.16)", animation: isGenerating ? `qclubTileMixB 1.1s ease-in-out infinite` : "none", animationDelay: `${idx * 0.08}s`, opacity: isRevealStage ? 0.28 : 1, transition: "opacity .35s ease" }}>{p.name || "Player"}</div>
              ))}
            </div>
          </div>

          {visibleCards.length ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))", gap: 16 }}>
              {visibleCards.map((card, idx) => (
                <div key={card.id} style={{ borderRadius: 22, padding: 18, background: "linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,.03))", border: "1px solid rgba(255,255,255,.11)", boxShadow: "0 16px 38px rgba(0,0,0,.24)", animation: "qclubCardIn .42s ease both", animationDelay: `${idx * 0.08}s` }}>
                  <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".09em", color: meta.accent, fontWeight: 900, marginBottom: 10 }}>Round {card.round} • Match {card.matchNo}</div>
                  <div style={{ fontSize: 24, fontWeight: 900, lineHeight: 1.22 }}>
                    {card.type === "bye" ? `${card.p1?.name || "Player"} : Bye` : `${card.p1?.name || "Player"} vs ${card.p2?.name || "Player"}`}
                  </div>
                  <div className="muted" style={{ marginTop: 10, fontWeight: 700 }}>
                    {card.type === "bye" ? "Proceeds to Round 2" : isSnooker ? `Handicap preview active on fixture board` : "Opening match confirmed"}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <>
      <PageShell
        title="TV Display"
        subtitle={tvTournament ? `${tvTournament.name} • ${tvTournament.month || ""}` : "Live tournament fixtures"}
        right={
          admin || staffAdmin ? (
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <select value={selectedTvTournamentId} onChange={(e) => setSelectedTvTournamentId(e.target.value)}>
                {(data.tournaments || []).map((t) => (
                  <option key={t.id} value={t.id}>{tournamentDisplay(t)}</option>
                ))}
              </select>

              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  if (!tvTournament) {
                    alert("Please select a tournament first.");
                    return;
                  }

                  const ok = generateKnockoutForTournamentSilently(data, commit, tvTournament.id);
                  if (!ok) {
                    alert("Need at least 2 registered players to generate fixtures.");
                    return;
                  }

                  setTimeout(() => {
                    triggerFixtureReveal();
                  }, 80);
                }}
              >
                Generate Fixtures
              </button>
            </div>
          ) : null
        }
      />

      <div className="container">
        <input ref={tvSlideFileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleTvSlideImageFileChange} />

        {(data.announcements || []).length > 0 && (
          <div style={{ overflow: "hidden", whiteSpace: "nowrap", marginBottom: 16, borderRadius: 14, background: "rgba(0,0,0,0.68)", padding: "8px 14px", border: "1px solid rgba(255,255,255,.08)" }}>
            <div className="announceTickerTrack" style={{ animationDuration: `${data.club?.tickerSpeed || 40}s`, fontSize: "clamp(18px, 2vw, 30px)", fontWeight: 800, padding: "14px 0", letterSpacing: "0.4px" }}>
              {(data.announcements || []).map((a) => <span key={a.id} style={{ marginRight: 80 }}>{a.text}</span>)}
            </div>
          </div>
        )}

        {showFixtureBanner ? (
          <div style={{ marginBottom: 16, padding: "14px 22px", borderRadius: 14, display: "inline-block", background: "linear-gradient(90deg, rgba(56,211,159,.20), rgba(0,191,255,.18))", border: "1px solid rgba(56, 211, 159, 0.45)", fontWeight: 800, fontSize: "22px", color: "#7fffd4", boxShadow: "0 0 18px rgba(56,211,159,.28)", animation: "pulseGlow 1.4s infinite", letterSpacing: "0.3px" }}>
            🎯 Fixtures Generated for {tvTournament?.name || "Selected Tournament"}
          </div>
        ) : null}

        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
            <div>
              <h2 style={{ marginBottom: 6 }}>{tvTournament ? tournamentDisplay(tvTournament) : "The Q Club TV Mode"}</h2>
              <div className="muted">
                {tvMode === "showcase"
                  ? `Showcase Mode • ${tvShowcaseMode === "custom_only" ? "Custom Slides Only" : "Mixed Showcase"}${activeSlide?.isCustom ? " • Custom Slide" : " • Auto Slide"}`
                  : tvMode === "fixtures"
                  ? "Fixture Broadcast"
                  : `Auto Mode • ${autoPhase === "fixtures" ? "Showing Fixtures" : "Showing Showcase"}`}
              </div>
            </div>

            <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
              <button type="button" className={tvMode === "showcase" ? "btn primary" : "btn secondary"} onClick={() => setTvMode("showcase")}>Showcase Mode</button>
              <button type="button" className={tvMode === "fixtures" ? "btn primary" : "btn secondary"} onClick={() => setTvMode("fixtures")}>Fixture Broadcast</button>
              <button type="button" className={tvMode === "auto" ? "btn primary" : "btn secondary"} onClick={() => setTvMode("auto")}>Auto Mode</button>

              {(admin || staffAdmin) && tvMode === "showcase" ? (
                <>
                  <button type="button" className={tvShowcaseMode === "mixed" ? "btn primary" : "btn secondary"} onClick={() => setTvShowcaseMode("mixed")}>Mixed Showcase</button>
                  <button type="button" className={tvShowcaseMode === "custom_only" ? "btn primary" : "btn secondary"} onClick={() => setTvShowcaseMode("custom_only")}>Custom Slides Only</button>
                  <button type="button" className="btn secondary" onClick={addCustomTvSlide}>+ Add Slide</button>
                  <button type="button" className="btn secondary" onClick={triggerTvSlideImagePicker}>Upload Slide Image</button>
                  <button type="button" className="btn secondary" onClick={editCurrentTvSlide}>Edit Current Slide</button>
                  <button type="button" className="btn secondary" onClick={() => moveCurrentTvSlide("up")}>Move Up</button>
                  <button type="button" className="btn secondary" onClick={() => moveCurrentTvSlide("down")}>Move Down</button>
                  <button type="button" className="btn danger" onClick={deleteCurrentTvSlide}>Delete Current Slide</button>
                </>
              ) : null}

              {(admin || staffAdmin) && (matches.length || revealCards.length) ? (
                <button type="button" className="btn secondary" onClick={triggerFixtureReveal}>Replay Reveal</button>
              ) : null}
            </div>
          </div>

          {fixtureRevealStage !== "idle" && fixtureRevealStage !== "done"
            ? renderFixtureReveal()
            : showFixtureView
            ? renderFixtureView()
            : renderSlide(activeSlide)}
        </div>
      </div>
    </>
  );
}

"use strict";

/* Read-only operator dashboard: fetches its own API on a 5s poll and
 * re-renders. No build step - plain fetch + DOM, matching the rest of this
 * repo's "no bundler, tsx runs source directly" philosophy. */

const POLL_MS = 5000;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function fmtUsd(n) {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n) {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function fmtNum(n, digits = 0) {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtTime(ms) {
  if (!ms) return "—";
  const d = new Date(ms);
  return d.toLocaleTimeString(undefined, { hour12: false });
}

function fmtAgo(ms) {
  if (!ms) return "—";
  const deltaSec = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (deltaSec < 60) return `${deltaSec}s ago`;
  if (deltaSec < 3600) return `${Math.round(deltaSec / 60)}m ago`;
  return `${Math.round(deltaSec / 3600)}h ago`;
}

function shortAddr(addr) {
  if (!addr) return "—";
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 5)}…${addr.slice(-4)}`;
}

/* Whether the running feed is a real chain feed. Mock-scenario addresses are
 * fabricated, so linking them out to an explorer would only ever 404 - links
 * are rendered as plain text until a real provider is connected. */
let feedIsReal = false;

const EXPLORER_URL = {
  token: (v) => `https://dexscreener.com/solana/${encodeURIComponent(v)}`,
  wallet: (v) => `https://solscan.io/account/${encodeURIComponent(v)}`,
  tx: (v) => `https://solscan.io/tx/${encodeURIComponent(v)}`,
};

function addrCell(value, kind) {
  if (!value) return el("td", { class: "mono", text: "—" });
  if (!feedIsReal) {
    return el("td", { class: "mono", title: `${value} (simulated - no explorer page exists)` }, [
      shortAddr(value),
    ]);
  }
  return el("td", { class: "mono" }, [
    el("a", {
      class: "addr-link",
      href: EXPLORER_URL[kind](value),
      target: "_blank",
      rel: "noopener noreferrer",
      title: value,
      text: shortAddr(value),
    }),
  ]);
}

function renderSourceBanner(overview) {
  const banner = $("#source-banner");
  const providers = Object.keys(overview.feed || {});
  feedIsReal = providers.length > 0 && providers.some((p) => p !== "mock");

  banner.hidden = false;
  if (feedIsReal) {
    banner.className = "source-banner source-banner-live";
    banner.textContent = `LIVE CHAIN DATA · feed: ${providers.join(", ")} · trades are still paper-simulated`;
  } else {
    banner.className = "source-banner source-banner-mock";
    banner.textContent =
      "SIMULATED DATA · mock feed - wallets, tokens and trades below are fabricated fixtures, not real chain activity";
  }
}

function pnlClass(n) {
  return n > 0 ? "pnl-positive" : n < 0 ? "pnl-negative" : "";
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child) node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

async function getJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

function setConnectionState(ok) {
  const pill = $("#connection-pill");
  if (ok) {
    pill.className = "pill pill-good";
    // "polling", not "live": this reports the browser->API poll, and reading
    // it as "the data is live" is exactly the wrong conclusion on a mock feed.
    pill.textContent = "polling";
  } else {
    pill.className = "pill pill-bad";
    pill.textContent = "disconnected";
  }
}

function renderStatTiles(overview) {
  const grid = $("#stat-grid");
  grid.innerHTML = "";

  const tiles = [
    {
      label: "Realized PnL",
      value: fmtUsd(overview.report.totalPnlUsd),
      cls: overview.report.totalPnlUsd > 0 ? "positive" : overview.report.totalPnlUsd < 0 ? "negative" : "",
      sub: `equity ${fmtUsd(overview.currentEquityUsd)}`,
    },
    {
      label: "Win rate",
      value: fmtPct(overview.report.winRate),
      sub: `${overview.report.closedTrades} closed trades`,
    },
    {
      label: "Expectancy",
      value: fmtUsd(overview.report.expectancyUsd),
      sub: "per closed trade",
    },
    {
      label: "Profit factor",
      value: Number.isFinite(overview.report.profitFactor) ? overview.report.profitFactor.toFixed(2) : "∞",
      sub: `max drawdown ${overview.report.maxDrawdownPct.toFixed(1)}%`,
    },
    {
      label: "Open positions",
      value: fmtNum(overview.openPositionCount),
      sub: `${overview.totalPositionCount} total opened`,
    },
    {
      label: "Avg win / loss",
      value: `${fmtUsd(overview.avgWinUsd)} / ${fmtUsd(overview.avgLossUsd)}`,
      sub: "per closed trade",
    },
    {
      label: "Signals",
      value: fmtNum(overview.signalsGenerated),
      sub: `${overview.signalsRejected} rejected`,
    },
    {
      label: "Watchlist",
      value: fmtNum(overview.watchlistCounts.active),
      sub: `${overview.watchlistCounts.pending} pending review`,
    },
  ];

  for (const t of tiles) {
    grid.appendChild(
      el("div", { class: "stat-tile" }, [
        el("p", { class: "stat-label", text: t.label }),
        el("div", { class: `stat-value ${t.cls || ""}`, text: t.value }),
        el("p", { class: "stat-sub", text: t.sub }),
      ]),
    );
  }
}

function renderHealth(overview) {
  const strip = $("#health-strip");
  strip.innerHTML = "";

  const feedEntries = Object.entries(overview.feed || {});
  if (feedEntries.length === 0) {
    strip.appendChild(el("div", { class: "health-row" }, [el("span", { class: "health-label", text: "feed" }), pillFor(false, "no data")]));
  }
  for (const [provider, health] of feedEntries) {
    strip.appendChild(
      el("div", { class: "health-row" }, [el("span", { class: "health-label", text: provider }), pillFor(health.connected, health.connected ? "connected" : "down")]),
    );
  }

  strip.appendChild(el("hr", { class: "health-divider" }));

  strip.appendChild(rowKv("orders submitted", fmtNum(overview.ordersSubmitted)));
  strip.appendChild(rowKv("orders confirmed", fmtNum(overview.ordersConfirmed)));
  strip.appendChild(rowKv("orders failed", fmtNum(overview.ordersFailed)));

  const stageEntries = Object.entries(overview.latencyMsByStage || {});
  if (stageEntries.length > 0) {
    strip.appendChild(el("hr", { class: "health-divider" }));
    for (const [stage, lat] of stageEntries) {
      strip.appendChild(rowKv(`${stage} latency (p50/p95)`, `${fmtNum(lat.p50)}ms / ${fmtNum(lat.p95)}ms`));
    }
  }
}

function pillFor(ok, label) {
  return el("span", { class: `pill ${ok ? "pill-good" : "pill-bad"}`, text: label });
}

function rowKv(label, value) {
  return el("div", { class: "health-row" }, [el("span", { class: "health-label", text: label }), el("span", { class: "health-value", text: value })]);
}

function renderPositionsTable(positions) {
  const tbody = $("#positions-table tbody");
  tbody.innerHTML = "";
  $("#positions-count").textContent = String(positions.length);
  $("#positions-table").parentElement.querySelector(".empty-state").hidden = positions.length > 0;

  for (const p of positions) {
    tbody.appendChild(
      el("tr", { class: "row-clickable", "data-wallet": p.wallet }, [
        addrCell(p.tokenMint, "token"),
        addrCell(p.wallet, "wallet"),
        el("td", { class: "num", text: fmtUsd(p.entryPriceUsd) }),
        el("td", { class: "num", text: fmtUsd(p.currentPriceUsd) }),
        el("td", { class: `num ${pnlClass(p.unrealizedPnlUsd)}`, text: fmtUsd(p.unrealizedPnlUsd) }),
        el("td", { class: "num", text: p.signalScore !== undefined ? p.signalScore.toFixed(0) : "—" }),
        el("td", { text: fmtAgo(p.openedAt) }),
      ]),
    );
  }
}

function renderTradesTable(trades) {
  const tbody = $("#trades-table tbody");
  tbody.innerHTML = "";
  $("#trades-count").textContent = String(trades.length);
  $("#trades-table").parentElement.querySelector(".empty-state").hidden = trades.length > 0;

  for (const t of trades) {
    const pnl = t.status === "CLOSED" ? t.realizedPnlUsd : t.unrealizedPnlUsd;
    tbody.appendChild(
      el("tr", { class: "row-clickable", "data-wallet": t.wallet }, [
        addrCell(t.tokenMint, "token"),
        addrCell(t.wallet, "wallet"),
        el("td", {}, [el("span", { class: `pill ${t.status === "OPEN" ? "pill-accent" : "pill-neutral"}`, text: t.status.toLowerCase() })]),
        el("td", { class: "num", text: fmtUsd(t.entryPriceUsd) }),
        el("td", { class: `num ${pnlClass(pnl)}`, text: fmtUsd(pnl) }),
        el("td", { class: "num", text: t.signalScore !== undefined ? t.signalScore.toFixed(0) : "—" }),
        el("td", { text: t.exitReason || "—" }),
        el("td", { text: t.closedAt ? fmtAgo(t.closedAt) : "—" }),
      ]),
    );
  }
}

function renderWhalesTable(whales) {
  const tbody = $("#whales-table tbody");
  tbody.innerHTML = "";
  $("#whales-count").textContent = String(whales.length);
  $("#whales-table").parentElement.querySelector(".empty-state").hidden = whales.length > 0;

  for (const w of whales) {
    tbody.appendChild(
      el("tr", { class: "row-clickable", "data-wallet": w.address }, [
        el("td", { class: "mono", text: w.label || shortAddr(w.address) }),
        el("td", {}, [el("span", { class: `pill ${statusPillClass(w.status)}`, text: w.status || "unknown" })]),
        el("td", { class: "num", text: w.whaleScore !== undefined ? w.whaleScore.toFixed(0) : "—" }),
        el("td", { class: "num", text: fmtNum(w.tradeCount) }),
        el("td", { class: `num ${pnlClass(w.realizedPnlUsd)}`, text: fmtUsd(w.realizedPnlUsd) }),
      ]),
    );
  }
}

function statusPillClass(status) {
  if (status === "active") return "pill-good";
  if (status === "pending") return "pill-warn";
  if (status === "rejected") return "pill-bad";
  return "pill-neutral";
}

function renderCandidatesTable(candidates) {
  const tbody = $("#candidates-table tbody");
  tbody.innerHTML = "";
  $("#candidates-count").textContent = String(candidates.length);
  $("#candidates-table").parentElement.querySelector(".empty-state").hidden = candidates.length > 0;

  for (const c of candidates) {
    tbody.appendChild(
      el("tr", {}, [
        el("td", { class: "mono", text: c.label || shortAddr(c.address) }),
        el("td", { class: "num", text: c.whaleScore !== undefined ? c.whaleScore.toFixed(0) : "—" }),
        el("td", {}, [el("span", { class: `pill ${c.passedHardGate ? "pill-good" : "pill-bad"}`, text: c.passedHardGate ? "passed" : "failed" })]),
      ]),
    );
  }
}

function renderSignalLog(signals) {
  const list = $("#signal-log");
  list.innerHTML = "";
  $("#signals-count").textContent = String(signals.length);
  $("#signals-empty").hidden = signals.length > 0;

  for (const s of signals) {
    const isGenerated = s.kind === "generated";
    list.appendChild(
      el("li", {}, [
        el("span", { class: `sig-badge ${s.kind}` }),
        el("div", { class: "sig-body" }, [
          el("div", { class: "sig-token", text: shortAddr(s.tokenMint) }),
          el("div", {
            class: "sig-meta",
            text: isGenerated ? `signal generated · score ${s.score !== undefined ? s.score.toFixed(0) : "—"}` : `rejected · ${s.reason}`,
          }),
        ]),
        el("span", { class: "sig-time", text: fmtTime(s.at) }),
      ]),
    );
  }
}

function openWhaleDrawer(address) {
  const drawer = $("#whale-drawer");
  const content = $("#whale-drawer-content");
  content.innerHTML = "<p class=\"empty-state\">Loading…</p>";
  drawer.hidden = false;

  getJson(`/api/whales/${encodeURIComponent(address)}`)
    .then((detail) => renderWhaleDrawer(detail))
    .catch(() => {
      content.innerHTML = "<p class=\"empty-state\">Could not load whale detail.</p>";
    });
}

function renderWhaleDrawer(detail) {
  const content = $("#whale-drawer-content");
  content.innerHTML = "";

  content.appendChild(el("h3", { text: detail.address }));
  content.appendChild(el("p", { class: "stat-sub", text: detail.entry?.label || (detail.entry ? `${detail.entry.status} · ${detail.entry.source}` : "not on watchlist") }));

  if (detail.score) {
    const section = el("div", { class: "drawer-section" }, [el("h4", { text: "Whale Score" })]);
    const grid = el("div", { class: "score-grid" });
    const items = [
      ["Overall", detail.score.whaleScore],
      ["Consistency", detail.score.consistency],
      ["Timing", detail.score.timing],
      ["Selectivity", detail.score.selectivity],
      ["Exit quality", detail.score.exitQuality],
      ["Rug avoidance", detail.score.rugAvoidance],
      ["Recent perf.", detail.score.recentPerformance],
    ];
    for (const [label, value] of items) {
      grid.appendChild(
        el("div", { class: "score-item" }, [
          el("div", { class: "score-label", text: label }),
          el("div", { class: "score-value", text: value !== undefined ? value.toFixed(1) : "—" }),
        ]),
      );
    }
    section.appendChild(grid);
    content.appendChild(section);

    if (!detail.score.passedHardGate && detail.score.gateFailureReasons?.length) {
      const reasons = el("div", { class: "drawer-section" }, [el("h4", { text: "Gate failure reasons" })]);
      const list = el("ul", { style: "margin:0;padding-left:18px;color:var(--text-dim);font-size:12px;" });
      for (const r of detail.score.gateFailureReasons) list.appendChild(el("li", { text: r }));
      reasons.appendChild(list);
      content.appendChild(reasons);
    }
  }

  const tradesSection = el("div", { class: "drawer-section" }, [el("h4", { text: `Trades (${detail.trades.length})` })]);
  if (detail.trades.length === 0) {
    tradesSection.appendChild(el("p", { class: "empty-state", text: "No trades from this wallet yet." }));
  } else {
    const table = el("table");
    table.appendChild(
      el("thead", {}, [
        el("tr", {}, [el("th", { text: "Token" }), el("th", { class: "num", text: "PnL" }), el("th", { text: "Status" })]),
      ]),
    );
    const tbody = el("tbody");
    for (const t of detail.trades) {
      const pnl = t.status === "CLOSED" ? t.realizedPnlUsd : t.unrealizedPnlUsd;
      tbody.appendChild(
        el("tr", {}, [
          addrCell(t.tokenMint, "token"),
          el("td", { class: `num ${pnlClass(pnl)}`, text: fmtUsd(pnl) }),
          el("td", { text: t.status.toLowerCase() }),
        ]),
      );
    }
    table.appendChild(tbody);
    tradesSection.appendChild(el("div", { class: "table-scroll" }, [table]));
  }
  content.appendChild(tradesSection);
}

function wireWhaleClicks() {
  document.addEventListener("click", (ev) => {
    const row = ev.target.closest("tr[data-wallet]");
    if (row) openWhaleDrawer(row.getAttribute("data-wallet"));
  });

  $("#whale-drawer-close").addEventListener("click", closeWhaleDrawer);
  $("#whale-drawer-backdrop").addEventListener("click", closeWhaleDrawer);
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeWhaleDrawer();
  });
}

function closeWhaleDrawer() {
  $("#whale-drawer").hidden = true;
}

async function refresh() {
  try {
    const [overview, positions, trades, whales, candidates, signals] = await Promise.all([
      getJson("/api/overview"),
      getJson("/api/positions"),
      getJson("/api/trades?limit=50"),
      getJson("/api/whales"),
      getJson("/api/candidates"),
      getJson("/api/signals?limit=60"),
    ]);

    // Before the tables: sets feedIsReal, which decides whether addresses
    // render as explorer links or inert text.
    renderSourceBanner(overview);
    renderStatTiles(overview);
    renderHealth(overview);
    renderPositionsTable(positions);
    renderTradesTable(trades);
    renderWhalesTable(whales);
    renderCandidatesTable(candidates);
    renderSignalLog(signals);

    setConnectionState(true);
    $("#updated-at").textContent = `updated ${fmtTime(Date.now())}`;
  } catch (err) {
    setConnectionState(false);
    console.error("dashboard refresh failed", err);
  }
}

function init() {
  wireWhaleClicks();
  refresh();
  setInterval(refresh, POLL_MS);
}

init();

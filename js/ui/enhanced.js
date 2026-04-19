// ============================================================================
// Enhanced UI (v0.2) — Command Palette, Keyboard Shortcut Help,
// Language Reference Drawer, Match Loading Overlay, Match History
// ============================================================================
//
// These widgets live in their own module so app.js doesn't balloon further.
// They hook into the main app by accepting a small set of callbacks at
// install time (compile / run / load-bot / enter-view), and they read the
// read-only snapshots the app exposes through the same function.
// ============================================================================

import { LANG_REFERENCE } from "./lang-reference-data.js";

const MATCH_HISTORY_KEY = "arenascript.match_history.v1";
const MATCH_HISTORY_MAX = 25;

// --- Match history persistence ----------------------------------------------

export function recordMatchHistory(entry) {
  try {
    const raw = localStorage.getItem(MATCH_HISTORY_KEY);
    const list = raw ? JSON.parse(raw) : [];
    list.unshift({
      id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      ts: Date.now(),
      ...entry,
    });
    while (list.length > MATCH_HISTORY_MAX) list.pop();
    localStorage.setItem(MATCH_HISTORY_KEY, JSON.stringify(list));
    return list;
  } catch (e) {
    console.warn("recordMatchHistory failed", e);
    return [];
  }
}

export function getMatchHistory() {
  try {
    const raw = localStorage.getItem(MATCH_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

export function clearMatchHistory() {
  localStorage.removeItem(MATCH_HISTORY_KEY);
}

// --- Match loading overlay --------------------------------------------------

const loadingEl = () => document.getElementById("match-loading");
const loadingTextEl = () => document.getElementById("match-loading-text");
const loadingSubEl = () => document.getElementById("match-loading-sub");

export function showMatchLoading(text = "Simulating match…", sub = "Preparing combatants") {
  const el = loadingEl();
  if (!el) return;
  if (loadingTextEl()) loadingTextEl().textContent = text;
  if (loadingSubEl()) loadingSubEl().textContent = sub;
  el.hidden = false;
}

export function updateMatchLoading(sub) {
  if (loadingSubEl() && sub) loadingSubEl().textContent = sub;
}

export function hideMatchLoading() {
  const el = loadingEl();
  if (el) el.hidden = true;
}

// --- Keyboard shortcut help modal ------------------------------------------

export function installShortcutHelp() {
  const modal = document.getElementById("shortcut-help");
  const closeBtn = document.getElementById("btn-close-shortcut-help");
  const openBtn = document.getElementById("btn-show-help");
  if (!modal) return;

  const open = () => { modal.hidden = false; };
  const close = () => { modal.hidden = true; };

  closeBtn?.addEventListener("click", close);
  openBtn?.addEventListener("click", open);

  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });

  // Shift+? opens the dialog. We use "?" as the key so layout differences
  // (which shift a different punctuation key into /?) still work.
  document.addEventListener("keydown", (e) => {
    if (e.key === "?" && !isTypingTarget(e.target)) {
      e.preventDefault();
      modal.hidden ? open() : close();
    }
    if (e.key === "Escape" && !modal.hidden) close();
  });
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

// --- Language reference drawer ---------------------------------------------

export function installLangReference() {
  const drawer = document.getElementById("lang-ref-drawer");
  const closeBtn = document.getElementById("btn-close-lang-ref");
  const openBtn = document.getElementById("btn-open-lang-ref");
  const navEl = document.getElementById("lang-ref-nav");
  const contentEl = document.getElementById("lang-ref-content");
  const searchEl = document.getElementById("lang-ref-search");
  if (!drawer || !navEl || !contentEl) return;

  let currentSection = LANG_REFERENCE[0]?.id ?? null;
  let currentQuery = "";

  function render() {
    navEl.innerHTML = "";
    for (const section of LANG_REFERENCE) {
      const btn = document.createElement("button");
      btn.textContent = section.label;
      btn.classList.toggle("active", section.id === currentSection);
      btn.addEventListener("click", () => {
        currentSection = section.id;
        render();
      });
      navEl.appendChild(btn);
    }

    const section = LANG_REFERENCE.find(s => s.id === currentSection) ?? LANG_REFERENCE[0];
    if (!section) return;
    const q = currentQuery.trim().toLowerCase();
    const entries = section.entries.filter(e => {
      if (!q) return true;
      return (e.name + " " + (e.desc || "") + " " + (e.sig || ""))
        .toLowerCase()
        .includes(q);
    });

    contentEl.innerHTML = "";
    if (entries.length === 0) {
      contentEl.innerHTML = `<div style="color:var(--text-muted); padding: 20px 0; text-align: center;">No entries match "${escapeHtml(q)}".</div>`;
      return;
    }

    for (const entry of entries) {
      const row = document.createElement("div");
      row.className = "lang-ref-entry";
      row.innerHTML = `
        <code class="name">${escapeHtml(entry.name)}</code>
        ${entry.sig ? `<div class="sig">${escapeHtml(entry.sig)}</div>` : ""}
        <div class="desc">${escapeHtml(entry.desc ?? "")}</div>
        ${entry.example ? `<pre>${escapeHtml(entry.example)}</pre>` : ""}`;
      contentEl.appendChild(row);
    }
  }

  function open(sectionId) {
    if (sectionId) currentSection = sectionId;
    drawer.hidden = false;
    render();
    setTimeout(() => searchEl?.focus(), 50);
  }

  function close() { drawer.hidden = true; }

  closeBtn?.addEventListener("click", close);
  openBtn?.addEventListener("click", () => open());

  searchEl?.addEventListener("input", (e) => {
    currentQuery = e.target.value;
    render();
  });

  document.addEventListener("keydown", (e) => {
    // Ctrl/Cmd + / opens reference
    if ((e.ctrlKey || e.metaKey) && e.key === "/") {
      e.preventDefault();
      drawer.hidden ? open() : close();
    }
    if (e.key === "Escape" && !drawer.hidden) close();
  });

  return { open, close };
}

// --- Command palette --------------------------------------------------------

export function installCommandPalette(getCommands) {
  const palette = document.getElementById("cmd-palette");
  const input = document.getElementById("cmd-palette-input");
  const list = document.getElementById("cmd-palette-list");
  const openBtn = document.getElementById("btn-open-palette");
  const backdrop = palette?.querySelector(".cmd-palette-backdrop");
  if (!palette || !input || !list) return;

  let commands = [];
  let filtered = [];
  let active = 0;

  function open() {
    commands = getCommands();
    input.value = "";
    filterAndRender("");
    palette.hidden = false;
    setTimeout(() => input.focus(), 20);
  }
  function close() {
    palette.hidden = true;
  }

  function filterAndRender(query) {
    const q = query.trim().toLowerCase();
    filtered = !q
      ? commands
      : commands
          .map(c => ({ c, score: scoreMatch(c, q) }))
          .filter(x => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .map(x => x.c);
    active = 0;
    render();
  }

  function render() {
    list.innerHTML = "";
    if (filtered.length === 0) {
      list.innerHTML = `<div class="cmd-empty">No matches.</div>`;
      return;
    }
    for (let i = 0; i < filtered.length; i++) {
      const cmd = filtered[i];
      const div = document.createElement("div");
      div.className = "cmd-item" + (i === active ? " active" : "");
      div.setAttribute("role", "option");
      div.innerHTML = `
        <span class="cmd-item-icon kind-${cmd.kind}">${cmd.icon ?? "•"}</span>
        <span class="cmd-item-label">${escapeHtml(cmd.label)}</span>
        ${cmd.hint ? `<span class="cmd-item-hint">${escapeHtml(cmd.hint)}</span>` : ""}`;
      div.addEventListener("click", () => {
        try { cmd.run(); } catch (err) { console.error("command failed", err); }
        close();
      });
      div.addEventListener("mouseenter", () => {
        active = i;
        updateActive();
      });
      list.appendChild(div);
    }
  }

  function updateActive() {
    [...list.children].forEach((el, i) => {
      el.classList.toggle("active", i === active);
    });
    const el = list.children[active];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }

  input.addEventListener("input", (e) => filterAndRender(e.target.value));

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (filtered.length === 0) return;
      active = (active + 1) % filtered.length;
      updateActive();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (filtered.length === 0) return;
      active = (active - 1 + filtered.length) % filtered.length;
      updateActive();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered[active];
      if (cmd) {
        try { cmd.run(); } catch (err) { console.error("command failed", err); }
        close();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  });

  backdrop?.addEventListener("click", close);
  openBtn?.addEventListener("click", open);

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      palette.hidden ? open() : close();
    }
  });

  return { open, close };
}

// Fuzzy-match score: higher = better.
// Prefers prefix hits, then substring, then scattered-char hits.
function scoreMatch(cmd, query) {
  const hay = (cmd.label + " " + (cmd.hint ?? "") + " " + (cmd.keywords ?? []).join(" "))
    .toLowerCase();
  if (hay.startsWith(query)) return 100;
  const idx = hay.indexOf(query);
  if (idx >= 0) return 80 - idx;
  // Scattered character match (very loose)
  let j = 0;
  for (let i = 0; i < hay.length && j < query.length; i++) {
    if (hay[i] === query[j]) j++;
  }
  if (j === query.length) return 30 - (hay.length - query.length) * 0.1;
  return 0;
}

// --- Utilities --------------------------------------------------------------

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  }[c]));
}

// ============================================================================
// ArenaScript Frontend — Main Application
// ============================================================================

import { compile } from "./lang/pipeline.js";
import { runMatch } from "./engine/tick.js";
import {
  ARENA_WIDTH, ARENA_HEIGHT,
  CLASS_STATS, ENGINE_VERSION,
} from "./shared/config.js";

// ============================================================================
// Example Bot Source Code
// ============================================================================

const BOT_PRESETS = {
  bruiser: {
    name: "Bruiser",
    class: "brawler",
    source: `robot "Bruiser" version "1.0"

meta {
  author: "Player1"
  class: "brawler"
}

const {
  ENGAGE_RANGE = 8
}

state {
  mode: string = "hunt"
}

on spawn {
  set mode = "hunt"
}

on tick {
  let enemy = nearest_enemy()
  if enemy != null {
    if can_attack(enemy) {
      attack enemy
    } else {
      move_toward enemy.position
    }
  } else {
    move_to nearest_enemy_control_point()
  }
}

on damaged(event) {
  set mode = "fight"
}`,
  },

  kiter: {
    name: "Kiter",
    class: "ranger",
    source: `robot "Kiter" version "1.0"

meta {
  author: "Player2"
  class: "ranger"
}

const {
  SAFE_HEALTH = 30
  ATTACK_RANGE = 7
}

state {
  target_id: id? = null
  retreating: boolean = false
}

on spawn {
  set retreating = false
}

on tick {
  let enemy = nearest_enemy()

  if enemy == null {
    move_to nearest_enemy_control_point()
    return
  }

  if health() < SAFE_HEALTH {
    set retreating = true
    retreat
    return
  }

  set retreating = false

  if can_attack(enemy) {
    attack enemy
  } else {
    move_toward enemy.position
  }
}

on low_health {
  set retreating = true
}`,
  },

  fortress: {
    name: "Fortress",
    class: "tank",
    source: `robot "Fortress" version "1.0"

meta {
  author: "Player3"
  class: "tank"
}

on spawn {
  move_to nearest_enemy_control_point()
}

on tick {
  let enemy = nearest_enemy()
  if enemy == null {
    move_to nearest_enemy_control_point()
    return
  }

  if health() < 55 {
    shield
    move_to nearest_enemy_control_point()
    return
  }

  if can_attack(enemy) {
    attack enemy
  } else {
    move_toward enemy.position
  }
}

on damaged {
  if health() < 45 {
    shield
  }
}`,
  },

  healer: {
    name: "Healer",
    class: "support",
    source: `robot "Healer" version "1.0"

meta {
  author: "Player4"
  class: "support"
}

state {
  retreating: boolean = false
}

on tick {
  let enemy = nearest_enemy()

  if enemy == null {
    move_to nearest_enemy_control_point()
    return
  }

  if health() < 35 {
    set retreating = true
    retreat
    return
  }

  set retreating = false

  if can_attack(enemy) {
    attack enemy
  } else {
    move_toward enemy.position
  }
}

on low_health {
  set retreating = true
  retreat
}`,
  },

  flanker: {
    name: "Flanker",
    class: "ranger",
    source: `robot "Flanker" version "1.0"

meta {
  author: "ArenaLab"
  class: "ranger"
}

on tick {
  let enemy = nearest_enemy()
  let allies = visible_allies()

  if enemy == null {
    move_to nearest_enemy_control_point()
    return
  }

  if allies != null and enemy_count_in_range(10) > 1 {
    strafe_right
    return
  }

  if can_attack(enemy) {
    attack enemy
  } else {
    move_toward enemy.position
  }
}`,
  },

  sentinel: {
    name: "Sentinel",
    class: "tank",
    source: `robot "Sentinel" version "1.0"

meta {
  author: "ArenaLab"
  class: "tank"
}

on tick {
  let enemy = nearest_enemy()

  if enemy == null {
    move_to nearest_enemy_control_point()
    return
  }

  if health() < 65 {
    shield
  }

  if can_attack(enemy) {
    attack enemy
  } else {
    move_toward enemy.position
  }
}`,
  },
};

const TEAM_PRESETS = {
  skirmish_pair: {
    name: "Skirmish Pair",
    allies: ["bruiser", "healer"],
    opponents: ["kiter", "fortress"],
  },
  pressure_line: {
    name: "Pressure Line",
    allies: ["sentinel", "flanker"],
    opponents: ["fortress", "kiter"],
  },
};

// ============================================================================
// DOM References
// ============================================================================

const editorEl = document.getElementById("code-editor");
const highlightEl = document.getElementById("highlight-layer");
const lineNumbersEl = document.getElementById("line-numbers");
const errorBarEl = document.getElementById("error-bar");
const btnCompile = document.getElementById("btn-compile");
const btnRun = document.getElementById("btn-run");
const btnCompileRun = document.getElementById("btn-compile-run");
const btnClear = document.getElementById("btn-clear");
const diagnosticSummaryEl = document.getElementById("diagnostic-summary");
const consoleEl = document.getElementById("console-output");
const canvasEl = document.getElementById("arena-canvas");
const arenaStatus = document.getElementById("arena-status");
const matchResultsEl = document.getElementById("match-results");
const resultsContentEl = document.getElementById("results-content");
const opponentSelect = document.getElementById("opponent-select");
const matchModeSelect = document.getElementById("match-mode");
const teamPresetSelect = document.getElementById("team-preset-select");
const btnRunTeamSim = document.getElementById("btn-run-team-sim");
const presetButtons = document.querySelectorAll(".bot-preset");

// Replay controls
const replayControlsEl = document.getElementById("replay-controls");
const btnReplayToggle = document.getElementById("btn-replay-toggle");
const btnReplayStep = document.getElementById("btn-replay-step");
const btnReplayStepBack = document.getElementById("btn-replay-step-back");
const replayScrubber = document.getElementById("replay-scrubber");
const replayTickLabel = document.getElementById("replay-tick-label");
const replaySpeedSelect = document.getElementById("replay-speed");
const resultsRobotDetailEl = document.getElementById("results-robot-detail");

const ctx = canvasEl.getContext("2d");

// ============================================================================
// State
// ============================================================================

let compiledPlayer = null;
let currentPreset = "bruiser";
let lastMatchResult = null;
let lastCompileErrors = [];

// Replay state
let replayData = null;
let replayPlaying = false;
let replayFrameIndex = 0;
let replayAnimId = null;
let replayLabels = {};
let replaySpeed = 1;
let lastReplayTimestamp = 0;

// ============================================================================
// Syntax Highlighting
// ============================================================================

const KEYWORDS = new Set([
  "robot", "version", "meta", "const", "state", "on", "fn",
  "let", "set", "if", "else", "for", "in", "return",
  "and", "or", "not",
]);

const ACTIONS = new Set([
  "move_to", "move_toward", "strafe_left", "strafe_right", "stop",
  "attack", "fire_at", "use_ability", "shield", "retreat",
  "mark_target", "capture", "ping",
]);

const BUILTINS = new Set([
  "health", "max_health", "energy", "position", "velocity", "heading", "cooldown",
  "nearest_enemy", "visible_enemies", "enemy_count_in_range",
  "nearest_ally", "visible_allies",
  "nearest_cover", "nearest_resource", "nearest_control_point",
  "nearest_enemy_control_point",
  "distance_to", "line_of_sight", "current_tick",
  "can_attack",
]);

const TYPES = new Set([
  "number", "boolean", "string", "id", "vector", "direction",
  "robot_ref", "enemy", "ally", "projectile", "resource_node",
  "control_point", "event", "position", "list",
]);

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function highlightCode(source) {
  // Tokenize with regex for robust highlighting (works on incomplete code)
  const patterns = [
    { regex: /\/\/[^\n]*/g, cls: "comment" },
    { regex: /"(?:[^"\\]|\\.)*"/g, cls: "string" },
    { regex: /\b\d+(?:\.\d+)?\b/g, cls: "number" },
    { regex: /\b(?:true|false)\b/g, cls: "bool" },
    { regex: /\bnull\b/g, cls: "null" },
    // identifiers — classified in replacer
    { regex: /\b[a-zA-Z_]\w*\b/g, cls: "ident" },
    { regex: /[{}(),:.\->?=!<>+\-*/%]+/g, cls: "punct" },
  ];

  // Build a combined sorted list of matches
  const matches = [];
  for (const { regex, cls } of patterns) {
    regex.lastIndex = 0;
    let m;
    while ((m = regex.exec(source)) !== null) {
      matches.push({ start: m.index, end: m.index + m[0].length, text: m[0], cls });
    }
  }

  // Sort by start position, then longest first to handle overlaps
  matches.sort((a, b) => a.start - b.start || b.end - a.end);

  // Remove overlapping matches (keep first)
  const filtered = [];
  let lastEnd = 0;
  for (const m of matches) {
    if (m.start >= lastEnd) {
      filtered.push(m);
      lastEnd = m.end;
    }
  }

  // Build highlighted HTML
  let html = "";
  let pos = 0;
  for (const m of filtered) {
    if (m.start > pos) {
      html += escapeHtml(source.slice(pos, m.start));
    }
    let cls = m.cls;
    // Classify identifiers
    if (cls === "ident") {
      const word = m.text;
      if (KEYWORDS.has(word)) cls = "keyword";
      else if (ACTIONS.has(word)) cls = "action";
      else if (BUILTINS.has(word)) cls = "builtin";
      else if (TYPES.has(word)) cls = "type";
      else cls = "ident";
    }
    html += `<span class="hl-${cls}">${escapeHtml(m.text)}</span>`;
    pos = m.end;
  }
  if (pos < source.length) {
    html += escapeHtml(source.slice(pos));
  }

  // Ensure trailing newline so heights match
  if (!html.endsWith("\n")) html += "\n";

  return html;
}

function updateHighlighting() {
  const source = editorEl.value;
  highlightEl.innerHTML = highlightCode(source);
}

// ============================================================================
// Line Numbers
// ============================================================================

function updateLineNumbers() {
  const source = editorEl.value;
  const lineCount = source.split("\n").length;
  const errorLines = new Set(lastCompileErrors.map(e => e.line));

  let html = "";
  for (let i = 1; i <= lineCount; i++) {
    if (errorLines.has(i)) {
      html += `<div class="error-line">${i}</div>`;
    } else {
      html += `<div>${i}</div>`;
    }
  }
  lineNumbersEl.innerHTML = html;
}

// ============================================================================
// Scroll Sync
// ============================================================================

function syncScroll() {
  highlightEl.scrollTop = editorEl.scrollTop;
  highlightEl.scrollLeft = editorEl.scrollLeft;
  lineNumbersEl.scrollTop = editorEl.scrollTop;
}

// ============================================================================
// Error Display
// ============================================================================

function updateDiagnosticSummary(errors = [], warnings = []) {
  if (!diagnosticSummaryEl) return;
  const errCount = errors.length;
  const warnCount = warnings.length;

  if (errCount === 0 && warnCount === 0) {
    diagnosticSummaryEl.textContent = "No diagnostics";
    diagnosticSummaryEl.className = "diagnostic-summary";
    return;
  }

  const parts = [];
  if (errCount > 0) parts.push(`${errCount} error${errCount === 1 ? "" : "s"}`);
  if (warnCount > 0) parts.push(`${warnCount} warning${warnCount === 1 ? "" : "s"}`);
  diagnosticSummaryEl.textContent = parts.join(" • ");
  diagnosticSummaryEl.className = `diagnostic-summary ${errCount > 0 ? "has-errors" : "has-warnings"}`;
}

function jumpToLine(line) {
  if (!line || line < 1) return;
  const lines = editorEl.value.split("\n");
  let cursor = 0;
  const target = Math.min(line, lines.length);
  for (let i = 1; i < target; i++) {
    cursor += lines[i - 1].length + 1;
  }

  editorEl.focus();
  editorEl.setSelectionRange(cursor, cursor);

  const lineHeight = parseFloat(getComputedStyle(editorEl).lineHeight) || 20;
  const topPad = parseFloat(getComputedStyle(editorEl).paddingTop) || 0;
  editorEl.scrollTop = Math.max(0, (target - 1) * lineHeight - topPad - lineHeight * 2);
  syncScroll();
}

function showErrors(errors) {
  if (!errors || errors.length === 0) {
    errorBarEl.classList.remove("visible");
    errorBarEl.innerHTML = "";
    lastCompileErrors = [];
    return;
  }
  lastCompileErrors = errors;
  errorBarEl.classList.add("visible");
  errorBarEl.innerHTML = errors.map(e => {
    const lineNum = e.line ? `<button type="button" class="error-line-num" data-line="${e.line}">Ln ${e.line}</button>` : "";
    return `<div class="error-line-entry">${lineNum}${escapeHtml(e.message || e)}</div>`;
  }).join("");

  errorBarEl.querySelectorAll(".error-line-num[data-line]").forEach((el) => {
    el.addEventListener("click", () => {
      const line = Number.parseInt(el.getAttribute("data-line"), 10);
      jumpToLine(line);
    });
  });
  updateLineNumbers();
}

function clearErrors() {
  showErrors([]);
  updateLineNumbers();
  updateDiagnosticSummary([], []);
}

// ============================================================================
// Console Logging
// ============================================================================

function logToConsole(message, type = "info") {
  const line = document.createElement("div");
  line.className = `log-${type}`;
  line.textContent = message;
  consoleEl.appendChild(line);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

function clearConsole() {
  consoleEl.innerHTML = "";
}

// ============================================================================
// Compilation
// ============================================================================

function doCompile() {
  const source = editorEl.value.trim();
  if (!source) {
    logToConsole("No source code to compile.", "warn");
    return false;
  }

  clearErrors();
  logToConsole("--- Compiling ---", "event");

  try {
    const result = compile(source);

    if (result.success) {
      compiledPlayer = { program: result.program, constants: result.constants };
      btnRun.disabled = false;

      logToConsole(`Compiled OK  |  ${result.program.robotClass}  |  ${result.program.bytecode.length} bytes  |  events: ${[...result.program.eventHandlers.keys()].join(", ")}`, "success");

      const warnings = result.diagnostics.filter(d => d.severity === "warning");
      updateDiagnosticSummary([], warnings);

      if (result.diagnostics.length > 0) {
        for (const d of result.diagnostics) {
          const t = d.severity === "error" ? "error" : "warn";
          logToConsole(`  ${d.severity.toUpperCase()}: ${d.message}`, t);
        }
        if (warnings.length > 0) {
          showErrors(warnings.map(d => ({ line: d.line, message: `Warning: ${d.message}` })));
        }
      }
      return true;
    } else {
      compiledPlayer = null;
      btnRun.disabled = true;

      logToConsole("[FAIL] Compilation failed", "error");

      const allDiag = result.diagnostics || [];
      const errorDiag = allDiag.filter(d => d.severity === "error");
      const warningDiag = allDiag.filter(d => d.severity === "warning");
      updateDiagnosticSummary(errorDiag, warningDiag);

      for (const err of result.errors) {
        logToConsole(`  ${err}`, "error");
      }
      for (const d of allDiag) {
        if (d.severity === "warning") {
          logToConsole(`  WARNING: ${d.message}`, "warn");
        }
      }

      // Show errors in error bar with line info
      if (errorDiag.length > 0) {
        showErrors(errorDiag);
      } else {
        showErrors(result.errors.map(e => ({ line: 0, message: e })));
      }
      return false;
    }
  } catch (e) {
    compiledPlayer = null;
    btnRun.disabled = true;
    logToConsole(`[EXCEPTION] ${e.message}`, "error");
    showErrors([{ line: 0, message: e.message }]);
    updateDiagnosticSummary([{ line: 0, message: e.message }], []);
    return false;
  }
}

// ============================================================================
// Match Execution
// ============================================================================

function doRunMatch() {
  if (!compiledPlayer) {
    logToConsole("Compile your bot first.", "warn");
    return;
  }

  const oppKey = opponentSelect.value;
  const oppPreset = BOT_PRESETS[oppKey];
  if (!oppPreset) {
    logToConsole("Invalid opponent selection.", "error");
    return;
  }

  logToConsole(`\n--- Match: You vs ${oppPreset.name} ---`, "event");
  arenaStatus.textContent = "Running...";

  let oppResult;
  try {
    oppResult = compile(oppPreset.source);
  } catch (e) {
    logToConsole(`Failed to compile opponent: ${e.message}`, "error");
    arenaStatus.textContent = "Error";
    return;
  }

  if (!oppResult.success) {
    logToConsole(`Opponent "${oppPreset.name}" failed: ${oppResult.errors.join(", ")}`, "error");
    arenaStatus.textContent = "Error";
    return;
  }

  const mode = matchModeSelect?.value === "squad_2v2" ? "squad_2v2" : "duel_1v1";
  const participants = [
    {
      program: compiledPlayer.program,
      constants: compiledPlayer.constants,
      playerId: "player",
      teamId: 0,
    },
  ];

  if (mode === "squad_2v2") {
    const allyPreset = BOT_PRESETS.healer;
    const allyCompiled = compile(allyPreset.source);
    if (!allyCompiled.success) {
      logToConsole("Default ally failed to compile.", "error");
      arenaStatus.textContent = "Error";
      return;
    }
    participants.push({
      program: allyCompiled.program,
      constants: allyCompiled.constants,
      playerId: allyPreset.name.toLowerCase(),
      teamId: 0,
    });
  }

  participants.push({
    program: oppResult.program,
    constants: oppResult.constants,
    playerId: oppPreset.name.toLowerCase(),
    teamId: 1,
  });

  if (mode === "squad_2v2") {
    const enemyPartnerPreset = BOT_PRESETS.fortress;
    const enemyPartnerCompiled = compile(enemyPartnerPreset.source);
    if (!enemyPartnerCompiled.success) {
      logToConsole("Enemy partner failed to compile.", "error");
      arenaStatus.textContent = "Error";
      return;
    }
    participants.push({
      program: enemyPartnerCompiled.program,
      constants: enemyPartnerCompiled.constants,
      playerId: enemyPartnerPreset.name.toLowerCase(),
      teamId: 1,
    });
  }

  const setup = {
    config: {
      mode,
      arenaWidth: ARENA_WIDTH,
      arenaHeight: ARENA_HEIGHT,
      maxTicks: 3000,
      tickRate: 30,
      seed: Math.floor(Math.random() * 100000),
    },
    participants,
  };

  let result;
  try {
    result = runMatch(setup);
  } catch (e) {
    logToConsole(`Match error: ${e.message}`, "error");
    arenaStatus.textContent = "Error";
    return;
  }

  lastMatchResult = result;

  const winnerLabel =
    result.winner === null ? "DRAW" :
    result.winner === 0 ? "Your Bot" : oppPreset.name;

  logToConsole(`Winner: ${winnerLabel}  |  ${result.reason}  |  ${result.tickCount} ticks`, "success");

  for (const [id, stats] of result.robotStats) {
    logToConsole(`  ${id}: dmg=${stats.damageDealt}  taken=${stats.damageTaken}  kills=${stats.kills}`, "stat");
  }

  showMatchResults(result, oppPreset.name);
  startReplay(result, oppPreset.name);
}

function doRunTeamSimulation() {
  const teamPreset = TEAM_PRESETS[teamPresetSelect?.value ?? ""];
  if (!teamPreset) {
    logToConsole("Invalid team preset selection.", "error");
    return;
  }

  const compileBot = (key) => {
    const preset = BOT_PRESETS[key];
    const compiled = compile(preset.source);
    if (!compiled.success) throw new Error(`Preset ${preset.name} failed to compile.`);
    return { preset, compiled };
  };

  let allies;
  let opponents;
  try {
    allies = teamPreset.allies.map(compileBot);
    opponents = teamPreset.opponents.map(compileBot);
  } catch (e) {
    logToConsole(e.message, "error");
    arenaStatus.textContent = "Error";
    return;
  }

  const participants = [
    ...allies.map(({ preset, compiled }) => ({
      program: compiled.program,
      constants: compiled.constants,
      playerId: `ally_${preset.name.toLowerCase()}`,
      teamId: 0,
    })),
    ...opponents.map(({ preset, compiled }) => ({
      program: compiled.program,
      constants: compiled.constants,
      playerId: `opp_${preset.name.toLowerCase()}`,
      teamId: 1,
    })),
  ];

  const setup = {
    config: {
      mode: "squad_2v2",
      arenaWidth: ARENA_WIDTH,
      arenaHeight: ARENA_HEIGHT,
      maxTicks: 3000,
      tickRate: 30,
      seed: Math.floor(Math.random() * 100000),
    },
    participants,
  };

  const result = runMatch(setup);
  lastMatchResult = result;
  const opponentName = teamPreset.name;
  logToConsole(`\n--- Team Simulation: ${teamPreset.name} ---`, "event");
  logToConsole(`Winner: ${result.winner === null ? "DRAW" : `Team ${result.winner}`} | ${result.reason}`, "success");
  showMatchResults(result, opponentName);
  startReplay(result, opponentName);
}

function doCompileAndRun() {
  if (doCompile()) {
    doRunMatch();
  }
}

// ============================================================================
// Match Results Display
// ============================================================================

function showMatchResults(result, opponentName) {
  matchResultsEl.classList.add("visible");

  const isDraw = result.winner === null;
  const winnerLabel = isDraw ? "DRAW" : result.winner === 0 ? "Your Bot WINS" : `${opponentName} WINS`;

  const participants = result.replay.metadata?.participants ?? [];
  const robotToTeam = new Map(participants.map((p) => [p.robotId, p.teamId]));
  const teamTotals = new Map([[0, { hp: 0, dmg: 0, kills: 0 }], [1, { hp: 0, dmg: 0, kills: 0 }]]);

  const lastFrame = result.replay.frames[result.replay.frames.length - 1];
  if (lastFrame) {
    for (const robot of lastFrame.robots) {
      const teamId = robotToTeam.get(robot.id);
      if (teamId === undefined) continue;
      teamTotals.get(teamId).hp += Math.max(0, robot.health);
    }
  }
  for (const [robotId, stats] of result.robotStats.entries()) {
    const teamId = robotToTeam.get(robotId);
    if (teamId === undefined) continue;
    const bucket = teamTotals.get(teamId);
    bucket.dmg += stats.damageDealt;
    bucket.kills += stats.kills;
  }

  resultsContentEl.innerHTML = `
    <div class="result-winner ${isDraw ? 'draw' : ''}">${winnerLabel}</div>
    <div class="result-item"><span class="rl">Reason</span>${result.reason.replace(/_/g, ' ')}</div>
    <div class="result-item"><span class="rl">Ticks</span>${result.tickCount}</div>
    <div class="result-item"><span class="rl">Team 0 HP</span>${teamTotals.get(0).hp}</div>
    <div class="result-item"><span class="rl">Team 1 HP</span>${teamTotals.get(1).hp}</div>
    <div class="result-item"><span class="rl">Team 0 Dmg</span>${teamTotals.get(0).dmg}</div>
    <div class="result-item"><span class="rl">Team 1 Dmg</span>${teamTotals.get(1).dmg}</div>
    <div class="result-item"><span class="rl">Team 0 Kills</span>${teamTotals.get(0).kills}</div>
    <div class="result-item"><span class="rl">Team 1 Kills</span>${teamTotals.get(1).kills}</div>
  `;

  // Per-robot detail breakdown
  if (resultsRobotDetailEl) {
    let robotHtml = '<div class="result-robot-header">Robot Detail</div>';
    for (const p of participants) {
      const stats = result.robotStats.get(p.robotId);
      if (!stats) continue;
      const finalRobot = lastFrame?.robots.find(r => r.id === p.robotId);
      const hp = finalRobot ? Math.max(0, finalRobot.health) : 0;
      const teamColor = p.teamId === 0 ? 'var(--accent-cyan)' : 'var(--accent-red)';
      const label = p.playerId === "player" ? "You" : p.playerId;
      robotHtml += `<div class="result-robot-row">
        <span class="result-robot-name" style="color:${teamColor}">${label}</span>
        <span class="result-robot-stat">HP:${hp}</span>
        <span class="result-robot-stat">Dmg:${stats.damageDealt}</span>
        <span class="result-robot-stat">K:${stats.kills}</span>
      </div>`;
    }
    resultsRobotDetailEl.innerHTML = robotHtml;
  }
}

// ============================================================================
// Canvas Rendering
// ============================================================================

const TEAM_COLORS = ["#00d4ff", "#ff3355"];
const TEAM_GLOW = ["rgba(0,212,255,0.25)", "rgba(255,51,85,0.25)"];
const GRID_COLOR = "rgba(42,42,74,0.3)";
const ARENA_CONTROL_POINTS = [
  { x: ARENA_WIDTH * 0.20, y: ARENA_HEIGHT * 0.50 },
  { x: ARENA_WIDTH * 0.50, y: ARENA_HEIGHT * 0.50 },
  { x: ARENA_WIDTH * 0.80, y: ARENA_HEIGHT * 0.50 },
];
const ARENA_COVERS = [
  { x: ARENA_WIDTH * 0.50, y: ARENA_HEIGHT * 0.18, w: 8, h: 18 },
  { x: ARENA_WIDTH * 0.50, y: ARENA_HEIGHT * 0.82, w: 8, h: 18 },
  { x: ARENA_WIDTH * 0.33, y: ARENA_HEIGHT * 0.50, w: 6, h: 10 },
  { x: ARENA_WIDTH * 0.67, y: ARENA_HEIGHT * 0.50, w: 6, h: 10 },
];

function canvasScale() {
  return canvasEl.width / ARENA_WIDTH;
}

function drawArenaBackground() {
  const w = canvasEl.width;
  const h = canvasEl.height;
  const s = canvasScale();

  ctx.fillStyle = "#0a0a14";
  ctx.fillRect(0, 0, w, h);

  // Grid
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 0.5;
  const step = 10 * s;
  for (let x = 0; x <= w; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Border
  ctx.strokeStyle = "#2a2a4a";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);

  // Cover walls / chokepoints
  ctx.fillStyle = "rgba(120, 140, 190, 0.2)";
  ctx.strokeStyle = "rgba(140, 160, 220, 0.45)";
  ctx.lineWidth = 1;
  for (const cover of ARENA_COVERS) {
    const cw = cover.w * s;
    const ch = cover.h * s;
    const cx = (cover.x * s) - (cw / 2);
    const cy = (cover.y * s) - (ch / 2);
    ctx.fillRect(cx, cy, cw, ch);
    ctx.strokeRect(cx, cy, cw, ch);
  }

  // Control points
  ctx.fillStyle = "rgba(255,221,0,0.3)";
  ctx.font = `${Math.max(8, 2 * s)}px ${getComputedStyle(document.body).getPropertyValue('--font-sans')}`;
  ctx.textAlign = "center";
  for (const cp of ARENA_CONTROL_POINTS) {
    const cx = cp.x * s;
    const cy = cp.y * s;
    ctx.beginPath();
    ctx.arc(cx, cy, 4 * s, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,221,0,0.08)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,221,0,0.25)";
    ctx.stroke();
    ctx.fillStyle = "rgba(255,221,0,0.3)";
    ctx.fillText("CP", cx, cy + 6 * s);
  }
}

function drawRobot(x, y, health, maxHealth, teamId, label, isAlive) {
  const s = canvasScale();
  const cx = x * s;
  const cy = y * s;
  const radius = 3 * s;
  const color = TEAM_COLORS[teamId] || "#ffffff";
  const glow = TEAM_GLOW[teamId] || "rgba(255,255,255,0.2)";

  if (!isAlive) {
    // Draw destroyed marker
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(100,100,100,0.3)";
    ctx.fill();
    ctx.fillStyle = "#555";
    ctx.font = `${Math.max(8, 2 * s)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("X", cx, cy + 3);
    return;
  }

  // Glow
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 4, 0, Math.PI * 2);
  ctx.fillStyle = glow;
  ctx.fill();

  // Body
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.85;
  ctx.fill();
  ctx.globalAlpha = 1.0;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Health bar
  const barW = radius * 2.8;
  const barH = 3;
  const barX = cx - barW / 2;
  const barY = cy - radius - 9;
  const hpRatio = Math.max(0, health / maxHealth);

  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(barX - 0.5, barY - 0.5, barW + 1, barH + 1);

  const hpColor = hpRatio > 0.5 ? "#00ff88" : hpRatio > 0.25 ? "#ff8800" : "#ff3355";
  ctx.fillStyle = hpColor;
  ctx.fillRect(barX, barY, barW * hpRatio, barH);

  // HP text
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${Math.max(8, 2 * s)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(Math.round(health), cx, barY - 3);

  // Label
  ctx.fillStyle = color;
  ctx.font = `bold ${Math.max(9, 2.5 * s)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(label, cx, cy + radius + 14);
}

function drawProjectile(x, y) {
  const s = canvasScale();
  const cx = x * s;
  const cy = y * s;
  const radius = 1.5 * s;

  // Glow
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 3, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,221,0,0.25)";
  ctx.fill();

  // Core
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = "#ffdd00";
  ctx.fill();
}

function drawFrame(frame, labels) {
  drawArenaBackground();
  if (!frame || !frame.robots) return;

  // Draw projectiles first (behind robots)
  if (frame.projectiles) {
    for (const p of frame.projectiles) {
      drawProjectile(p.position.x, p.position.y);
    }
  }

  for (let i = 0; i < frame.robots.length; i++) {
    const r = frame.robots[i];
    const maxHP = CLASS_STATS[r.robotClass]?.health || 100;
    const isAlive = r.health > 0;
    drawRobot(r.position.x, r.position.y, r.health, maxHP, r.teamId, labels[r.id] || r.id, isAlive);
  }

  // Draw event indicators (damage flashes, etc.)
  if (frame.events) {
    for (const evt of frame.events) {
      if (evt.type === "damaged" && evt.data) {
        const targetRobot = frame.robots.find(r => r.id === evt.robotId);
        if (targetRobot && targetRobot.health > 0) {
          const s = canvasScale();
          const cx = targetRobot.position.x * s;
          const cy = targetRobot.position.y * s;
          ctx.beginPath();
          ctx.arc(cx, cy, 6 * s, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255,51,85,0.2)";
          ctx.fill();
        }
      }
    }
  }
}

function drawIdle() {
  drawArenaBackground();
  const w = canvasEl.width;
  const h = canvasEl.height;
  ctx.fillStyle = "#444466";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Compile a bot and run a match", w / 2, h / 2);
}

// ============================================================================
// Replay System
// ============================================================================

function startReplay(result, opponentName) {
  stopReplay();

  const frames = result.replay.frames;
  if (frames.length === 0) {
    drawIdle();
    arenaStatus.textContent = "No frames";
    return;
  }

  replayData = frames;
  const labelsById = {};
  for (const p of result.replay.metadata?.participants ?? []) {
    if (p.teamId === 0 && p.playerId === "player") labelsById[p.robotId] = "You";
    else labelsById[p.robotId] = p.playerId;
  }
  replayLabels = labelsById;
  replayFrameIndex = 0;
  replayPlaying = true;
  replaySpeed = parseFloat(replaySpeedSelect.value) || 1;

  // Setup controls
  replayControlsEl.classList.add("visible");
  replayScrubber.max = frames.length - 1;
  replayScrubber.value = 0;
  btnReplayToggle.textContent = "\u275A\u275A"; // pause icon
  arenaStatus.textContent = "Replaying...";

  lastReplayTimestamp = 0;
  replayAnimId = requestAnimationFrame(replayTick);
}

function stopReplay() {
  replayPlaying = false;
  if (replayAnimId) {
    cancelAnimationFrame(replayAnimId);
    replayAnimId = null;
  }
}

function replayTick(timestamp) {
  if (!replayData || !replayPlaying) return;

  if (!lastReplayTimestamp) lastReplayTimestamp = timestamp;
  const elapsed = timestamp - lastReplayTimestamp;

  // Advance based on speed — base rate: 1 frame per 16ms at 1x
  const msPerFrame = 16 / replaySpeed;
  if (elapsed >= msPerFrame) {
    lastReplayTimestamp = timestamp;

    const frame = replayData[replayFrameIndex];
    drawFrame(frame, replayLabels);
    replayScrubber.value = replayFrameIndex;
    replayTickLabel.textContent = `${frame.tick} / ${replayData[replayData.length - 1].tick}`;

    replayFrameIndex++;
    if (replayFrameIndex >= replayData.length) {
      replayPlaying = false;
      btnReplayToggle.textContent = "\u25B6";
      arenaStatus.textContent = `Done (${replayData[replayData.length - 1].tick} ticks)`;
      return;
    }
  }

  replayAnimId = requestAnimationFrame(replayTick);
}

function toggleReplayPlayPause() {
  if (!replayData) return;

  if (replayPlaying) {
    replayPlaying = false;
    btnReplayToggle.textContent = "\u25B6";
    arenaStatus.textContent = "Paused";
  } else {
    // If at end, restart
    if (replayFrameIndex >= replayData.length) {
      replayFrameIndex = 0;
    }
    replayPlaying = true;
    btnReplayToggle.textContent = "\u275A\u275A";
    arenaStatus.textContent = "Replaying...";
    lastReplayTimestamp = 0;
    replayAnimId = requestAnimationFrame(replayTick);
  }
}

function scrubReplay() {
  if (!replayData) return;
  const idx = parseInt(replayScrubber.value, 10);
  replayFrameIndex = idx;
  const frame = replayData[idx];
  if (frame) {
    drawFrame(frame, replayLabels);
    replayTickLabel.textContent = `${frame.tick} / ${replayData[replayData.length - 1].tick}`;
    arenaStatus.textContent = `Tick ${frame.tick}`;
  }
}

function stepReplayForward() {
  if (!replayData) return;
  stopReplay();
  btnReplayToggle.textContent = "\u25B6";
  if (replayFrameIndex < replayData.length - 1) {
    replayFrameIndex++;
  }
  const frame = replayData[replayFrameIndex];
  if (frame) {
    drawFrame(frame, replayLabels);
    replayScrubber.value = replayFrameIndex;
    replayTickLabel.textContent = `${frame.tick} / ${replayData[replayData.length - 1].tick}`;
    arenaStatus.textContent = `Tick ${frame.tick}`;
  }
}

function stepReplayBack() {
  if (!replayData) return;
  stopReplay();
  btnReplayToggle.textContent = "\u25B6";
  if (replayFrameIndex > 0) {
    replayFrameIndex--;
  }
  const frame = replayData[replayFrameIndex];
  if (frame) {
    drawFrame(frame, replayLabels);
    replayScrubber.value = replayFrameIndex;
    replayTickLabel.textContent = `${frame.tick} / ${replayData[replayData.length - 1].tick}`;
    arenaStatus.textContent = `Tick ${frame.tick}`;
  }
}

// ============================================================================
// Preset Loading
// ============================================================================

function loadPreset(key) {
  const preset = BOT_PRESETS[key];
  if (!preset) return;
  editorEl.value = preset.source;
  currentPreset = key;

  presetButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.bot === key);
  });

  compiledPlayer = null;
  btnRun.disabled = true;
  clearErrors();
  updateHighlighting();
  updateLineNumbers();
}

// ============================================================================
// Editor Events
// ============================================================================

let highlightDebounce = null;

function onEditorInput() {
  updateHighlighting();
  updateLineNumbers();
  syncScroll();
}

editorEl.addEventListener("input", () => {
  // Debounce highlighting for performance
  clearTimeout(highlightDebounce);
  highlightDebounce = setTimeout(onEditorInput, 30);
});

editorEl.addEventListener("scroll", syncScroll);

editorEl.addEventListener("keydown", (e) => {
  if (e.key === "Tab") {
    e.preventDefault();
    const start = editorEl.selectionStart;
    const end = editorEl.selectionEnd;
    editorEl.value =
      editorEl.value.substring(0, start) + "  " + editorEl.value.substring(end);
    editorEl.selectionStart = editorEl.selectionEnd = start + 2;
    onEditorInput();
  }
});

// ============================================================================
// Event Wiring
// ============================================================================

btnCompile.addEventListener("click", doCompile);
btnRun.addEventListener("click", doRunMatch);
btnCompileRun.addEventListener("click", doCompileAndRun);
btnClear.addEventListener("click", clearConsole);
btnRunTeamSim?.addEventListener("click", doRunTeamSimulation);

presetButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    loadPreset(btn.dataset.bot);
  });
});

// Replay controls
btnReplayToggle.addEventListener("click", toggleReplayPlayPause);
btnReplayStep?.addEventListener("click", stepReplayForward);
btnReplayStepBack?.addEventListener("click", stepReplayBack);
replayScrubber.addEventListener("input", () => {
  stopReplay();
  btnReplayToggle.textContent = "\u25B6";
  scrubReplay();
});
replaySpeedSelect.addEventListener("change", () => {
  replaySpeed = parseFloat(replaySpeedSelect.value) || 1;
});

// Resize handle for editor/arena split
const resizeHandle = document.getElementById("resize-handle");
const editorPane = document.querySelector(".editor-pane");
const arenaPane = document.querySelector(".arena-pane");
if (resizeHandle && editorPane && arenaPane) {
  let isResizing = false;
  resizeHandle.addEventListener("mousedown", (e) => {
    isResizing = true;
    resizeHandle.classList.add("active");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  });
  document.addEventListener("mousemove", (e) => {
    if (!isResizing) return;
    const workspace = document.querySelector(".workspace");
    if (!workspace) return;
    const rect = workspace.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const totalW = rect.width;
    const minEditor = 250;
    const minArena = 250;
    const editorW = Math.max(minEditor, Math.min(totalW - minArena - 5, offsetX));
    editorPane.style.flex = "none";
    editorPane.style.width = `${editorW}px`;
    arenaPane.style.flex = "none";
    arenaPane.style.width = `${totalW - editorW - 5}px`;
  });
  document.addEventListener("mouseup", () => {
    if (isResizing) {
      isResizing = false;
      resizeHandle.classList.remove("active");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
  });
}

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === "Enter") {
    e.preventDefault();
    doCompileAndRun();
  } else if (e.ctrlKey && e.key === "Enter") {
    e.preventDefault();
    doCompile();
  }
});

// ============================================================================
// Init
// ============================================================================

loadPreset("bruiser");
drawIdle();
logToConsole(`ArenaScript v${ENGINE_VERSION} — Ready`, "event");
logToConsole("Select a bot preset or write your own, then Compile & Run.", "info");

// ============================================================================
// ArenaScript Frontend — Main Application
// ============================================================================

import { compile } from "./lang/pipeline.js";
import { runMatch } from "./engine/tick.js";
import {
  ARENA_WIDTH, ARENA_HEIGHT,
  CLASS_STATS, ENGINE_VERSION,
} from "./shared/config.js";
import { Telemetry } from "./shared/telemetry.js";
import { computeBookmarks } from "./engine/replay.js";
import * as BotLibrary from "./bot-library.js";

const telemetry = Telemetry.instance();

// ============================================================================
// Example Bot Source Code
// ============================================================================

const BOT_PRESETS = {
  bruiser: {
    name: "Bruiser",
    class: "brawler",
    source: `robot "Bruiser" version "3.0"

meta {
  author: "ArenaLab"
  class: "brawler"
}

const {
  HEAL_THRESHOLD = 50
  TURN_INTERVAL = 20
}

state {
  ticks_moving: number = 0
}

on spawn {
  mark_position "home"
  set ticks_moving = 0
}

on tick {
  if is_in_hazard() {
    turn_right
    move_forward
    return
  }

  let enemy = nearest_enemy()

  if enemy != null {
    if can_attack(enemy) {
      attack enemy
    } else {
      move_toward enemy.position
    }
    return
  }

  let mine = nearest_mine()
  if mine != null and mine.distance < 3 {
    turn_right
    move_forward
    return
  }

  if health() < HEAL_THRESHOLD {
    let heal = nearest_heal_zone()
    if heal != null {
      move_to heal.position
      return
    }
  }

  let pickup = nearest_pickup()
  if pickup != null {
    move_to pickup.position
    return
  }

  set ticks_moving = ticks_moving + 1
  if wall_ahead(3) {
    turn_right
    set ticks_moving = 0
    return
  }
  if ticks_moving > TURN_INTERVAL {
    let dir = random(1, 3)
    if dir == 1 { turn_left } else { turn_right }
    set ticks_moving = 0
    return
  }
  move_forward
}

on damaged(event) {
  if health() < 30 {
    let heal = nearest_heal_zone()
    if heal != null {
      move_to heal.position
    }
  }
}

on signal_received(event) {
  move_toward event.senderPosition
}`,
  },

  kiter: {
    name: "Kiter",
    class: "ranger",
    source: `robot "Kiter" version "3.0"

meta {
  author: "ArenaLab"
  class: "ranger"
}

const {
  SAFE_HEALTH = 40
  KITE_RANGE = 6
}

state {
  retreating: boolean = false
  strafing_dir: number = 1
}

on spawn {
  set retreating = false
  set strafing_dir = 1
  place_mine
  every 60 {
    let sound = nearest_sound()
    if sound != null {
      send_signal sound.position
    }
  }
}

on tick {
  if is_in_hazard() {
    move_forward
    return
  }

  let enemy = nearest_enemy()

  if enemy == null {
    set retreating = false
    let sound = nearest_sound()
    if sound != null {
      move_toward sound.position
      return
    }
    let cp = nearest_control_point()
    if cp != null {
      move_to cp.position
    } else {
      if wall_ahead(4) {
        turn_right
      } else {
        move_forward
      }
    }
    return
  }

  if health() < SAFE_HEALTH {
    set retreating = true
    let heal = nearest_heal_zone()
    if heal != null {
      move_to heal.position
      return
    }
    retreat
    return
  }

  set retreating = false
  let dist = distance_to(enemy.position)

  if dist < KITE_RANGE {
    if can_attack(enemy) {
      fire_at enemy.position
    }
    retreat
    return
  }

  if can_attack(enemy) {
    fire_at enemy.position
    if strafing_dir > 0 { strafe_right } else { strafe_left }
  } else {
    move_toward enemy.position
  }
}

on damaged {
  set strafing_dir = strafing_dir * -1
}

on low_health {
  set retreating = true
}`,
  },

  fortress: {
    name: "Fortress",
    class: "tank",
    source: `robot "Fortress" version "3.0"

meta {
  author: "ArenaLab"
  class: "tank"
}

const {
  HOLD_THRESHOLD = 80
  SHIELD_THRESHOLD = 60
}

state {
  has_position: boolean = false
}

on spawn {
  set has_position = false
  mark_position "spawn"
}

on tick {
  if is_in_hazard() {
    move_forward
    return
  }

  if is_taunted() {
    shield
  }

  if not has_position {
    let cp = nearest_control_point()
    if cp != null {
      move_to cp.position
      if distance_to(cp.position) < 4 {
        set has_position = true
        mark_position "hold"
        place_mine
      }
      return
    }
    if wall_ahead(3) { turn_left } else { move_forward }
    return
  }

  if health() < SHIELD_THRESHOLD {
    shield
  }

  let enemy = nearest_enemy()
  if enemy != null {
    taunt
    if can_attack(enemy) {
      attack enemy
    } else {
      let dist = distance_to(enemy.position)
      if dist < 12 {
        move_toward enemy.position
      }
    }
    return
  }

  if health() < HOLD_THRESHOLD {
    let heal = nearest_heal_zone()
    if heal != null {
      set has_position = false
      move_to heal.position
      return
    }
  }

  let cp = nearest_enemy_control_point()
  if cp != null {
    set has_position = false
    move_to cp.position
  }
}

on damaged {
  if health() < 45 {
    shield
  }
  send_signal "under_attack"
}`,
  },

  healer: {
    name: "Survivor",
    class: "support",
    source: `robot "Survivor" version "3.0"

meta {
  author: "ArenaLab"
  class: "support"
}

const {
  FLEE_HEALTH = 45
  SAFE_HEALTH = 70
}

state {
  healing: boolean = false
}

fn find_safety() {
  let heal = nearest_heal_zone()
  if heal != null {
    move_to heal.position
    return
  }
  let cover = nearest_cover()
  if cover != null {
    move_to cover
  } else {
    retreat
  }
}

on spawn {
  mark_position "spawn"
  every 45 {
    let pickup = nearest_pickup()
    if pickup != null {
      if pickup.type == "energy" {
        mark_position "energy_spot"
      }
    }
  }
}

on tick {
  if is_in_hazard() {
    move_forward
    return
  }

  if is_in_heal_zone() and health() < max_health() {
    set healing = true
    mark_position "heal_spot"
    let enemy = nearest_enemy()
    if enemy != null and can_attack(enemy) {
      attack enemy
    }
    stop
    return
  }
  set healing = false

  if health() < FLEE_HEALTH {
    find_safety()
    return
  }

  let pickup = nearest_pickup()
  if pickup != null and pickup.type == "energy" {
    move_to pickup.position
    return
  }

  let enemy = nearest_enemy()
  if enemy != null {
    if is_enemy_facing_me(enemy) and health() < SAFE_HEALTH {
      find_safety()
      return
    }
    if can_attack(enemy) {
      attack enemy
    } else {
      let dist = distance_to(enemy.position)
      if dist < 10 and health() < SAFE_HEALTH {
        find_safety()
      } else {
        move_toward enemy.position
      }
    }
    return
  }

  let cp = nearest_control_point()
  if cp != null {
    move_to cp.position
  } else {
    if wall_ahead(3) { turn_right } else { move_forward }
  }
}

on low_health {
  find_safety()
}

on damaged {
  if health() < FLEE_HEALTH {
    send_signal "need_help"
    find_safety()
  }
}`,
  },

  flanker: {
    name: "Flanker",
    class: "ranger",
    source: `robot "Flanker" version "3.0"

meta {
  author: "ArenaLab"
  class: "ranger"
}

const {
  ENGAGE_HEALTH = 35
}

state {
  flanking: boolean = true
  sweep_angle: number = 0
}

on spawn {
  set flanking = true
  set sweep_angle = 0
  place_mine
  after 30 {
    place_mine
  }
}

on tick {
  if is_in_hazard() {
    strafe_left
    return
  }

  let enemy = nearest_enemy()

  if enemy == null {
    let sound = nearest_sound()
    if sound != null {
      move_toward sound.position
      return
    }
    set sweep_angle = sweep_angle + 1
    if wall_ahead(4) {
      turn_right
      turn_right
    } else {
      move_forward
    }
    if sweep_angle > 15 {
      turn_right
      set sweep_angle = 0
    }
    return
  }

  if health() < ENGAGE_HEALTH {
    let heal = nearest_heal_zone()
    if heal != null {
      move_to heal.position
      return
    }
    retreat
    return
  }

  let dist = distance_to(enemy.position)

  if dist > 10 and flanking {
    if not is_enemy_facing_me(enemy) {
      move_toward enemy.position
      return
    }
    if wall_ahead(3) { turn_left }
    strafe_right
    return
  }

  set flanking = false

  if can_attack(enemy) {
    let angle = angle_to(enemy.position)
    fire_at enemy.position
    if angle > 0 { strafe_right } else { strafe_left }
  } else {
    move_toward enemy.position
  }
}

on enemy_seen {
  set flanking = true
  set sweep_angle = 0
  send_signal "contact"
}

on damaged {
  set flanking = false
}`,
  },

  sentinel: {
    name: "Sentinel",
    class: "tank",
    source: `robot "Sentinel" version "3.0"

meta {
  author: "ArenaLab"
  class: "tank"
}

const {
  PATROL_WAIT = 30
  ENGAGE_RANGE = 8
}

state {
  wait_timer: number = 0
  patrolling: boolean = true
}

fn patrol() {
  if wall_ahead(3) {
    turn_right
    return
  }
  let cp = nearest_control_point()
  if cp != null {
    if distance_to(cp.position) < 4 {
      set wait_timer = wait_timer + 1
      if wait_timer > PATROL_WAIT {
        set wait_timer = 0
        turn_right
        turn_right
        turn_right
      }
      overwatch
      stop
      return
    }
    move_to cp.position
    return
  }
  move_forward
}

on spawn {
  mark_position "base"
  place_mine
  after 20 {
    place_mine
  }
}

on tick {
  if is_in_hazard() {
    move_backward
    return
  }

  if health() < 40 {
    shield
    let heal = nearest_heal_zone()
    if heal != null {
      move_to heal.position
      return
    }
  }

  let enemy = nearest_enemy()

  if enemy == null {
    set patrolling = true
    patrol()
    return
  }

  set patrolling = false
  set wait_timer = 0

  if is_in_overwatch() {
    if can_attack(enemy) {
      attack enemy
    }
    return
  }

  if can_attack(enemy) {
    attack enemy
    taunt
  } else {
    let dist = distance_to(enemy.position)
    if dist < ENGAGE_RANGE {
      move_toward enemy.position
    } else {
      if health() < 65 {
        shield
        stop
      } else {
        move_toward enemy.position
      }
    }
  }
}

on damaged {
  if health() < 50 {
    shield
  }
  set patrolling = false
  send_signal "engaged"
}

on signal_received(event) {
  if patrolling {
    move_toward event.senderPosition
  }
}`,
  },
};

const TEAM_PRESETS = {
  skirmish_pair: {
    name: "Scout & Survive",
    allies: ["bruiser", "healer"],
    opponents: ["kiter", "fortress"],
  },
  pressure_line: {
    name: "Patrol & Flank",
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
const seedInput = document.getElementById("seed-input");
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

const btnBookmarkDamage = document.getElementById("btn-bookmark-damage");
const btnBookmarkKill = document.getElementById("btn-bookmark-kill");
const btnToggleTraces = document.getElementById("btn-toggle-traces");
const btnToggleFullpage = document.getElementById("btn-toggle-fullpage");
const btnOpenTeamBuilder = document.getElementById("btn-open-team-builder");
const teamBuilderModal = document.getElementById("team-builder-modal");
const btnCloseTeamBuilder = document.getElementById("btn-close-team-builder");
const btnTbCancel = document.getElementById("btn-tb-cancel");
const btnTbRun = document.getElementById("btn-tb-run");
const tbAllySlots = document.getElementById("tb-ally-slots");
const tbEnemySlots = document.getElementById("tb-enemy-slots");
const tbMatchInfo = document.getElementById("tb-match-info");

// Match-live mode elements
const btnExitMatchLive = document.getElementById("btn-exit-match-live");
const matchScoreboard = document.getElementById("match-scoreboard");
const scoreboardTeam0 = document.getElementById("scoreboard-team0");
const scoreboardTeam1 = document.getElementById("scoreboard-team1");
const scoreboardTick = document.getElementById("scoreboard-tick");

if (!canvasEl) {
  throw new Error("Missing required #arena-canvas element in HTML");
}
const ctx = canvasEl.getContext("2d");
if (!ctx) {
  throw new Error("Failed to acquire 2D canvas context — arena rendering unavailable");
}

// ============================================================================
// State
// ============================================================================

let compiledPlayer = null;
let currentPreset = "bruiser";
let currentEditorBotName = "Bruiser";
let currentEditorUserBotId = null;   // if the editor currently holds a user library bot, its id
let currentView = "builder";         // "builder" | "arena" | "library"
let lastMatchResult = null;
let lastCompileErrors = [];
let showDecisionTraces = false;
let fullPageBattle = false;

// Replay state
let replayData = null;
let replayPlaying = false;
let replayFrameIndex = 0;
let replayAnimId = null;
let replayLabels = {};
let replaySpeed = 0.24;
let lastReplayTimestamp = 0;
let lastReplayBookmarks = null;
let matchLiveMode = false;
let matchLiveParticipants = null;

/** Get seed from UI input, or generate a random one */
function getMatchSeed() {
  const val = seedInput?.value?.trim();
  if (val !== "" && val !== undefined) {
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed) && parsed >= 0) return parsed;
  }
  return Math.floor(Math.random() * 2147483647);
}

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
  "burst_fire", "grenade",
  "move_forward", "move_backward", "turn_left", "turn_right",
  "place_mine", "send_signal", "mark_position", "taunt", "overwatch",
  // Resource economy + advanced combat
  "fire_light", "fire_heavy", "zap", "vent_heat",
  "cloak", "self_destruct",
]);

const BUILTINS = new Set([
  "health", "max_health", "energy", "position", "velocity", "heading", "cooldown",
  "nearest_enemy", "visible_enemies", "enemy_count_in_range",
  "nearest_ally", "visible_allies",
  "nearest_cover", "nearest_resource", "nearest_control_point",
  "nearest_enemy_control_point", "nearest_heal_zone", "nearest_hazard",
  "distance_to", "line_of_sight", "current_tick",
  "can_attack", "scan", "scan_enemies", "last_seen_enemy", "has_recent_enemy_contact",
  "enemy_visible", "random", "wall_ahead", "damage_percent",
  "team_size", "my_index", "my_role",
  "is_in_heal_zone", "is_in_hazard",
  "arena_width", "arena_height", "spawn_position",
  "discovered_count",
  "health_percent", "angle_to", "is_facing", "enemy_heading",
  "is_enemy_facing_me", "ally_health", "kills", "time_alive",
  "nearest_sound", "nearest_mine", "nearest_pickup",
  "recall_position", "is_taunted", "is_in_overwatch", "has_effect",
  // Resource economy
  "heat", "max_heat", "heat_percent", "overheated",
  "ammo", "max_ammo", "ammo_percent",
  // Cloak + self-destruct state
  "is_cloaked", "cloak_remaining",
  "self_destruct_armed", "self_destruct_remaining",
  // Resupply depots
  "nearest_depot", "is_on_depot",
  // Hive memory
  "hive_get", "hive_set", "hive_has",
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
    const safeLine = Number.isFinite(Number(e.line)) ? Number(e.line) : 0;
    const lineNum = safeLine > 0 ? `<button type="button" class="error-line-num" data-line="${safeLine}">Ln ${safeLine}</button>` : "";
    return `<div class="error-line-entry">${lineNum}${escapeHtml(e.message || String(e))}</div>`;
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
  // Cap console entries to prevent unbounded DOM growth
  while (consoleEl.children.length > 500) {
    consoleEl.removeChild(consoleEl.firstChild);
  }
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

  const stopTimer = telemetry.startTimer(Telemetry.COMPILE_TIME_MS);
  try {
    const result = compile(source);
    stopTimer();

    if (result.success) {
      telemetry.increment(Telemetry.COMPILE_SUCCESS);
      compiledPlayer = { program: result.program, constants: result.constants };
      btnRun.disabled = false;
      if (typeof updateArenaLoadedBotLabel === "function") updateArenaLoadedBotLabel();

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
      telemetry.increment(Telemetry.COMPILE_FAILURE);
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
  const oppPreset = getBotEntry(oppKey);
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
      seed: getMatchSeed(),
    },
    participants,
  };

  let result;
  try {
    telemetry.increment(Telemetry.MATCH_RUN);
    result = runMatch(setup);
  } catch (e) {
    telemetry.increment(Telemetry.MATCH_ERROR);
    logToConsole(`Match error: ${e.message}`, "error");
    arenaStatus.textContent = "Error";
    return;
  }

  telemetry.record(Telemetry.MATCH_DURATION_TICKS, result.tickCount);
  lastMatchResult = result;

  const winnerLabel =
    result.winner === null ? "DRAW" :
    result.winner === 0 ? "Your Bot" : oppPreset.name;

  logToConsole(`Winner: ${winnerLabel}  |  ${result.reason}  |  ${result.tickCount} ticks  |  seed: ${setup.config.seed}`, "success");

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
      seed: getMatchSeed(),
    },
    participants,
  };

  let result;
  try {
    telemetry.increment(Telemetry.MATCH_RUN);
    result = runMatch(setup);
  } catch (e) {
    telemetry.increment(Telemetry.MATCH_ERROR);
    logToConsole(`Match error: ${e.message}`, "error");
    arenaStatus.textContent = "Error";
    return;
  }
  telemetry.record(Telemetry.MATCH_DURATION_TICKS, result.tickCount);
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
    <div class="result-winner ${isDraw ? 'draw' : ''}">${escapeHtml(winnerLabel)}</div>
    <div class="result-item"><span class="rl">Reason</span>${escapeHtml(result.reason.replace(/_/g, ' '))}</div>
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
        <span class="result-robot-name" style="color:${teamColor}">${escapeHtml(label)}</span>
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
// Dynamic arena layout — populated from replay metadata after each match
let currentArenaLayout = {
  covers: [],
  controlPoints: [],
  healingZones: [],
  hazards: [],
};

function canvasScale() {
  return Math.min(canvasEl.width / ARENA_WIDTH, canvasEl.height / ARENA_HEIGHT);
}

function arenaOffsetX() {
  return (canvasEl.width - ARENA_WIDTH * canvasScale()) / 2;
}

function arenaOffsetY() {
  return (canvasEl.height - ARENA_HEIGHT * canvasScale()) / 2;
}

function drawArenaBackground() {
  const w = canvasEl.width;
  const h = canvasEl.height;
  const s = canvasScale();
  const ox = arenaOffsetX();
  const oy = arenaOffsetY();
  const arenaW = ARENA_WIDTH * s;
  const arenaH = ARENA_HEIGHT * s;

  // Full-canvas dark background
  ctx.fillStyle = "#050510";
  ctx.fillRect(0, 0, w, h);

  // Radial gradient center glow (centered on arena)
  const grad = ctx.createRadialGradient(ox + arenaW / 2, oy + arenaH / 2, 0, ox + arenaW / 2, oy + arenaH / 2, arenaW * 0.7);
  grad.addColorStop(0, "rgba(0, 212, 255, 0.03)");
  grad.addColorStop(0.5, "rgba(0, 100, 180, 0.015)");
  grad.addColorStop(1, "transparent");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Translate to arena origin for all arena-local drawing
  ctx.save();
  ctx.translate(ox, oy);

  // Grid - finer, more subtle
  const step = 10 * s;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.025)";
  ctx.lineWidth = 0.5;
  for (let x = 0; x <= arenaW; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, arenaH);
    ctx.stroke();
  }
  for (let y = 0; y <= arenaH; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(arenaW, y);
    ctx.stroke();
  }

  // Major grid lines every 50 units
  const majorStep = 50 * s;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= arenaW; x += majorStep) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, arenaH);
    ctx.stroke();
  }
  for (let y = 0; y <= arenaH; y += majorStep) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(arenaW, y);
    ctx.stroke();
  }

  // Border with subtle glow
  ctx.strokeStyle = "rgba(0, 212, 255, 0.08)";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, arenaW - 2, arenaH - 2);

  // Corner accents
  const cornerLen = 20 * s;
  ctx.strokeStyle = "rgba(0, 212, 255, 0.15)";
  ctx.lineWidth = 2;
  // Top-left
  ctx.beginPath(); ctx.moveTo(1, cornerLen); ctx.lineTo(1, 1); ctx.lineTo(cornerLen, 1); ctx.stroke();
  // Top-right
  ctx.beginPath(); ctx.moveTo(arenaW - cornerLen, 1); ctx.lineTo(arenaW - 1, 1); ctx.lineTo(arenaW - 1, cornerLen); ctx.stroke();
  // Bottom-left
  ctx.beginPath(); ctx.moveTo(1, arenaH - cornerLen); ctx.lineTo(1, arenaH - 1); ctx.lineTo(cornerLen, arenaH - 1); ctx.stroke();
  // Bottom-right
  ctx.beginPath(); ctx.moveTo(arenaW - cornerLen, arenaH - 1); ctx.lineTo(arenaW - 1, arenaH - 1); ctx.lineTo(arenaW - 1, arenaH - cornerLen); ctx.stroke();

  // Hazard zones (draw first, behind everything)
  for (const hz of currentArenaLayout.hazards) {
    const cx = hz.x * s;
    const cy = hz.y * s;
    const r = hz.radius * s;
    // Radial gradient for hazard
    const hzGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    hzGrad.addColorStop(0, "rgba(255,51,51,0.12)");
    hzGrad.addColorStop(0.7, "rgba(255,51,51,0.05)");
    hzGrad.addColorStop(1, "rgba(255,51,51,0)");
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = hzGrad;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,51,51,0.2)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255,51,51,0.3)";
    ctx.font = `bold ${Math.max(7, 1.8 * s)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("HAZARD", cx, cy + 1.5 * s);
  }

  // Healing zones
  for (const zone of currentArenaLayout.healingZones) {
    const cx = zone.x * s;
    const cy = zone.y * s;
    const r = zone.radius * s;
    const hlGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    hlGrad.addColorStop(0, "rgba(0,255,136,0.1)");
    hlGrad.addColorStop(0.7, "rgba(0,255,136,0.04)");
    hlGrad.addColorStop(1, "rgba(0,255,136,0)");
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = hlGrad;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,255,136,0.2)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(0,255,136,0.35)";
    ctx.font = `bold ${Math.max(7, 1.8 * s)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("+HP", cx, cy + 1.5 * s);
  }

  // Cover walls / obstacles
  ctx.lineWidth = 1;
  for (const cover of currentArenaLayout.covers) {
    const cw = cover.w * s;
    const ch = cover.h * s;
    const cx = (cover.x * s) - (cw / 2);
    const cy = (cover.y * s) - (ch / 2);
    if (cover.destructible) {
      ctx.fillStyle = "rgba(180, 120, 80, 0.2)";
      ctx.strokeStyle = "rgba(200, 140, 100, 0.35)";
    } else {
      ctx.fillStyle = "rgba(80, 120, 200, 0.12)";
      ctx.strokeStyle = "rgba(100, 150, 230, 0.3)";
    }
    // Rounded corners for cover
    const cr = 2 * s;
    ctx.beginPath();
    ctx.moveTo(cx + cr, cy);
    ctx.lineTo(cx + cw - cr, cy);
    ctx.quadraticCurveTo(cx + cw, cy, cx + cw, cy + cr);
    ctx.lineTo(cx + cw, cy + ch - cr);
    ctx.quadraticCurveTo(cx + cw, cy + ch, cx + cw - cr, cy + ch);
    ctx.lineTo(cx + cr, cy + ch);
    ctx.quadraticCurveTo(cx, cy + ch, cx, cy + ch - cr);
    ctx.lineTo(cx, cy + cr);
    ctx.quadraticCurveTo(cx, cy, cx + cr, cy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // Control points
  ctx.font = `bold ${Math.max(8, 2 * s)}px sans-serif`;
  ctx.textAlign = "center";
  for (const cp of currentArenaLayout.controlPoints) {
    const cx = cp.x * s;
    const cy = cp.y * s;
    const cpGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 4 * s);
    cpGrad.addColorStop(0, "rgba(255,221,0,0.12)");
    cpGrad.addColorStop(1, "rgba(255,221,0,0)");
    ctx.beginPath();
    ctx.arc(cx, cy, 4 * s, 0, Math.PI * 2);
    ctx.fillStyle = cpGrad;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,221,0,0.2)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255,221,0,0.35)";
    ctx.fillText("CP", cx, cy + 6 * s);
  }

  ctx.restore(); // undo arena-origin translate
}

function drawRobot(x, y, health, maxHealth, energy, maxEnergy, teamId, label, isAlive, action, robotClass) {
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

  // Shield indicator (glowing ring)
  const actionType = action?.combat?.type ?? action?.movement?.type ?? null;
  if (actionType === "shield") {
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 7, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0,200,255,0.6)";
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  // Overwatch indicator (dotted ring)
  if (actionType === "overwatch") {
    ctx.beginPath();
    ctx.setLineDash([3, 3]);
    ctx.arc(cx, cy, radius + 6, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(170,85,255,0.6)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Outer glow (larger, more dramatic)
  const glowGrad = ctx.createRadialGradient(cx, cy, radius, cx, cy, radius + 8);
  glowGrad.addColorStop(0, glow);
  glowGrad.addColorStop(1, "transparent");
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 8, 0, Math.PI * 2);
  ctx.fillStyle = glowGrad;
  ctx.fill();

  // Body with gradient
  const bodyGrad = ctx.createRadialGradient(cx - radius * 0.3, cy - radius * 0.3, 0, cx, cy, radius);
  bodyGrad.addColorStop(0, color);
  bodyGrad.addColorStop(1, teamId === 0 ? "#006688" : "#881122");
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = bodyGrad;
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Class letter inside robot body
  const classLetter = { brawler: "B", ranger: "R", tank: "T", support: "S" };
  ctx.fillStyle = "#000";
  ctx.font = `bold ${Math.max(7, 1.8 * s)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(classLetter[robotClass] || "", cx, cy);
  ctx.textBaseline = "alphabetic";

  // Health bar
  const barW = radius * 2.8;
  const barH = 3;
  const barX = cx - barW / 2;
  const barY = cy - radius - 14;
  const hpRatio = Math.max(0, health / maxHealth);

  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(barX - 0.5, barY - 0.5, barW + 1, barH + 1);

  const hpColor = hpRatio > 0.5 ? "#00ff88" : hpRatio > 0.25 ? "#ff8800" : "#ff3355";
  ctx.fillStyle = hpColor;
  ctx.fillRect(barX, barY, barW * hpRatio, barH);

  // Energy bar (below health bar)
  const eBarY = barY + barH + 2;
  const eBarH = 2;
  const eRatio = maxEnergy > 0 ? Math.max(0, (energy ?? 0) / maxEnergy) : 0;

  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(barX - 0.5, eBarY - 0.5, barW + 1, eBarH + 1);
  ctx.fillStyle = "#4488ff";
  ctx.fillRect(barX, eBarY, barW * eRatio, eBarH);

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

  // Outer glow
  const projGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius + 6);
  projGlow.addColorStop(0, "rgba(255,221,0,0.4)");
  projGlow.addColorStop(0.5, "rgba(255,180,0,0.15)");
  projGlow.addColorStop(1, "transparent");
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 6, 0, Math.PI * 2);
  ctx.fillStyle = projGlow;
  ctx.fill();

  // Core
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = "#ffdd00";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = 0.5;
  ctx.stroke();
}

function drawFrame(frame, labels) {
  if (!frame || !frame.robots) {
    drawArenaBackground();
    return;
  }

  // Update cover data from frame if available (destructible cover may change)
  if (frame.covers) {
    currentArenaLayout.covers = frame.covers.map(c => ({
      x: c.x, y: c.y, w: c.w, h: c.h, destructible: c.destructible,
    }));
  }

  drawArenaBackground();

  const s = canvasScale();

  // Translate to arena origin so all entity drawing is properly centered
  ctx.save();
  ctx.translate(arenaOffsetX(), arenaOffsetY());

  // Draw mines
  if (frame.mines) {
    for (const m of frame.mines) {
      const mx = m.position.x * s;
      const my = m.position.y * s;
      ctx.beginPath();
      ctx.arc(mx, my, 1.5 * s, 0, Math.PI * 2);
      ctx.fillStyle = m.teamId === 0 ? "rgba(0,212,255,0.4)" : "rgba(255,51,85,0.4)";
      ctx.fill();
      ctx.strokeStyle = m.teamId === 0 ? "rgba(0,212,255,0.7)" : "rgba(255,51,85,0.7)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // Draw pickups
  if (frame.pickups) {
    const pickupColors = {
      energy: "rgb(0,170,255)", speed: "rgb(255,255,0)", damage: "rgb(255,68,68)", vision: "rgb(170,68,255)",
    };
    const pickupLabels = {
      energy: "E", speed: "S", damage: "D", vision: "V",
    };
    for (const p of frame.pickups) {
      const px = p.position.x * s;
      const py = p.position.y * s;
      const color = pickupColors[p.type] || "#ffffff";
      // Pulsing glow
      ctx.beginPath();
      ctx.arc(px, py, 2.5 * s, 0, Math.PI * 2);
      ctx.fillStyle = color.replace(")", ",0.15)").replace("rgb", "rgba");
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px, py, 1.5 * s, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.fillStyle = "#000";
      ctx.font = `bold ${Math.max(7, 1.5 * s)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(pickupLabels[p.type] || "?", px, py + 0.5 * s);
    }
  }

  // Draw projectiles first (behind robots)
  if (frame.projectiles) {
    for (const p of frame.projectiles) {
      drawProjectile(p.position.x, p.position.y);
    }
  }

  for (let i = 0; i < frame.robots.length; i++) {
    const r = frame.robots[i];
    const classStats = CLASS_STATS[r.robotClass];
    const maxHP = classStats?.health || 100;
    const maxEnergy = classStats?.energy || 100;
    const isAlive = r.health > 0;
    drawRobot(r.position.x, r.position.y, r.health, maxHP, r.energy, maxEnergy, r.teamId, labels[r.id] || r.id, isAlive, r.action, r.robotClass);
  }

  // Draw event indicators (damage flashes, grenade explosions, etc.)
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

          // Draw damage number floating up
          ctx.fillStyle = "rgba(255,80,100,0.9)";
          ctx.font = `bold ${Math.max(8, 2 * s)}px sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(`-${evt.data.damage}`, cx + 8, cy - 14);
        }

        // Grenade explosion marker (larger blast radius indicator)
        if (evt.data.source === "grenade" || evt.data.damageType === "grenade") {
          const s = canvasScale();
          const pos = targetRobot?.position ?? evt.data.position;
          if (pos) {
            const gx = pos.x * s;
            const gy = pos.y * s;
            ctx.beginPath();
            ctx.arc(gx, gy, 3.5 * s, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(255,160,0,0.25)";
            ctx.fill();
            ctx.strokeStyle = "rgba(255,160,0,0.6)";
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        }
      }

      // Destroyed marker
      if (evt.type === "destroyed") {
        const deadBot = frame.robots.find(r => r.id === evt.robotId);
        if (deadBot) {
          const s = canvasScale();
          const dx = deadBot.position.x * s;
          const dy = deadBot.position.y * s;
          ctx.fillStyle = "rgba(255,0,0,0.5)";
          ctx.font = `bold ${Math.max(10, 3 * s)}px sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText("DESTROYED", dx, dy - 20);
        }
      }
    }
  }

  // Draw decision traces overlay (if enabled and available)
  if (showDecisionTraces && frame.traces) {
    const s = canvasScale();
    ctx.font = `${Math.max(7, 1.5 * s)}px monospace`;
    ctx.textAlign = "left";
    for (const trace of frame.traces) {
      const robot = frame.robots.find(r => r.id === trace.robotId);
      if (!robot || robot.health <= 0) continue;
      const tx = robot.position.x * s + 12;
      const ty = robot.position.y * s - 8;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      const text = `${trace.action ?? "idle"} [${trace.budgetUsed}]`;
      const metrics = ctx.measureText(text);
      ctx.fillRect(tx - 2, ty - 8, metrics.width + 4, 11);
      ctx.fillStyle = "rgba(200,200,255,0.9)";
      ctx.fillText(text, tx, ty);
    }
  }

  ctx.restore(); // undo arena-origin translate
}

function drawIdle() {
  drawArenaBackground();
  const s = canvasScale();
  const ox = arenaOffsetX();
  const oy = arenaOffsetY();
  const arenaW = ARENA_WIDTH * s;
  const arenaH = ARENA_HEIGHT * s;
  const centerX = ox + arenaW / 2;
  const centerY = oy + arenaH / 2;

  // Centered message with subtle styling
  ctx.fillStyle = "rgba(0, 212, 255, 0.15)";
  ctx.font = `bold ${Math.max(12, arenaW * 0.04)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("AWAITING COMBATANTS", centerX, centerY - 10);
  ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
  ctx.font = `${Math.max(10, arenaW * 0.028)}px sans-serif`;
  ctx.fillText("Compile a bot and run a match", centerX, centerY + 14);
  ctx.textBaseline = "alphabetic";
}

// ============================================================================
// Match-Live Mode (Arena Dominance)
// ============================================================================

function resizeCanvasToWrap() {
  const wrap = document.querySelector(".arena-canvas-wrap");
  if (wrap) {
    const w = Math.max(400, wrap.clientWidth - 32);
    const h = Math.max(400, wrap.clientHeight - 32);
    if (canvasEl.width !== w || canvasEl.height !== h) {
      canvasEl.width = w;
      canvasEl.height = h;
    }
  }
}

function enterMatchLive(participants) {
  if (matchLiveMode) return;
  matchLiveMode = true;
  matchLiveParticipants = participants;
  document.body.classList.add("match-live");

  // Resize canvas after CSS transition completes (0.4s)
  setTimeout(resizeCanvasToWrap, 50);
  setTimeout(resizeCanvasToWrap, 450);

  // Populate scoreboard
  if (participants && scoreboardTeam0 && scoreboardTeam1) {
    const t0 = participants.filter(p => p.teamId === 0).map(p => {
      const label = p.playerId === "player" ? "You" : p.playerId;
      return label.charAt(0).toUpperCase() + label.slice(1);
    });
    const t1 = participants.filter(p => p.teamId === 1).map(p => {
      return p.playerId.charAt(0).toUpperCase() + p.playerId.slice(1);
    });
    scoreboardTeam0.textContent = t0.join(" & ") || "Team 0";
    scoreboardTeam1.textContent = t1.join(" & ") || "Team 1";
  }
}

function exitMatchLive() {
  if (!matchLiveMode) return;
  matchLiveMode = false;
  matchLiveParticipants = null;
  document.body.classList.remove("match-live");

  // Reset canvas size for builder view
  if (currentView === "builder") {
    canvasEl.width = 400;
    canvasEl.height = 400;
  } else if (currentView === "arena") {
    requestAnimationFrame(resizeArenaCanvasForCurrentView);
  }

  // Redraw
  if (replayData && replayData[replayFrameIndex]) {
    drawFrame(replayData[replayFrameIndex], replayLabels);
  }
}

function updateScoreboard(frame) {
  if (!matchLiveMode || !frame || !scoreboardTick) return;
  const totalTicks = replayData?.[replayData.length - 1]?.tick ?? 0;
  scoreboardTick.textContent = `Tick ${frame.tick} / ${totalTicks}`;
}

// ============================================================================
// Replay System
// ============================================================================

function startReplay(result, opponentName) {
  stopReplay();

  // Load the procedural arena layout from replay metadata
  const layout = result.replay.metadata?.arenaLayout;
  if (layout) {
    currentArenaLayout = layout;
  }

  const frames = result.replay.frames;
  if (frames.length === 0) {
    drawIdle();
    arenaStatus.textContent = "No frames";
    return;
  }

  replayData = frames;
  lastReplayBookmarks = computeBookmarks(frames);
  const labelsById = {};
  for (const p of result.replay.metadata?.participants ?? []) {
    if (p.teamId === 0 && p.playerId === "player") labelsById[p.robotId] = "You";
    else labelsById[p.robotId] = p.playerId;
  }
  replayLabels = labelsById;
  replayFrameIndex = 0;
  replayPlaying = true;
  replaySpeed = parseFloat(replaySpeedSelect.value) || 0.24;

  // Enter match-live mode — arena takes over the screen
  const participants = result.replay.metadata?.participants ?? [];
  enterMatchLive(participants);

  // Log bookmarks to console
  if (lastReplayBookmarks) {
    const bm = lastReplayBookmarks;
    if (bm.firstDamage !== null) logToConsole(`  Bookmark: First damage at tick ${frames[bm.firstDamage]?.tick ?? bm.firstDamage}`, "stat");
    if (bm.firstKill !== null) logToConsole(`  Bookmark: First kill at tick ${frames[bm.firstKill]?.tick ?? bm.firstKill}`, "stat");
  }

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

    if (replayFrameIndex >= replayData.length) {
      replayPlaying = false;
      btnReplayToggle.textContent = "\u25B6";
      return;
    }
    const frame = replayData[replayFrameIndex];
    if (!frame) return;
    drawFrame(frame, replayLabels);
    replayScrubber.value = replayFrameIndex;
    replayTickLabel.textContent = `${frame.tick} / ${replayData[replayData.length - 1].tick}`;
    updateScoreboard(frame);

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

function jumpToBookmark(bookmarkName) {
  if (!replayData || !lastReplayBookmarks) return;
  const idx = lastReplayBookmarks[bookmarkName];
  if (idx === null || idx === undefined) {
    logToConsole(`No ${bookmarkName} bookmark found in this replay.`, "warn");
    return;
  }
  stopReplay();
  btnReplayToggle.textContent = "\u25B6";
  replayFrameIndex = idx;
  const frame = replayData[idx];
  if (frame) {
    drawFrame(frame, replayLabels);
    replayScrubber.value = idx;
    replayTickLabel.textContent = `${frame.tick} / ${replayData[replayData.length - 1].tick}`;
    arenaStatus.textContent = `Tick ${frame.tick} (${bookmarkName})`;
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
  const preset = getBotEntry(key);
  if (!preset) return;
  editorEl.value = preset.source;
  currentPreset = key;
  currentEditorBotName = preset.name;
  currentEditorUserBotId = key.startsWith("user_") ? key : null;

  presetButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.bot === key);
  });

  // Also highlight user bot sidebar entries
  document.querySelectorAll(".sidebar-user-bot").forEach((el) => {
    el.classList.toggle("active", el.dataset.bot === key);
  });

  compiledPlayer = null;
  btnRun.disabled = true;
  clearErrors();
  updateHighlighting();
  updateLineNumbers();
  updateEditorFileName();
  updateArenaLoadedBotLabel();
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
btnBookmarkDamage?.addEventListener("click", () => jumpToBookmark("firstDamage"));
btnBookmarkKill?.addEventListener("click", () => jumpToBookmark("firstKill"));
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
// Team Builder (Modal)
// ============================================================================

const MAX_TEAM_SLOTS = 4;

const BOT_ICONS = {
  bruiser: "B", kiter: "K", fortress: "F",
  healer: "H", flanker: "L", sentinel: "S",
};

function botIconLetter(key) {
  if (BOT_ICONS[key]) return BOT_ICONS[key];
  const entry = getBotEntry(key);
  if (!entry) return "?";
  // For user bots: use first letter of name, uppercased
  return (entry.name?.charAt(0) || "U").toUpperCase();
}

function tbGetBotClass(key) {
  return getBotEntry(key)?.class ?? "brawler";
}

function tbCreateBotCard(team, botKey) {
  const preset = getBotEntry(botKey);
  const cls = preset?.class ?? "brawler";
  const card = document.createElement("div");
  card.className = "tb-bot-card";
  card.dataset.team = team;

  const options = buildBotSelectOptions(botKey);

  // `cls` is already validated against a whitelist upstream, but escape it
  // defensively so that a corrupted localStorage entry can never inject HTML.
  const safeCls = escapeHtml(cls);
  card.innerHTML = `
    <div class="tb-card-icon ${safeCls}">${escapeHtml(botIconLetter(botKey))}</div>
    <div class="tb-card-body">
      <select class="tb-card-select">${options}</select>
      <span class="tb-card-class">${safeCls}</span>
    </div>
    <button class="tb-remove-btn" title="Remove">&times;</button>`;

  const select = card.querySelector(".tb-card-select");
  const icon = card.querySelector(".tb-card-icon");
  const classLabel = card.querySelector(".tb-card-class");

  select.addEventListener("change", () => {
    const newCls = tbGetBotClass(select.value);
    icon.className = `tb-card-icon ${newCls}`;
    icon.textContent = botIconLetter(select.value);
    classLabel.textContent = newCls;
  });

  card.querySelector(".tb-remove-btn").addEventListener("click", () => {
    card.remove();
    tbUpdateInfo();
    tbUpdateEmptyStates();
  });

  return card;
}

function tbUpdateEmptyStates() {
  for (const container of [tbAllySlots, tbEnemySlots]) {
    if (!container) continue;
    const existing = container.querySelector(".tb-empty");
    if (container.querySelectorAll(".tb-bot-card").length === 0) {
      if (!existing) {
        const empty = document.createElement("div");
        empty.className = "tb-empty";
        empty.textContent = "No bots added yet";
        container.appendChild(empty);
      }
    } else if (existing) {
      existing.remove();
    }
  }
}

function tbUpdateInfo() {
  const allyCount = tbAllySlots?.querySelectorAll(".tb-bot-card").length ?? 0;
  const enemyCount = tbEnemySlots?.querySelectorAll(".tb-bot-card").length ?? 0;
  if (tbMatchInfo) tbMatchInfo.textContent = `${allyCount} vs ${enemyCount}`;
  if (btnTbRun) btnTbRun.disabled = allyCount < 1 || enemyCount < 1;
}

function tbAddBot(team, botKey) {
  const container = team === "ally" ? tbAllySlots : tbEnemySlots;
  if (!container) return;
  const count = container.querySelectorAll(".tb-bot-card").length;
  if (count >= MAX_TEAM_SLOTS) {
    logToConsole(`Max ${MAX_TEAM_SLOTS} bots per team.`, "warn");
    return;
  }
  const empty = container.querySelector(".tb-empty");
  if (empty) empty.remove();
  container.appendChild(tbCreateBotCard(team, botKey));
  tbUpdateInfo();
}

function tbOpenModal() {
  if (!teamBuilderModal) return;

  // Reset with defaults
  if (tbAllySlots) tbAllySlots.innerHTML = "";
  if (tbEnemySlots) tbEnemySlots.innerHTML = "";

  tbAddBot("ally", "bruiser");
  tbAddBot("ally", "healer");
  tbAddBot("enemy", "kiter");
  tbAddBot("enemy", "fortress");

  tbUpdateInfo();
  // Remember which element opened the modal so we can restore focus on close,
  // which is important for keyboard-only users.
  tbLastFocusedElement = document.activeElement;
  teamBuilderModal.hidden = false;
  // Move focus into the modal so screen readers announce it.
  (btnTbRun || btnCloseTeamBuilder)?.focus?.();
}

let tbLastFocusedElement = null;

function tbCloseModal() {
  if (teamBuilderModal) teamBuilderModal.hidden = true;
  if (tbLastFocusedElement && typeof tbLastFocusedElement.focus === "function") {
    tbLastFocusedElement.focus();
  }
  tbLastFocusedElement = null;
}

function tbRunBattle() {
  if (!tbAllySlots || !tbEnemySlots) return;

  const collectTeam = (container, teamId, prefix) => {
    const cards = container.querySelectorAll(".tb-bot-card");
    const team = [];
    for (let i = 0; i < cards.length; i++) {
      const key = cards[i].querySelector(".tb-card-select")?.value;
      const preset = getBotEntry(key);
      if (!preset) { logToConsole(`Unknown bot: ${key}`, "error"); return null; }
      try {
        const compiled = compile(preset.source);
        if (!compiled.success) {
          logToConsole(`${preset.name} compile fail: ${compiled.errors.join(", ")}`, "error");
          return null;
        }
        team.push({
          program: compiled.program, constants: compiled.constants,
          playerId: `${prefix}_${preset.name.toLowerCase()}_${i}`, teamId,
        });
      } catch (e) {
        logToConsole(`${preset.name} error: ${e.message}`, "error");
        return null;
      }
    }
    return team;
  };

  const allies = collectTeam(tbAllySlots, 0, "ally");
  if (!allies) return;
  const enemies = collectTeam(tbEnemySlots, 1, "opp");
  if (!enemies) return;

  if (allies.length < 1 || enemies.length < 1) {
    logToConsole("Both teams need at least one bot.", "warn");
    return;
  }

  const participants = [...allies, ...enemies];
  const total = participants.length;
  const mode = total <= 2 ? "duel_1v1" : "squad_2v2";

  const setup = {
    config: {
      mode, arenaWidth: ARENA_WIDTH, arenaHeight: ARENA_HEIGHT,
      maxTicks: 3000, tickRate: 30, seed: getMatchSeed(),
    },
    participants,
  };

  tbCloseModal();

  logToConsole(`\n--- Team Builder: ${allies.length}v${enemies.length} ---`, "event");
  let result;
  try {
    telemetry.increment(Telemetry.MATCH_RUN);
    result = runMatch(setup);
  } catch (e) {
    telemetry.increment(Telemetry.MATCH_ERROR);
    logToConsole(`Match error: ${e.message}`, "error");
    return;
  }

  telemetry.record(Telemetry.MATCH_DURATION_TICKS, result.tickCount);
  lastMatchResult = result;
  logToConsole(`Winner: ${result.winner === null ? "DRAW" : `Team ${result.winner}`} | ${result.reason} | ${result.tickCount} ticks`, "success");
  showMatchResults(result, "Enemy Team");
  startReplay(result, "Team Battle");
}

// ============================================================================
// Full-page Battle & Decision Traces Toggles
// ============================================================================

function toggleFullPageBattle() {
  fullPageBattle = !fullPageBattle;
  document.body.classList.toggle("fullpage-battle", fullPageBattle);
  btnToggleFullpage?.classList.toggle("active", fullPageBattle);
  if (btnToggleFullpage) btnToggleFullpage.textContent = fullPageBattle ? "Collapse" : "Expand";

  // Resize canvas for full-page mode
  requestAnimationFrame(() => {
    if (fullPageBattle) {
      const wrap = document.querySelector(".arena-canvas-wrap");
      if (wrap) {
        canvasEl.width = Math.max(400, wrap.clientWidth - 32);
        canvasEl.height = Math.max(400, wrap.clientHeight - 32);
      }
    } else {
      canvasEl.width = 400;
      canvasEl.height = 400;
    }

    // Redraw current frame
    if (replayData && replayData[replayFrameIndex]) {
      drawFrame(replayData[replayFrameIndex], replayLabels);
    }
  });
}

function toggleDecisionTraces() {
  showDecisionTraces = !showDecisionTraces;
  btnToggleTraces?.classList.toggle("active", showDecisionTraces);

  // Redraw current frame
  if (replayData && replayData[replayFrameIndex]) {
    drawFrame(replayData[replayFrameIndex], replayLabels);
  }
}

// Wire Team Builder modal
btnOpenTeamBuilder?.addEventListener("click", tbOpenModal);
btnCloseTeamBuilder?.addEventListener("click", tbCloseModal);
btnTbCancel?.addEventListener("click", tbCloseModal);
btnTbRun?.addEventListener("click", tbRunBattle);

// Add bot buttons inside modal
for (const btn of document.querySelectorAll(".tb-add-btn")) {
  btn.addEventListener("click", () => tbAddBot(btn.dataset.team, "bruiser"));
}

// Close modal on overlay click
teamBuilderModal?.addEventListener("click", (e) => {
  if (e.target === teamBuilderModal) tbCloseModal();
});

// Close modal on Escape key — beta testers have complained about being
// trapped in the modal without a mouse.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && teamBuilderModal && !teamBuilderModal.hidden) {
    tbCloseModal();
  }
});

// Wire Arena toggles
btnToggleTraces?.addEventListener("click", toggleDecisionTraces);
btnToggleFullpage?.addEventListener("click", toggleFullPageBattle);

// Wire match-live exit button
btnExitMatchLive?.addEventListener("click", exitMatchLive);

// ============================================================================
// Bot Entry Helper (unified access: preset OR user library)
// ============================================================================

/**
 * Look up a bot by key. Returns a normalized { name, class, source } object,
 * or null if no match. Keys prefixed with "user_" resolve against the bot
 * library; anything else falls back to BOT_PRESETS.
 */
function getBotEntry(key) {
  if (!key) return null;
  if (typeof key === "string" && key.startsWith("user_")) {
    const bot = BotLibrary.getById(key);
    if (!bot) return null;
    return { name: bot.name, class: bot.class, source: bot.source, isUser: true, id: bot.id };
  }
  const preset = BOT_PRESETS[key];
  if (!preset) return null;
  return { name: preset.name, class: preset.class, source: preset.source, isUser: false };
}

/** Build <option> markup for every available bot, marking `selectedKey` as selected. */
function buildBotSelectOptions(selectedKey) {
  const groups = [];
  const presetOpts = Object.entries(BOT_PRESETS)
    .map(([k, p]) => `<option value="${k}"${k === selectedKey ? " selected" : ""}>${escapeHtml(p.name)}</option>`)
    .join("");
  groups.push(`<optgroup label="Presets">${presetOpts}</optgroup>`);

  const userBots = BotLibrary.getAll();
  if (userBots.length > 0) {
    const userOpts = userBots
      .map((b) => `<option value="${b.id}"${b.id === selectedKey ? " selected" : ""}>${escapeHtml(b.name)} (${b.class})</option>`)
      .join("");
    groups.push(`<optgroup label="My Bots">${userOpts}</optgroup>`);
  }
  return groups.join("");
}

// ============================================================================
// Toast notifications
// ============================================================================

const toastContainer = document.getElementById("toast-container");

function toast(message, type = "info", timeout = 3500) {
  if (!toastContainer) return;
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = message;
  toastContainer.appendChild(el);
  requestAnimationFrame(() => el.classList.add("visible"));
  setTimeout(() => {
    el.classList.remove("visible");
    setTimeout(() => el.remove(), 250);
  }, timeout);
}

// ============================================================================
// View Switching (Builder / Arena / Library)
// ============================================================================

function setView(name) {
  if (name !== "builder" && name !== "arena" && name !== "library") return;
  currentView = name;
  document.body.dataset.view = name;

  // Exit match-live mode if switching away from workspace views
  if (name === "library" && matchLiveMode) exitMatchLive();

  // Top nav tabs
  document.querySelectorAll(".view-tab").forEach((btn) => {
    const active = btn.dataset.view === name;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });

  // Sidebar panels
  document.querySelectorAll(".sidebar-panel").forEach((panel) => {
    panel.hidden = panel.dataset.sidebar !== name;
  });

  // Main view content — library is a separate area; builder+arena share workspace
  const workspace = document.querySelector('[data-view-content="workspace"]');
  const libraryView = document.querySelector('[data-view-content="library"]');
  if (workspace) workspace.hidden = name === "library";
  if (libraryView) libraryView.hidden = name !== "library";

  if (name === "library") {
    renderLibrary();
  } else if (name === "arena") {
    // Resize canvas to fill the arena pane since editor collapses
    requestAnimationFrame(resizeArenaCanvasForCurrentView);
  } else {
    // Builder: reset canvas to compact size
    canvasEl.width = 400;
    canvasEl.height = 400;
    if (replayData && replayData[replayFrameIndex]) {
      drawFrame(replayData[replayFrameIndex], replayLabels);
    } else {
      drawIdle();
    }
  }

  updateArenaLoadedBotLabel();
}

function resizeArenaCanvasForCurrentView() {
  const wrap = document.querySelector(".arena-canvas-wrap");
  if (!wrap) return;
  const w = Math.max(400, wrap.clientWidth - 20);
  const h = Math.max(400, wrap.clientHeight - 20);
  canvasEl.width = w;
  canvasEl.height = h;
  if (replayData && replayData[replayFrameIndex]) {
    drawFrame(replayData[replayFrameIndex], replayLabels);
  } else {
    drawIdle();
  }
}

document.querySelectorAll(".view-tab").forEach((btn) => {
  btn.addEventListener("click", () => setView(btn.dataset.view));
});

window.addEventListener("resize", () => {
  if (matchLiveMode) {
    const wrap = document.querySelector(".arena-canvas-wrap");
    if (wrap) {
      canvasEl.width = Math.max(400, wrap.clientWidth - 32);
      canvasEl.height = Math.max(400, wrap.clientHeight - 32);
    }
    if (replayData && replayData[replayFrameIndex]) {
      drawFrame(replayData[replayFrameIndex], replayLabels);
    }
  } else if (currentView === "arena") {
    resizeArenaCanvasForCurrentView();
  }
});

// ============================================================================
// Editor header / Arena loaded-bot label
// ============================================================================

const editorFileNameEl = document.getElementById("editor-file-name");
const arenaLoadedBotEl = document.getElementById("arena-loaded-bot");

function updateEditorFileName() {
  if (!editorFileNameEl) return;
  const base = (currentEditorBotName || "robot").replace(/\s+/g, "_").toLowerCase();
  editorFileNameEl.textContent = `${base}.arena${currentEditorUserBotId ? " (library)" : ""}`;
}

function updateArenaLoadedBotLabel() {
  if (!arenaLoadedBotEl) return;
  if (compiledPlayer) {
    arenaLoadedBotEl.textContent = `${currentEditorBotName || "Unnamed"} (compiled)`;
    arenaLoadedBotEl.classList.add("ok");
  } else {
    arenaLoadedBotEl.textContent = `${currentEditorBotName || "Unnamed"} (not compiled)`;
    arenaLoadedBotEl.classList.remove("ok");
  }
}

// ============================================================================
// Opponent select — dynamic, includes user bots
// ============================================================================

function refreshOpponentSelect() {
  if (!opponentSelect) return;
  const prev = opponentSelect.value || "kiter";
  opponentSelect.innerHTML = buildBotSelectOptions(prev);
  // If previous value is no longer valid, fall back to kiter
  if (!getBotEntry(opponentSelect.value)) {
    opponentSelect.value = "kiter";
  }
}

// ============================================================================
// Save-to-Library button
// ============================================================================

const btnSaveLibrary = document.getElementById("btn-save-library");

btnSaveLibrary?.addEventListener("click", () => {
  const source = editorEl.value;
  if (!source.trim()) {
    toast("Editor is empty.", "warn");
    return;
  }

  // If this editor already represents a library bot, update it in place.
  if (currentEditorUserBotId) {
    const r = BotLibrary.updateBot(currentEditorUserBotId, source);
    if (r.ok) {
      currentEditorBotName = r.bot.name;
      updateEditorFileName();
      toast(`Updated "${r.bot.name}" in library.`, "success");
      logToConsole(`Library: updated "${r.bot.name}".`, "success");
    } else {
      toast(`Validation failed: ${r.errors[0]}`, "error", 6000);
      logToConsole(`Library save failed: ${r.errors.join("; ")}`, "error");
    }
    return;
  }

  const r = BotLibrary.addBot(source);
  if (r.ok) {
    currentEditorUserBotId = r.bot.id;
    currentEditorBotName = r.bot.name;
    currentPreset = r.bot.id;
    updateEditorFileName();
    toast(`Saved "${r.bot.name}" to library.`, "success");
    logToConsole(`Library: saved "${r.bot.name}" (${r.bot.class}).`, "success");
    if (r.warnings?.length) {
      logToConsole(`Warnings: ${r.warnings.join("; ")}`, "warn");
    }
  } else {
    toast(`Validation failed: ${r.errors[0]}`, "error", 6000);
    logToConsole(`Library save failed: ${r.errors.join("; ")}`, "error");
  }
});

// ============================================================================
// Library View — render user-bot grid & upload handling
// ============================================================================

const libraryGridEl = document.getElementById("library-grid");
const libraryEmptyEl = document.getElementById("library-empty");
const libraryDropzoneEl = document.getElementById("library-dropzone");
const libraryFileInput = document.getElementById("library-file-input");
const libraryUploadResultsEl = document.getElementById("library-upload-results");
const librarySearchEl = document.getElementById("library-search");
const libraryFilterClassEl = document.getElementById("library-filter-class");
const tabCountLibraryEl = document.getElementById("tab-count-library");
const sidebarUserBotsEl = document.getElementById("sidebar-user-bots");

function formatDate(ts) {
  try {
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch { return ""; }
}

function filterLibrary(bots) {
  const q = (librarySearchEl?.value || "").trim().toLowerCase();
  const cls = libraryFilterClassEl?.value || "";
  return bots.filter((b) => {
    if (cls && b.class !== cls) return false;
    if (q) {
      const hay = `${b.name} ${b.author ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function classIconLetter(cls) {
  return { brawler: "B", ranger: "R", tank: "T", support: "S" }[cls] ?? "?";
}

function renderLibrary() {
  if (!libraryGridEl) return;
  const all = BotLibrary.getAll();
  const bots = filterLibrary(all);

  libraryGridEl.innerHTML = "";

  if (all.length === 0) {
    libraryEmptyEl.hidden = false;
    libraryGridEl.hidden = true;
    return;
  }
  libraryEmptyEl.hidden = true;
  libraryGridEl.hidden = false;

  if (bots.length === 0) {
    libraryGridEl.innerHTML = `<div class="library-no-match">No bots match the current filter.</div>`;
    return;
  }

  for (const bot of bots) {
    const card = document.createElement("div");
    card.className = "bot-card";
    card.dataset.id = bot.id;
    card.innerHTML = `
      <div class="bot-card-header">
        <div class="bot-class-icon ${bot.class}">${classIconLetter(bot.class)}</div>
        <div class="bot-card-title">
          <div class="bot-card-name" title="${escapeHtml(bot.name)}">${escapeHtml(bot.name)}</div>
          <div class="bot-card-meta">${bot.class}${bot.author ? " • " + escapeHtml(bot.author) : ""}</div>
        </div>
      </div>
      <div class="bot-card-source"><code>${escapeHtml(bot.source.split("\n").slice(0, 5).join("\n"))}</code></div>
      <div class="bot-card-footer">
        <span class="bot-card-date">${formatDate(bot.updatedAt || bot.createdAt)}</span>
        <div class="bot-card-actions">
          <button class="bc-btn" data-act="edit"   title="Load in Builder">Edit</button>
          <button class="bc-btn" data-act="battle" title="Use as your bot in Arena">Battle</button>
          <button class="bc-btn" data-act="opponent" title="Set as opponent">Opp</button>
          <button class="bc-btn" data-act="export" title="Download .arena">Export</button>
          <button class="bc-btn bc-btn-danger" data-act="delete" title="Delete">&times;</button>
        </div>
      </div>`;

    card.querySelector('[data-act="edit"]').addEventListener("click", () => {
      loadPreset(bot.id);
      setView("builder");
      toast(`Loaded "${bot.name}" into editor.`, "info");
    });
    card.querySelector('[data-act="battle"]').addEventListener("click", () => {
      loadPreset(bot.id);
      if (doCompile()) {
        setView("arena");
        toast(`"${bot.name}" compiled. Ready to battle.`, "success");
      }
    });
    card.querySelector('[data-act="opponent"]').addEventListener("click", () => {
      refreshOpponentSelect();
      opponentSelect.value = bot.id;
      setView("arena");
      toast(`"${bot.name}" set as opponent.`, "info");
    });
    card.querySelector('[data-act="export"]').addEventListener("click", () => {
      BotLibrary.exportBot(bot.id);
    });
    card.querySelector('[data-act="delete"]').addEventListener("click", () => {
      if (confirm(`Delete "${bot.name}"? This cannot be undone.`)) {
        BotLibrary.deleteBot(bot.id);
        toast(`Deleted "${bot.name}".`, "info");
      }
    });

    libraryGridEl.appendChild(card);
  }
}

function renderSidebarUserBots() {
  if (!sidebarUserBotsEl) return;
  const bots = BotLibrary.getAll();
  if (tabCountLibraryEl) tabCountLibraryEl.textContent = String(bots.length);

  if (bots.length === 0) {
    sidebarUserBotsEl.innerHTML = `<div class="sidebar-empty-hint">No saved bots yet. Write code in the editor and click <b>Save to Library</b>, or upload a <code>.arena</code> file from the My Bots tab.</div>`;
    return;
  }

  sidebarUserBotsEl.innerHTML = "";
  for (const bot of bots) {
    const el = document.createElement("button");
    el.className = "bot-preset sidebar-user-bot";
    if (bot.id === currentPreset) el.classList.add("active");
    el.dataset.bot = bot.id;
    el.title = `${bot.name} — ${bot.class}`;
    el.innerHTML = `
      <div class="bot-class-icon ${bot.class}">${classIconLetter(bot.class)}</div>
      <div class="bot-preset-info">
        <span class="bot-preset-name">${escapeHtml(bot.name)}</span>
        <span class="bot-preset-class">${bot.class}</span>
      </div>`;
    el.addEventListener("click", () => loadPreset(bot.id));
    sidebarUserBotsEl.appendChild(el);
  }
}

async function handleFileUpload(fileList) {
  const files = Array.from(fileList || []);
  if (files.length === 0) return;

  libraryUploadResultsEl.hidden = false;
  libraryUploadResultsEl.innerHTML = `<div class="upload-status">Validating ${files.length} file${files.length > 1 ? "s" : ""}…</div>`;

  const results = await BotLibrary.importFiles(files);

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;

  const parts = [
    `<div class="upload-summary">`,
    `<span class="upload-ok">${okCount} saved</span>`,
    failCount ? `<span class="upload-fail">${failCount} rejected</span>` : "",
    `<button class="upload-dismiss" id="btn-dismiss-upload">Dismiss</button>`,
    `</div>`,
  ];

  for (const r of results) {
    if (r.ok) {
      parts.push(`<div class="upload-row ok"><b>&#10004; ${escapeHtml(r.file)}</b> → "${escapeHtml(r.bot.name)}" (${r.bot.class})</div>`);
    } else {
      parts.push(`<div class="upload-row fail"><b>&#10008; ${escapeHtml(r.file)}</b><div class="upload-errors">${r.errors.map(escapeHtml).join("<br>")}</div></div>`);
    }
  }

  libraryUploadResultsEl.innerHTML = parts.join("");
  document.getElementById("btn-dismiss-upload")?.addEventListener("click", () => {
    libraryUploadResultsEl.hidden = true;
    libraryUploadResultsEl.innerHTML = "";
  });

  if (okCount > 0) {
    toast(`Imported ${okCount} bot${okCount > 1 ? "s" : ""}.`, "success");
  }
  if (failCount > 0 && okCount === 0) {
    toast(`${failCount} file${failCount > 1 ? "s" : ""} failed validation.`, "error", 5000);
  }
}

// Upload buttons
document.getElementById("btn-library-upload")?.addEventListener("click", () => libraryFileInput?.click());
document.getElementById("btn-library-upload-top")?.addEventListener("click", () => libraryFileInput?.click());
libraryFileInput?.addEventListener("change", (e) => {
  handleFileUpload(e.target.files);
  e.target.value = ""; // allow re-uploading the same file
});

// New empty bot (builder)
function newEmptyBot() {
  const template =
`robot "New Bot" version "1.0"

meta {
  author: "You"
  class: "brawler"
}

on spawn {
}

on tick {
  let enemy = nearest_enemy()
  if enemy != null {
    attack enemy
  }
}
`;
  editorEl.value = template;
  currentEditorBotName = "New Bot";
  currentEditorUserBotId = null;
  currentPreset = "";
  presetButtons.forEach((btn) => btn.classList.remove("active"));
  document.querySelectorAll(".sidebar-user-bot").forEach((el) => el.classList.remove("active"));
  compiledPlayer = null;
  btnRun.disabled = true;
  clearErrors();
  updateHighlighting();
  updateLineNumbers();
  updateEditorFileName();
  updateArenaLoadedBotLabel();
  setView("builder");
  editorEl.focus();
}
document.getElementById("btn-library-new")?.addEventListener("click", newEmptyBot);
document.getElementById("btn-sidebar-new-bot")?.addEventListener("click", newEmptyBot);

// Drag & drop on library dropzone
if (libraryDropzoneEl) {
  ["dragenter", "dragover"].forEach((ev) => {
    libraryDropzoneEl.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      libraryDropzoneEl.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach((ev) => {
    libraryDropzoneEl.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      libraryDropzoneEl.classList.remove("dragover");
    });
  });
  libraryDropzoneEl.addEventListener("drop", (e) => {
    const files = e.dataTransfer?.files;
    if (files?.length) handleFileUpload(files);
  });
  libraryDropzoneEl.addEventListener("click", () => libraryFileInput?.click());
}

// Library filters
librarySearchEl?.addEventListener("input", renderLibrary);
libraryFilterClassEl?.addEventListener("change", renderLibrary);

// Arena sidebar "Run Match" button (duplicates btn-run but always available)
document.getElementById("btn-arena-run")?.addEventListener("click", () => {
  if (!compiledPlayer) {
    if (!doCompile()) {
      toast("Fix compile errors in Builder first.", "error");
      setView("builder");
      return;
    }
  }
  doRunMatch();
});

// React to any library change: refresh dependent UI
BotLibrary.subscribe(() => {
  renderSidebarUserBots();
  refreshOpponentSelect();
  if (currentView === "library") renderLibrary();
});

// ============================================================================
// Init
// ============================================================================

refreshOpponentSelect();
renderSidebarUserBots();
loadPreset("bruiser");
drawIdle();
updateEditorFileName();
updateArenaLoadedBotLabel();
logToConsole(`ArenaScript v${ENGINE_VERSION} — Ready`, "event");
logToConsole("Select a preset, upload a bot in My Bots, or write your own — then Compile & Run.", "info");

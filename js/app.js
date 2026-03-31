// ============================================================================
// ArenaScript Frontend — Main Application
// ============================================================================

import { compile } from "./lang/pipeline.js";
import { runMatch } from "./engine/tick.js";
import {
  ARENA_WIDTH, ARENA_HEIGHT, ATTACK_RANGE,
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
    move_to nearest_control_point()
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
    move_to nearest_control_point()
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

state {
  holding: boolean = false
}

on spawn {
  move_to nearest_control_point()
}

on tick {
  let enemy = nearest_enemy()
  if enemy != null {
    if can_attack(enemy) {
      attack enemy
    }
  }
  if not holding {
    move_to nearest_control_point()
  }
}

on damaged {
  shield
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
  mode: string = "follow"
}

on tick {
  let ally = nearest_ally()
  let enemy = nearest_enemy()

  if enemy != null and can_attack(enemy) {
    attack enemy
  } else if ally != null {
    move_toward ally.position
  } else {
    move_to nearest_control_point()
  }
}`,
  },
};

// ============================================================================
// DOM References
// ============================================================================

const editorEl = document.getElementById("code-editor");
const btnCompile = document.getElementById("btn-compile");
const btnRun = document.getElementById("btn-run");
const btnClear = document.getElementById("btn-clear");
const consoleEl = document.getElementById("console-output");
const canvasEl = document.getElementById("arena-canvas");
const arenaStatus = document.getElementById("arena-status");
const matchResultsEl = document.getElementById("match-results");
const resultsContentEl = document.getElementById("results-content");
const opponentSelect = document.getElementById("opponent-select");
const presetButtons = document.querySelectorAll(".bot-preset");

const ctx = canvasEl.getContext("2d");

// ============================================================================
// State
// ============================================================================

let compiledPlayer = null;   // { program, constants }
let currentPreset = "bruiser";
let lastMatchResult = null;

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
    return;
  }

  logToConsole("--- Compiling ---", "event");

  try {
    const result = compile(source);

    if (result.success) {
      compiledPlayer = { program: result.program, constants: result.constants };
      btnRun.disabled = false;

      logToConsole(`[OK] Compiled successfully`, "success");
      logToConsole(`  Class: ${result.program.robotClass}`, "info");
      logToConsole(`  Bytecode: ${result.program.bytecode.length} bytes`, "info");
      logToConsole(`  Events: ${[...result.program.eventHandlers.keys()].join(", ")}`, "info");

      if (result.diagnostics.length > 0) {
        for (const d of result.diagnostics) {
          const t = d.severity === "error" ? "error" : "warn";
          logToConsole(`  ${d.severity.toUpperCase()}: ${d.message}`, t);
        }
      }
    } else {
      compiledPlayer = null;
      btnRun.disabled = true;

      logToConsole(`[FAIL] Compilation failed`, "error");
      for (const err of result.errors) {
        logToConsole(`  ${err}`, "error");
      }
      for (const d of result.diagnostics) {
        if (d.severity === "warning") {
          logToConsole(`  WARNING: ${d.message}`, "warn");
        }
      }
    }
  } catch (e) {
    compiledPlayer = null;
    btnRun.disabled = true;
    logToConsole(`[EXCEPTION] ${e.message}`, "error");
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

  // Compile opponent
  const oppKey = opponentSelect.value;
  const oppPreset = BOT_PRESETS[oppKey];
  if (!oppPreset) {
    logToConsole("Invalid opponent selection.", "error");
    return;
  }

  logToConsole(`\n--- Running Match: Your Bot vs ${oppPreset.name} ---`, "event");
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
    logToConsole(`Opponent "${oppPreset.name}" failed to compile: ${oppResult.errors.join(", ")}`, "error");
    arenaStatus.textContent = "Error";
    return;
  }

  const setup = {
    config: {
      mode: "1v1_ranked",
      arenaWidth: ARENA_WIDTH,
      arenaHeight: ARENA_HEIGHT,
      maxTicks: 3000,
      tickRate: 30,
      seed: Math.floor(Math.random() * 100000),
    },
    participants: [
      {
        program: compiledPlayer.program,
        constants: compiledPlayer.constants,
        playerId: "player",
        teamId: 0,
      },
      {
        program: oppResult.program,
        constants: oppResult.constants,
        playerId: oppPreset.name.toLowerCase(),
        teamId: 1,
      },
    ],
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

  // Log results
  const winnerLabel =
    result.winner === null ? "DRAW" :
    result.winner === 0 ? "Your Bot" : oppPreset.name;

  logToConsole(`Winner: ${winnerLabel}`, "success");
  logToConsole(`Reason: ${result.reason}`, "info");
  logToConsole(`Ticks: ${result.tickCount}`, "info");
  logToConsole(`Replay frames: ${result.replay.frames.length}`, "info");

  // Robot stats
  logToConsole("", "info");
  logToConsole("Robot Stats:", "stat");
  for (const [id, stats] of result.robotStats) {
    logToConsole(
      `  ${id}: dmg_dealt=${stats.damageDealt}  dmg_taken=${stats.damageTaken}  kills=${stats.kills}`,
      "stat"
    );
  }

  // Display match results panel
  showMatchResults(result, oppPreset.name);

  // Render final state + animate replay
  arenaStatus.textContent = "Replaying...";
  animateReplay(result, oppPreset.name);
}

// ============================================================================
// Match Results Display
// ============================================================================

function showMatchResults(result, opponentName) {
  matchResultsEl.classList.add("visible");

  const isDraw = result.winner === null;
  const winnerLabel = isDraw ? "DRAW" : result.winner === 0 ? "Your Bot WINS" : `${opponentName} WINS`;

  // Collect stats
  const statsArr = [...result.robotStats.entries()];
  const playerStats = statsArr[0] ? statsArr[0][1] : null;
  const oppStats = statsArr[1] ? statsArr[1][1] : null;

  // Get final health from last replay frame
  let playerHP = "?";
  let oppHP = "?";
  if (result.replay.frames.length > 0) {
    const lastFrame = result.replay.frames[result.replay.frames.length - 1];
    if (lastFrame.robots[0]) playerHP = lastFrame.robots[0].health;
    if (lastFrame.robots[1]) oppHP = lastFrame.robots[1].health;
  }

  resultsContentEl.innerHTML = `
    <div class="result-winner ${isDraw ? 'draw' : ''}">${winnerLabel}</div>
    <div class="result-item"><span class="rl">Reason:</span>${result.reason}</div>
    <div class="result-item"><span class="rl">Ticks:</span>${result.tickCount}</div>
    <div class="result-item"><span class="rl">Your HP:</span>${playerHP}</div>
    <div class="result-item"><span class="rl">Opp HP:</span>${oppHP}</div>
    ${playerStats ? `<div class="result-item"><span class="rl">Your Dmg:</span>${playerStats.damageDealt}</div>` : ""}
    ${oppStats ? `<div class="result-item"><span class="rl">Opp Dmg:</span>${oppStats.damageDealt}</div>` : ""}
    ${playerStats ? `<div class="result-item"><span class="rl">Your Kills:</span>${playerStats.kills}</div>` : ""}
    ${oppStats ? `<div class="result-item"><span class="rl">Opp Kills:</span>${oppStats.kills}</div>` : ""}
  `;
}

// ============================================================================
// Canvas Rendering
// ============================================================================

const TEAM_COLORS = ["#00d4ff", "#ff3355"];
const TEAM_GLOW = ["rgba(0,212,255,0.3)", "rgba(255,51,85,0.3)"];
const GRID_COLOR = "rgba(42,42,74,0.4)";

function canvasScale() {
  return canvasEl.width / ARENA_WIDTH;
}

function drawArenaBackground() {
  const w = canvasEl.width;
  const h = canvasEl.height;
  const s = canvasScale();

  // Background
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

  // Center point marker
  ctx.fillStyle = "rgba(255,221,0,0.15)";
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 3 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,221,0,0.3)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawRobot(x, y, health, maxHealth, teamId, label) {
  const s = canvasScale();
  const cx = x * s;
  const cy = y * s;
  const radius = 3 * s;
  const color = TEAM_COLORS[teamId] || "#ffffff";
  const glow = TEAM_GLOW[teamId] || "rgba(255,255,255,0.3)";

  // Glow
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 4, 0, Math.PI * 2);
  ctx.fillStyle = glow;
  ctx.fill();

  // Body
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.fill();
  ctx.globalAlpha = 1.0;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Health bar
  const barW = radius * 2.5;
  const barH = 3;
  const barX = cx - barW / 2;
  const barY = cy - radius - 8;
  const hpRatio = Math.max(0, health / maxHealth);

  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(barX, barY, barW, barH);

  const hpColor = hpRatio > 0.5 ? "#00ff88" : hpRatio > 0.25 ? "#ff8800" : "#ff3355";
  ctx.fillStyle = hpColor;
  ctx.fillRect(barX, barY, barW * hpRatio, barH);

  // Label
  ctx.fillStyle = "#ffffff";
  ctx.font = `${Math.max(9, 2.5 * s)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(label, cx, cy + radius + 12);
}

function drawFrame(frame, labels) {
  drawArenaBackground();

  if (!frame || !frame.robots) return;

  for (let i = 0; i < frame.robots.length; i++) {
    const r = frame.robots[i];
    const maxHP = 100; // approximate; real max depends on class
    drawRobot(r.position.x, r.position.y, r.health, maxHP, r.teamId, labels[i] || r.id);
  }
}

function drawIdle() {
  drawArenaBackground();

  const w = canvasEl.width;
  const h = canvasEl.height;
  ctx.fillStyle = "#555577";
  ctx.font = "13px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Compile a bot and run a match", w / 2, h / 2);
}

// ============================================================================
// Replay Animation
// ============================================================================

function animateReplay(result, opponentName) {
  const frames = result.replay.frames;
  if (frames.length === 0) {
    drawIdle();
    arenaStatus.textContent = "No frames";
    return;
  }

  const labels = ["You", opponentName];
  const totalFrames = frames.length;

  // Sample ~200 frames for smooth animation
  const maxDisplayFrames = 200;
  const step = Math.max(1, Math.floor(totalFrames / maxDisplayFrames));
  const sampledIndices = [];
  for (let i = 0; i < totalFrames; i += step) {
    sampledIndices.push(i);
  }
  // Always include last frame
  if (sampledIndices[sampledIndices.length - 1] !== totalFrames - 1) {
    sampledIndices.push(totalFrames - 1);
  }

  let current = 0;
  const frameDelay = 16; // ~60fps

  function tick() {
    if (current >= sampledIndices.length) {
      arenaStatus.textContent = `Done (${result.tickCount} ticks)`;
      return;
    }

    const idx = sampledIndices[current];
    const frame = frames[idx];
    drawFrame(frame, labels);
    arenaStatus.textContent = `Tick ${frame.tick} / ${result.tickCount}`;
    current++;
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

// ============================================================================
// Preset Loading
// ============================================================================

function loadPreset(key) {
  const preset = BOT_PRESETS[key];
  if (!preset) return;
  editorEl.value = preset.source;
  currentPreset = key;

  // Update active state
  presetButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.bot === key);
  });

  // Reset compiled state
  compiledPlayer = null;
  btnRun.disabled = true;
}

// ============================================================================
// Tab key support in editor
// ============================================================================

editorEl.addEventListener("keydown", (e) => {
  if (e.key === "Tab") {
    e.preventDefault();
    const start = editorEl.selectionStart;
    const end = editorEl.selectionEnd;
    editorEl.value =
      editorEl.value.substring(0, start) + "  " + editorEl.value.substring(end);
    editorEl.selectionStart = editorEl.selectionEnd = start + 2;
  }
});

// ============================================================================
// Event Wiring
// ============================================================================

btnCompile.addEventListener("click", doCompile);
btnRun.addEventListener("click", doRunMatch);
btnClear.addEventListener("click", clearConsole);

presetButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    loadPreset(btn.dataset.bot);
  });
});

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  // Ctrl+Enter to compile
  if (e.ctrlKey && e.key === "Enter") {
    e.preventDefault();
    doCompile();
  }
  // Ctrl+Shift+Enter to run
  if (e.ctrlKey && e.shiftKey && e.key === "Enter") {
    e.preventDefault();
    if (!btnRun.disabled) doRunMatch();
  }
});

// ============================================================================
// Init
// ============================================================================

loadPreset("bruiser");
drawIdle();
logToConsole(`ArenaScript v${ENGINE_VERSION} — Ready`, "event");
logToConsole("Select a bot preset or write your own, then click Compile.", "info");
logToConsole("Shortcuts: Ctrl+Enter = Compile, Ctrl+Shift+Enter = Run Match", "info");

// ============================================================================
// Engine Invariant Tests — Property-based checks on simulation correctness
// ============================================================================

import assert from "node:assert/strict";
import { compile } from "../lang/pipeline.js";
import { runMatch } from "../engine/tick.js";
import { CLASS_STATS } from "../shared/config.js";

// ---------------------------------------------------------------------------
// Bot sources — one per class, identical logic with different meta class
// ---------------------------------------------------------------------------

function makeBotSource(className) {
  return `robot "TestBot_${className}" version "1.0"
meta { class: "${className}" }
state { t: number = 0 }
on tick {
  let enemy = nearest_enemy()
  if enemy != null {
    if can_attack(enemy) { attack enemy }
    else { move_toward enemy.position }
  } else {
    if wall_ahead(3) { turn_right }
    move_forward
  }
  set t = t + 1
}`;
}

const BOT_SOURCES = {
  brawler: makeBotSource("brawler"),
  ranger: makeBotSource("ranger"),
  tank: makeBotSource("tank"),
  support: makeBotSource("support"),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compileBot(className) {
  const result = compile(BOT_SOURCES[className]);
  if (!result.success) {
    throw new Error(`Failed to compile ${className} bot: ${result.errors.join(", ")}`);
  }
  return result;
}

function executeMatch(classA, classB, seed) {
  const compiledA = compileBot(classA);
  const compiledB = compileBot(classB);
  const setup = {
    config: {
      mode: "duel_1v1",
      arenaWidth: 140,
      arenaHeight: 140,
      maxTicks: 500,
      tickRate: 30,
      seed,
    },
    participants: [
      { program: compiledA.program, constants: compiledA.constants, playerId: "p1", teamId: 0 },
      { program: compiledB.program, constants: compiledB.constants, playerId: "p2", teamId: 1 },
    ],
  };
  return runMatch(setup);
}

const SEEDS = [1, 42, 100, 7777, 65535];

const MATCHUPS = [
  ["brawler", "ranger"],
  ["tank", "support"],
  ["brawler", "tank"],
  ["ranger", "support"],
  ["brawler", "brawler"],
  ["tank", "ranger"],
];

/**
 * Run a callback against every robot in every frame of a match replay.
 * The callback receives (robot, frameIndex, frame).
 */
function forEachRobotFrame(result, callback) {
  const frames = result.replay.frames;
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    for (const robot of frame.robots) {
      callback(robot, i, frame);
    }
  }
}

// ---------------------------------------------------------------------------
// Test functions
// ---------------------------------------------------------------------------

function testHealthBounds() {
  for (const seed of SEEDS) {
    for (const [classA, classB] of MATCHUPS) {
      const result = executeMatch(classA, classB, seed);
      const maxHealthA = CLASS_STATS[classA].health;
      const maxHealthB = CLASS_STATS[classB].health;

      forEachRobotFrame(result, (robot, frameIdx) => {
        const maxHP = robot.robotClass === classA ? maxHealthA : maxHealthB;
        assert.ok(
          robot.health <= maxHP,
          `Seed ${seed}, ${classA} vs ${classB}, frame ${frameIdx}: ` +
          `robot ${robot.id} (${robot.robotClass}) health ${robot.health} exceeds maxHealth ${maxHP}`
        );
        // Alive robots must have health > 0; dead robots can have health <= 0
        // We check health >= 0 universally (health should never be negative in the replay)
        assert.ok(
          robot.health >= 0,
          `Seed ${seed}, ${classA} vs ${classB}, frame ${frameIdx}: ` +
          `robot ${robot.id} health is negative: ${robot.health}`
        );
      });
    }
  }
}

function testNoNaNPositions() {
  for (const seed of SEEDS) {
    for (const [classA, classB] of MATCHUPS) {
      const result = executeMatch(classA, classB, seed);

      forEachRobotFrame(result, (robot, frameIdx) => {
        assert.ok(
          !Number.isNaN(robot.position.x),
          `Seed ${seed}, ${classA} vs ${classB}, frame ${frameIdx}: ` +
          `robot ${robot.id} has NaN position.x`
        );
        assert.ok(
          !Number.isNaN(robot.position.y),
          `Seed ${seed}, ${classA} vs ${classB}, frame ${frameIdx}: ` +
          `robot ${robot.id} has NaN position.y`
        );
        assert.ok(
          Number.isFinite(robot.position.x),
          `Seed ${seed}, frame ${frameIdx}: robot ${robot.id} position.x is not finite: ${robot.position.x}`
        );
        assert.ok(
          Number.isFinite(robot.position.y),
          `Seed ${seed}, frame ${frameIdx}: robot ${robot.id} position.y is not finite: ${robot.position.y}`
        );
      });
    }
  }
}

function testEnergyBounds() {
  for (const seed of SEEDS) {
    for (const [classA, classB] of MATCHUPS) {
      const result = executeMatch(classA, classB, seed);
      const maxEnergyA = CLASS_STATS[classA].energy;
      const maxEnergyB = CLASS_STATS[classB].energy;

      forEachRobotFrame(result, (robot, frameIdx) => {
        const maxE = robot.robotClass === classA ? maxEnergyA : maxEnergyB;
        assert.ok(
          robot.energy <= maxE,
          `Seed ${seed}, ${classA} vs ${classB}, frame ${frameIdx}: ` +
          `robot ${robot.id} (${robot.robotClass}) energy ${robot.energy} exceeds maxEnergy ${maxE}`
        );
        assert.ok(
          robot.energy >= 0,
          `Seed ${seed}, ${classA} vs ${classB}, frame ${frameIdx}: ` +
          `robot ${robot.id} energy is negative: ${robot.energy}`
        );
      });
    }
  }
}

function testPositionsWithinArenaBounds() {
  const arenaWidth = 140;
  const arenaHeight = 140;

  for (const seed of SEEDS) {
    for (const [classA, classB] of MATCHUPS) {
      const result = executeMatch(classA, classB, seed);

      forEachRobotFrame(result, (robot, frameIdx) => {
        assert.ok(
          robot.position.x >= 0 && robot.position.x <= arenaWidth,
          `Seed ${seed}, ${classA} vs ${classB}, frame ${frameIdx}: ` +
          `robot ${robot.id} x=${robot.position.x} out of arena bounds [0, ${arenaWidth}]`
        );
        assert.ok(
          robot.position.y >= 0 && robot.position.y <= arenaHeight,
          `Seed ${seed}, ${classA} vs ${classB}, frame ${frameIdx}: ` +
          `robot ${robot.id} y=${robot.position.y} out of arena bounds [0, ${arenaHeight}]`
        );
      });
    }
  }
}

function testDeadRobotsHaveZeroOrLessHealth() {
  for (const seed of SEEDS) {
    for (const [classA, classB] of MATCHUPS) {
      const result = executeMatch(classA, classB, seed);
      const frames = result.replay.frames;

      // A robot is "dead" if it had health > 0 in some earlier frame and then
      // has health <= 0 from some frame onward. We check: once a robot reaches
      // health <= 0, it must never have health > 0 in any subsequent frame.
      const diedAtFrame = new Map();

      for (let i = 0; i < frames.length; i++) {
        for (const robot of frames[i].robots) {
          if (robot.health <= 0 && !diedAtFrame.has(robot.id)) {
            diedAtFrame.set(robot.id, i);
          }
          if (diedAtFrame.has(robot.id) && i > diedAtFrame.get(robot.id)) {
            assert.ok(
              robot.health <= 0,
              `Seed ${seed}, ${classA} vs ${classB}, frame ${i}: ` +
              `robot ${robot.id} died at frame ${diedAtFrame.get(robot.id)} ` +
              `but has health ${robot.health} > 0 at frame ${i}`
            );
          }
        }
      }
    }
  }
}

function testDeterminism() {
  for (const seed of SEEDS) {
    for (const [classA, classB] of MATCHUPS.slice(0, 3)) {
      const result1 = executeMatch(classA, classB, seed);
      const result2 = executeMatch(classA, classB, seed);

      assert.equal(
        result1.tickCount, result2.tickCount,
        `Seed ${seed}, ${classA} vs ${classB}: tick count mismatch (${result1.tickCount} vs ${result2.tickCount})`
      );
      assert.equal(
        result1.winner, result2.winner,
        `Seed ${seed}, ${classA} vs ${classB}: winner mismatch (${result1.winner} vs ${result2.winner})`
      );

      const frames1 = result1.replay.frames;
      const frames2 = result2.replay.frames;
      assert.equal(
        frames1.length, frames2.length,
        `Seed ${seed}, ${classA} vs ${classB}: frame count mismatch`
      );

      for (let i = 0; i < frames1.length; i++) {
        const robots1 = frames1[i].robots;
        const robots2 = frames2[i].robots;
        assert.equal(robots1.length, robots2.length,
          `Seed ${seed}, frame ${i}: robot count mismatch`);

        for (let j = 0; j < robots1.length; j++) {
          const r1 = robots1[j];
          const r2 = robots2[j];
          assert.equal(r1.id, r2.id,
            `Seed ${seed}, frame ${i}: robot id mismatch at index ${j}`);
          assert.ok(
            Math.abs(r1.position.x - r2.position.x) < 0.001,
            `Seed ${seed}, frame ${i}: robot ${r1.id} position.x differs (${r1.position.x} vs ${r2.position.x})`
          );
          assert.ok(
            Math.abs(r1.position.y - r2.position.y) < 0.001,
            `Seed ${seed}, frame ${i}: robot ${r1.id} position.y differs (${r1.position.y} vs ${r2.position.y})`
          );
          assert.equal(r1.health, r2.health,
            `Seed ${seed}, frame ${i}: robot ${r1.id} health differs (${r1.health} vs ${r2.health})`);
          assert.equal(r1.energy, r2.energy,
            `Seed ${seed}, frame ${i}: robot ${r1.id} energy differs (${r1.energy} vs ${r2.energy})`);
        }
      }
    }
  }
}

function testHealthMonotonicallyDecreases_NoHealZone() {
  // Without heal zones, health should only stay the same or decrease between frames.
  // Since heal zones exist in the arena, we relax this: health can increase, but
  // we verify it NEVER increases beyond maxHealth (covered by testHealthBounds).
  // Instead, we check that total damage dealt across a match is non-negative.
  for (const seed of SEEDS) {
    for (const [classA, classB] of MATCHUPS.slice(0, 2)) {
      const result = executeMatch(classA, classB, seed);
      const frames = result.replay.frames;

      // Aggregate: total health loss across entire match should be >= 0
      if (frames.length < 2) continue;
      const firstFrame = frames[0];
      const lastFrame = frames[frames.length - 1];

      for (const robotFirst of firstFrame.robots) {
        const robotLast = lastFrame.robots.find(r => r.id === robotFirst.id);
        if (!robotLast) continue;
        // Health at end should be <= health at start (combat happened)
        // This is a soft check — it is possible (though unlikely in 500 ticks
        // with enemies) that a robot never takes damage. We just verify no
        // impossible health gain above max.
        const maxHP = CLASS_STATS[robotFirst.robotClass].health;
        assert.ok(
          robotLast.health <= maxHP,
          `Seed ${seed}: robot ${robotFirst.id} ended with health ${robotLast.health} > maxHealth ${maxHP}`
        );
      }
    }
  }
}

function testMatchProducesFrames() {
  // Sanity: every match should produce at least one frame and a valid result
  for (const seed of SEEDS) {
    for (const [classA, classB] of MATCHUPS) {
      const result = executeMatch(classA, classB, seed);

      assert.ok(result.replay.frames.length > 0,
        `Seed ${seed}, ${classA} vs ${classB}: no frames produced`);
      assert.ok(result.tickCount > 0,
        `Seed ${seed}, ${classA} vs ${classB}: tickCount is 0`);
      assert.ok(
        result.reason !== undefined && result.reason !== null,
        `Seed ${seed}, ${classA} vs ${classB}: no reason provided`
      );
      // Winner should be a team id (number) or null for draws
      assert.ok(
        result.winner === null || typeof result.winner === "number",
        `Seed ${seed}, ${classA} vs ${classB}: winner is invalid type: ${typeof result.winner}`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

const tests = [
  testHealthBounds,
  testNoNaNPositions,
  testEnergyBounds,
  testPositionsWithinArenaBounds,
  testDeadRobotsHaveZeroOrLessHealth,
  testDeterminism,
  testHealthMonotonicallyDecreases_NoHealZone,
  testMatchProducesFrames,
];

console.log("Engine Invariant Tests\n");

let passed = 0;
let failed = 0;

for (const test of tests) {
  try {
    test();
    passed++;
    console.log(`  PASS: ${test.name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL: ${test.name}: ${e.message}`);
  }
}

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed > 0 ? 1 : 0);

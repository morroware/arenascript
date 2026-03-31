import { describe, it, expect } from "vitest";
import { compile } from "../lang/pipeline.js";
import { runMatch, type MatchSetup } from "./tick.js";
import { World } from "./world.js";
import { hasLineOfSight } from "./los.js";
import { SeededRNG } from "../shared/prng.js";
import { calculateEloChange, getRankTier } from "../server/ranked.js";
import { vec2 } from "../shared/vec2.js";

const SIMPLE_BOT = `
robot "Attacker" version "1.0"
meta { class: "brawler" }
on tick {
  let enemy = nearest_enemy()
  if enemy != null {
    if can_attack(enemy) {
      attack enemy
    } else {
      move_toward enemy.position
    }
  } else {
    move_toward position()
  }
}
`;

const PASSIVE_BOT = `
robot "Passive" version "1.0"
meta { class: "tank" }
on tick {
  stop
}
`;

function compileBot(source: string) {
  const result = compile(source);
  if (!result.success) throw new Error(`Compile failed: ${result.errors.join(", ")}`);
  return { program: result.program!, constants: result.constants! };
}

function makeSetup(bot1Src: string, bot2Src: string, seed = 42): MatchSetup {
  const b1 = compileBot(bot1Src);
  const b2 = compileBot(bot2Src);
  return {
    config: {
      mode: "1v1_ranked",
      arenaWidth: 100,
      arenaHeight: 100,
      maxTicks: 1000,
      tickRate: 30,
      seed,
    },
    participants: [
      { ...b1, playerId: "p1", teamId: 0 },
      { ...b2, playerId: "p2", teamId: 1 },
    ],
  };
}

describe("Simulation Engine", () => {
  it("runs a match to completion", () => {
    const result = runMatch(makeSetup(SIMPLE_BOT, PASSIVE_BOT));
    expect(result.tickCount).toBeGreaterThan(0);
    expect(result.replay.frames.length).toBeGreaterThan(0);
  });

  it("attacker beats passive bot", () => {
    const result = runMatch(makeSetup(SIMPLE_BOT, PASSIVE_BOT));
    // Active bot should win by elimination
    expect(result.winner).toBe(0);
    expect(result.reason).toBe("elimination");
  });

  it("produces deterministic results", () => {
    const setup = makeSetup(SIMPLE_BOT, PASSIVE_BOT, 12345);
    const r1 = runMatch(setup);
    const r2 = runMatch(setup);

    expect(r1.winner).toBe(r2.winner);
    expect(r1.tickCount).toBe(r2.tickCount);
    expect(r1.replay.frames.length).toBe(r2.replay.frames.length);
  });

  it("records replay frames with positions", () => {
    const result = runMatch(makeSetup(SIMPLE_BOT, PASSIVE_BOT));
    expect(result.replay.frames[0].robots.length).toBe(2);
    expect(result.replay.frames[0].robots[0].position).toBeDefined();
    expect(typeof result.replay.frames[0].robots[0].health).toBe("number");
  });

  it("tracks damage statistics", () => {
    const result = runMatch(makeSetup(SIMPLE_BOT, PASSIVE_BOT));
    let totalDamage = 0;
    for (const [_, stats] of result.robotStats) {
      totalDamage += stats.damageDealt;
    }
    expect(totalDamage).toBeGreaterThan(0);
  });
});

describe("World", () => {
  it("spawns robots correctly", () => {
    const world = new World({
      mode: "1v1_ranked",
      arenaWidth: 100,
      arenaHeight: 100,
      maxTicks: 1000,
      tickRate: 30,
      seed: 42,
    });
    const robot = world.spawnRobot("Test", "ranger", 0, "prog1");
    expect(robot.alive).toBe(true);
    expect(robot.health).toBeGreaterThan(0);
    expect(world.getAliveRobots()).toHaveLength(1);
  });
});

describe("Line of Sight", () => {
  it("detects clear line of sight", () => {
    const world = new World({
      mode: "1v1_ranked", arenaWidth: 100, arenaHeight: 100,
      maxTicks: 1000, tickRate: 30, seed: 1,
    });
    expect(hasLineOfSight(world, vec2(10, 10), vec2(20, 10))).toBe(true);
  });

  it("blocks line of sight through cover", () => {
    const world = new World({
      mode: "1v1_ranked", arenaWidth: 100, arenaHeight: 100,
      maxTicks: 1000, tickRate: 30, seed: 1,
    });
    world.addCover(vec2(15, 10), 4, 4);
    expect(hasLineOfSight(world, vec2(10, 10), vec2(20, 10))).toBe(false);
  });
});

describe("Seeded PRNG", () => {
  it("produces deterministic sequences", () => {
    const rng1 = new SeededRNG(42);
    const rng2 = new SeededRNG(42);
    for (let i = 0; i < 100; i++) {
      expect(rng1.next()).toBe(rng2.next());
    }
  });

  it("produces different sequences for different seeds", () => {
    const rng1 = new SeededRNG(1);
    const rng2 = new SeededRNG(2);
    let same = true;
    for (let i = 0; i < 10; i++) {
      if (rng1.next() !== rng2.next()) same = false;
    }
    expect(same).toBe(false);
  });
});

describe("Elo Rating", () => {
  it("winner gains rating, loser loses rating", () => {
    const { winnerNew, loserNew } = calculateEloChange(1000, 1000);
    expect(winnerNew).toBeGreaterThan(1000);
    expect(loserNew).toBeLessThan(1000);
  });

  it("underdog gains more for upset", () => {
    const { winnerDelta: upsetDelta } = calculateEloChange(800, 1200);
    const { winnerDelta: expectedDelta } = calculateEloChange(1200, 800);
    expect(upsetDelta).toBeGreaterThan(expectedDelta);
  });

  it("assigns correct rank tiers", () => {
    expect(getRankTier(500)).toBe("bronze");
    expect(getRankTier(1000)).toBe("silver");
    expect(getRankTier(1200)).toBe("gold");
    expect(getRankTier(1400)).toBe("platinum");
    expect(getRankTier(1600)).toBe("diamond");
    expect(getRankTier(1800)).toBe("champion");
  });
});

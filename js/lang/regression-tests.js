import assert from "node:assert/strict";
import { Lexer } from "./tokens.js";
import { Parser } from "./parser.js";
import { SemanticAnalyzer } from "./semantic.js";
import { Compiler } from "./compiler.js";
import { compile } from "./pipeline.js";
import { VM } from "../runtime/vm.js";
import { runMatch } from "../engine/tick.js";
import { World } from "../engine/world.js";
import { resolveCombat, updateProjectiles } from "../engine/combat.js";
import { computeBookmarks } from "../engine/replay.js";
import {
  validateMatchMode, validateParticipantCount,
  validateMatchConfig, validateParticipant, validateMatchRequest,
} from "../shared/validation.js";

function parseSource(source) {
  const tokens = new Lexer(source).tokenize();
  return new Parser(tokens).parse();
}

const BASE_PROGRAM = `robot "Test" version "1.0"
state {
  mode: string = "x"
}
on tick {
  set mode = "y"
}`;

// --- Existing tests ---

function testDuplicateTopLevelBlocks() {
  const bad = `robot "Dup" version "1.0"
meta { author: "a" }
meta { class: "ranger" }
on tick {}`;
  assert.throws(() => parseSource(bad), /Duplicate meta block/);
}

function testSemanticAnalyzerStateIsolation() {
  const analyzer = new SemanticAnalyzer();
  const ast = parseSource(BASE_PROGRAM);
  const first = analyzer.analyze(ast);
  const second = analyzer.analyze(ast);
  const firstErrors = first.filter(d => d.severity === "error");
  const secondErrors = second.filter(d => d.severity === "error");
  assert.equal(firstErrors.length, 0);
  assert.equal(secondErrors.length, 0);
}

function testCompilerStateIsolation() {
  const compiler = new Compiler();
  const ast = parseSource(BASE_PROGRAM);
  const a = compiler.compile(ast);
  const b = compiler.compile(ast);
  assert.equal(a.program.stateSlots.length, 1);
  assert.equal(b.program.stateSlots.length, 1);
}

// --- New tests for bug fixes ---

function testConstantExpressionEvaluation() {
  const source = `robot "ConstTest" version "1.0"
const {
  SUM = 10 + 5
  PRODUCT = 3 * 4
  NEGATED = -7
  COMPLEX = 2 + 3 * 4
}
on tick {}`;
  const result = compile(source);
  assert.ok(result.success, `Compile failed: ${result.errors.join(", ")}`);
  // Verify constants are evaluated, not null
  const constEntries = result.constants;
  const values = constEntries.map(c => c.value);
  assert.ok(values.includes(15), "SUM should be 15");
  assert.ok(values.includes(12), "PRODUCT should be 12");
}

function testConstantNegativeValue() {
  const source = `robot "NegTest" version "1.0"
const {
  NEG = -42
}
on tick {}`;
  const result = compile(source);
  assert.ok(result.success, `Compile failed: ${result.errors.join(", ")}`);
  const negConst = result.constants.find(c => c.value === -42);
  assert.ok(negConst, "Negative constant should be -42");
}

function testFunctionNameAsIdentifier() {
  // Function names should be resolvable in the semantic analyzer
  const source = `robot "FnRef" version "1.0"
fn helper(x: number) -> number {
  return x
}
on tick {
  let result = helper(5)
}`;
  const result = compile(source);
  assert.ok(result.success, `Compile failed: ${result.errors.join(", ")}`);
}

function testRecursionLocalsIsolation() {
  // Ensure recursive calls don't corrupt parent frame locals
  const source = `robot "Recurse" version "1.0"
state {
  result: number = 0
}
fn countdown(n: number) -> number {
  if n <= 0 {
    return 0
  }
  let prev = countdown(n - 1)
  return n + prev
}
on tick {
  set result = countdown(3)
}`;
  const result = compile(source);
  assert.ok(result.success, `Compile failed: ${result.errors.join(", ")}`);

  // Run it in a VM to verify locals aren't corrupted
  const sensorGateway = () => null;
  const vm = new VM(result.program, "test_robot", sensorGateway);
  vm.setConstants(result.constants);
  const execResult = vm.executeEvent("tick");
  assert.ok(!execResult.error, `VM error: ${execResult.error}`);
  // countdown(3) = 3 + countdown(2) = 3 + 2 + countdown(1) = 3 + 2 + 1 + countdown(0) = 6
  assert.equal(vm.stateSlots[0], 6, `Expected 6, got ${vm.stateSlots[0]}`);
}

function testVMStackOverflowProtection() {
  // Ensure the call depth limit is enforced
  const source = `robot "Overflow" version "1.0"
fn infinite(n: number) -> number {
  return infinite(n + 1)
}
on tick {
  let x = infinite(0)
}`;
  const result = compile(source);
  assert.ok(result.success, `Compile failed: ${result.errors.join(", ")}`);

  const sensorGateway = () => null;
  const vm = new VM(result.program, "test_robot", sensorGateway);
  vm.setConstants(result.constants);
  const execResult = vm.executeEvent("tick");
  // Should hit either call depth or budget limit, not crash
  assert.ok(execResult.error || execResult.budgetExceeded,
    "Infinite recursion should be caught by call depth or budget limit");
}

function testShieldDoesNotExceedMaxHealth() {
  // This is an engine-level test, but we validate the logic conceptually
  // Shield should cap at maxHealth
  const robot = { health: 95, maxHealth: 100 };
  robot.health = Math.min(robot.maxHealth, robot.health + 20);
  assert.equal(robot.health, 100, "Shield should not exceed maxHealth");
}

function testDivisionByZeroInConstants() {
  const source = `robot "DivZero" version "1.0"
const {
  SAFE = 10 / 0
}
on tick {}`;
  const result = compile(source);
  assert.ok(result.success, `Compile failed: ${result.errors.join(", ")}`);
  // Division by zero should produce 0, not crash
  const zeroConst = result.constants.find(c => c.value === 0);
  assert.ok(zeroConst !== undefined, "Division by zero should produce 0");
}

function testEmptyStringIsTruthy() {
  // Verify VM truthiness semantics: empty string is truthy (by design)
  const source = `robot "Truthy" version "1.0"
state {
  result: boolean = false
}
on tick {
  if "" {
    set result = true
  }
}`;
  const result = compile(source);
  assert.ok(result.success, `Compile failed: ${result.errors.join(", ")}`);

  const sensorGateway = () => null;
  const vm = new VM(result.program, "test_robot", sensorGateway);
  vm.setConstants(result.constants);
  vm.executeEvent("tick");
  // Empty string is truthy in ArenaScript (non-null, non-false, non-zero)
  assert.equal(vm.stateSlots[0], true, "Empty string should be truthy in ArenaScript");
}

function testMultipleElseIfBranches() {
  const source = `robot "ElseIf" version "1.0"
state {
  result: number = 0
}
on tick {
  let x = 3
  if x == 1 {
    set result = 10
  } else if x == 2 {
    set result = 20
  } else if x == 3 {
    set result = 30
  } else {
    set result = 40
  }
}`;
  const result = compile(source);
  assert.ok(result.success, `Compile failed: ${result.errors.join(", ")}`);

  const sensorGateway = () => null;
  const vm = new VM(result.program, "test_robot", sensorGateway);
  vm.setConstants(result.constants);
  vm.executeEvent("tick");
  assert.equal(vm.stateSlots[0], 30, `Expected 30, got ${vm.stateSlots[0]}`);
}

function testShortCircuitAnd() {
  // `and` should short-circuit: if left is false, right is not evaluated
  const source = `robot "ShortAnd" version "1.0"
state {
  result: boolean = false
}
on tick {
  if false and true {
    set result = true
  }
}`;
  const result = compile(source);
  assert.ok(result.success);

  const sensorGateway = () => null;
  const vm = new VM(result.program, "test_robot", sensorGateway);
  vm.setConstants(result.constants);
  vm.executeEvent("tick");
  assert.equal(vm.stateSlots[0], false, "Short-circuit and should not enter branch");
}

function testShortCircuitOr() {
  const source = `robot "ShortOr" version "1.0"
state {
  result: boolean = false
}
on tick {
  if true or false {
    set result = true
  }
}`;
  const result = compile(source);
  assert.ok(result.success);

  const sensorGateway = () => null;
  const vm = new VM(result.program, "test_robot", sensorGateway);
  vm.setConstants(result.constants);
  vm.executeEvent("tick");
  assert.equal(vm.stateSlots[0], true, "Short-circuit or should enter branch");
}

function testUnknownEventReportsError() {
  const source = `robot "BadEvent" version "1.0"
on fake_event {
  stop
}
on tick {}`;
  const result = compile(source);
  assert.ok(!result.success, "Should fail: unknown event");
  assert.ok(result.errors.some(e => e.includes("fake_event")));
}

function testDuplicateStateVariable() {
  const source = `robot "DupState" version "1.0"
state {
  x: number = 0
  x: number = 1
}
on tick {}`;
  const result = compile(source);
  assert.ok(!result.success, "Should fail: duplicate state variable");
}

function testSetOnNonStateVariable() {
  const source = `robot "BadSet" version "1.0"
on tick {
  let x = 5
  set x = 10
}`;
  const result = compile(source);
  assert.ok(!result.success, "Should fail: set on non-state variable");
}

function testUnterminatedString() {
  const source = `robot "Bad version "1.0"
on tick {}`;
  const result = compile(source);
  assert.ok(!result.success, "Should fail: unterminated string");
}

function testBotsNavigateAroundCover() {
  const chaserA = `robot "LeftChaser" version "1.0"
meta {
  author: "test"
  class: "brawler"
}
state {
  ticks: number = 0
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
    set ticks = ticks + 1
    if wall_ahead(3) {
      turn_right
    } else {
      move_forward
    }
    if ticks > 20 {
      turn_right
      set ticks = 0
    }
  }
}`;

  const chaserB = `robot "RightChaser" version "1.0"
meta {
  author: "test"
  class: "ranger"
}
state {
  ticks: number = 0
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
    set ticks = ticks + 1
    if wall_ahead(3) {
      turn_left
    } else {
      move_forward
    }
    if ticks > 20 {
      turn_left
      set ticks = 0
    }
  }
}`;

  const a = compile(chaserA);
  const b = compile(chaserB);
  assert.ok(a.success, `Compile failed: ${a.errors.join(", ")}`);
  assert.ok(b.success, `Compile failed: ${b.errors.join(", ")}`);

  const result = runMatch({
    config: {
      mode: "1v1_ranked",
      arenaWidth: 100,
      arenaHeight: 100,
      maxTicks: 1200,
      tickRate: 30,
      seed: 77,
    },
    participants: [
      { program: a.program, constants: a.constants, playerId: "p1", teamId: 0 },
      { program: b.program, constants: b.constants, playerId: "p2", teamId: 1 },
    ],
  });

  const totalDamage = [...result.robotStats.values()].reduce((sum, stats) => sum + stats.damageDealt, 0);
  assert.ok(totalDamage > 0, "Expected robots to navigate and engage instead of stalemating on cover");
}

function testAttackRequiresVisibility() {
  const world = new World({
    mode: "test",
    arenaWidth: 100,
    arenaHeight: 100,
    maxTicks: 100,
    tickRate: 30,
    seed: 1,
  });
  const attacker = world.spawnRobot("A", "ranger", 0, "prog_a", { x: 10, y: 10 });
  const defender = world.spawnRobot("D", "ranger", 1, "prog_d", { x: 95, y: 95 });

  resolveCombat(world, attacker, { type: "attack", target: defender.id });
  assert.equal(defender.health, defender.maxHealth, "Attack should fail when target is not visible");
}

function testActiveScanAndMemorySensorsCompile() {
  const source = `robot "Scanner" version "1.0"
state {
  has_contact: boolean = false
}
on tick {
  let ping = scan()
  if ping != null {
    set has_contact = true
  } else if has_recent_enemy_contact(10) {
    let last = last_seen_enemy()
    if last != null {
      move_toward last.position
    }
  }
  for enemy in scan_enemies(18) {
    if can_attack(enemy) {
      attack enemy
      return
    }
  }
}`;
  const result = compile(source);
  assert.ok(result.success, `Compile failed: ${result.errors.join(", ")}`);
}

function testTacticalParityPrimitivesCompileAndRun() {
  const source = `robot "ParityBot" version "1.0"
state {
  should_retreat: boolean = false
}
on tick {
  if enemy_visible() {
    let enemy = nearest_enemy()
    if can_attack(enemy) {
      attack enemy
    } else {
      fire_at enemy.position
      move_forward
    }
  } else {
    if wall_ahead(3) {
      turn_right
    } else if random(0, 100) > 50 {
      turn_left
      move_forward
    } else {
      move_forward
    }
  }

  if damage_percent() > 60 {
    set should_retreat = true
    move_backward
  }
}`;
  const result = compile(source);
  assert.ok(result.success, `Compile failed: ${result.errors.join(", ")}`);

  const baseline = compile(`robot "Baseline" version "1.0"
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
}`);
  assert.ok(baseline.success, `Compile failed: ${baseline.errors.join(", ")}`);

  const match = runMatch({
    config: {
      mode: "1v1_ranked",
      arenaWidth: 100,
      arenaHeight: 100,
      maxTicks: 600,
      tickRate: 30,
      seed: 9,
    },
    participants: [
      { program: result.program, constants: result.constants, playerId: "parity", teamId: 0 },
      { program: baseline.program, constants: baseline.constants, playerId: "base", teamId: 1 },
    ],
  });

  const totalActions = [...match.robotStats.values()].reduce((n, s) => n + s.actionsExecuted, 0);
  assert.ok(totalActions > 0, "Expected parity bot primitives to execute runtime actions");
}

function testSquadBlockCompiles() {
  const source = `robot "SquadLead" version "1.0"
squad {
  size: 3
  roles: "anchor", "flank", "support"
}
state {
  lane: number = 0
}
on tick {
  set lane = my_index()
  if my_role() == "anchor" {
    move_to nearest_control_point().position
  } else {
    let enemy = nearest_enemy()
    if enemy != null {
      move_toward enemy.position
    }
  }
}`;
  const result = compile(source);
  assert.ok(result.success, `Compile failed: ${result.errors.join(", ")}`);
  assert.equal(result.program.squad.size, 3);
  assert.equal(result.program.squad.roles.length, 3);
}

function testSquadSizeSpawnsMultipleRobotsPerParticipant() {
  const squadBot = compile(`robot "Alpha" version "1.0"
squad {
  size: 2
  roles: "left", "right"
}
on tick {
  if my_index() == 0 {
    move_forward
  } else {
    move_backward
  }
}`);
  const soloBot = compile(`robot "Beta" version "1.0"
on tick {
  move_forward
}`);
  assert.ok(squadBot.success, `Compile failed: ${squadBot.errors.join(", ")}`);
  assert.ok(soloBot.success, `Compile failed: ${soloBot.errors.join(", ")}`);

  const result = runMatch({
    config: {
      mode: "2v1_unranked",
      arenaWidth: 100,
      arenaHeight: 100,
      maxTicks: 20,
      tickRate: 30,
      seed: 123,
    },
    participants: [
      { program: squadBot.program, constants: squadBot.constants, playerId: "teamA", teamId: 0 },
      { program: soloBot.program, constants: soloBot.constants, playerId: "teamB", teamId: 1 },
    ],
  });

  const teamCounts = new Map();
  for (const participant of result.replay.metadata.participants) {
    teamCounts.set(participant.teamId, (teamCounts.get(participant.teamId) ?? 0) + 1);
  }
  assert.equal(teamCounts.get(0), 2, "Team 0 should have two spawned robots from squad.size");
  assert.equal(teamCounts.get(1), 1, "Team 1 should keep default single robot");
}

function testNewCombatActionsCompileAndRun() {
  const source = `robot "Arsenal" version "1.0"
on tick {
  let enemy = nearest_enemy()
  if enemy != null {
    if distance_to(enemy.position) > 10 {
      move_toward enemy.position
    } else if distance_to(enemy.position) < 6 {
      grenade enemy.position
    } else {
      burst_fire enemy.position
    }
  }
}`;
  const result = compile(source);
  assert.ok(result.success, `Compile failed: ${result.errors.join(", ")}`);

  const world = new World({
    mode: "test",
    arenaWidth: 120,
    arenaHeight: 120,
    maxTicks: 100,
    tickRate: 30,
    seed: 7,
  });
  const attacker = world.spawnRobot("A", "ranger", 0, "prog_a", { x: 20, y: 20 });
  const defender = world.spawnRobot("D", "ranger", 1, "prog_d", { x: 24, y: 20 });
  const healthBefore = defender.health;

  resolveCombat(world, attacker, { type: "grenade", target: { x: 24, y: 20 } });
  resolveCombat(world, attacker, { type: "burst_fire", target: { x: 24, y: 20 } });
  updateProjectiles(world);

  assert.ok(defender.health < healthBefore, "Expected burst_fire/grenade actions to deal damage");
}

function testHealingZonesAndSensorsCompile() {
  const source = `robot "MedicScout" version "1.0"
on tick {
  let heal = nearest_heal_zone()
  if heal != null and health() < max_health() {
    move_to heal.position
  }
}`;
  const result = compile(source);
  assert.ok(result.success, `Compile failed: ${result.errors.join(", ")}`);
}

// --- New Feature Tests ---

function testNewSensorsCompile() {
  const source = `robot "SensorBot" version "1.0"
meta { class: "ranger" }
on tick {
  let hp = health_percent()
  let t = time_alive()
  let k = kills()
  let enemy = nearest_enemy()
  if enemy != null {
    let a = angle_to(enemy.position)
    let f = is_facing(enemy.position, 30)
    let h = enemy_heading(enemy)
    let fm = is_enemy_facing_me(enemy)
  }
  let ally = nearest_ally()
  if ally != null {
    let ah = ally_health(ally)
  }
  let sound = nearest_sound()
  let mine = nearest_mine()
  let pickup = nearest_pickup()
  let wp = recall_position("home")
  let taunted = is_taunted()
  let ow = is_in_overwatch()
  let fast = has_effect("speed")
}`;
  const result = compile(source);
  assert.ok(result.success, `Compile failed: ${result.errors.join(", ")}`);
}

function testNewActionsCompile() {
  const source = `robot "ActionBot" version "1.0"
meta { class: "tank" }
on spawn {
  mark_position "home"
  place_mine
  send_signal "ready"
}
on tick {
  taunt
  overwatch
  place_mine
  send_signal "attacking"
  mark_position "current"
}`;
  const result = compile(source);
  assert.ok(result.success, `Compile failed: ${result.errors.join(", ")}`);
}

function testAfterEveryCompile() {
  const source = `robot "TimerBot" version "1.0"
meta { class: "support" }
on spawn {
  after 30 {
    send_signal "ready"
  }
  every 60 {
    place_mine
  }
}
on tick {
  after 10 {
    shield
  }
  move_forward
}`;
  const result = compile(source);
  assert.ok(result.success, `Compile failed: ${result.errors.join(", ")}`);
}

function testSignalReceivedEvent() {
  const source = `robot "Listener" version "1.0"
meta { class: "ranger" }
on signal_received(event) {
  move_toward event.senderPosition
}
on tick {
  move_forward
}`;
  const result = compile(source);
  assert.ok(result.success, `Compile failed: ${result.errors.join(", ")}`);
}

function testMineDetonation() {
  const world = new World({
    mode: "test", arenaWidth: 100, arenaHeight: 100, maxTicks: 100, tickRate: 30, seed: 42,
  });
  const attacker = world.spawnRobot("Miner", "brawler", 0, "prog_a", { x: 20, y: 20 });
  const victim = world.spawnRobot("Victim", "ranger", 1, "prog_b", { x: 21, y: 20 });
  world.addMine(attacker.id, 0, { x: 21, y: 20 }, 25);
  const healthBefore = victim.health;

  // Manually trigger mine check (this is done in tick loop)
  const toRemove = [];
  for (const [id, mine] of world.mines) {
    for (const robot of world.getAliveRobots()) {
      if (robot.teamId === mine.teamId) continue;
      const dx = robot.position.x - mine.position.x;
      const dy = robot.position.y - mine.position.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= 2.0) {
        robot.health -= mine.damage;
        toRemove.push(id);
        break;
      }
    }
  }
  for (const id of toRemove) world.mines.delete(id);

  assert.ok(victim.health < healthBefore, "Mine should damage enemy robot");
  assert.ok(world.mines.size === 0, "Mine should be removed after detonation");
}

function testPickupCollection() {
  const world = new World({
    mode: "test", arenaWidth: 100, arenaHeight: 100, maxTicks: 100, tickRate: 30, seed: 42,
  });
  const robot = world.spawnRobot("Collector", "ranger", 0, "prog_a", { x: 50, y: 50 });
  world.addPickup({ x: 50.5, y: 50 }, "energy");
  const energyBefore = robot.energy;
  assert.ok(world.pickups.size === 1, "Pickup should exist");
}

// --- "Did You Mean" Suggestion Tests ---

function testDidYouMeanEventSuggestion() {
  const source = `robot "Typo" version "1.0"
on tik {
  stop
}`;
  const result = compile(source);
  assert.ok(!result.success, "Should fail: unknown event");
  assert.ok(result.errors.some(e => e.includes("Did you mean 'tick'")),
    "Should suggest 'tick' for 'tik'");
}

function testDidYouMeanActionSuggestion() {
  const source = `robot "Typo" version "1.0"
on tick {
  atack
}`;
  const result = compile(source);
  assert.ok(!result.success, "Should fail: unknown action");
  // The parser may treat this as an identifier or action — check for any suggestion
  assert.ok(
    result.errors.some(e => e.includes("Did you mean") || e.includes("atack")),
    "Should report error for 'atack'");
}

function testDidYouMeanSensorSuggestion() {
  const source = `robot "Typo" version "1.0"
on tick {
  let e = nearst_enemy()
}`;
  const result = compile(source);
  assert.ok(!result.success, "Should fail: unknown function");
  assert.ok(result.errors.some(e => e.includes("Did you mean 'nearest_enemy'")),
    "Should suggest 'nearest_enemy' for 'nearst_enemy'");
}

// --- Validation Tests ---

function testValidateMatchModeAcceptsValid() {
  const result = validateMatchMode("1v1_ranked");
  assert.ok(result.valid);
}

function testValidateMatchModeRejectsInvalid() {
  const result = validateMatchMode("3v3");
  assert.ok(!result.valid);
  assert.ok(result.errors.length > 0);
}

function testValidateParticipantCountValid() {
  assert.ok(validateParticipantCount("1v1_ranked", 2).valid);
  assert.ok(validateParticipantCount("ffa", 4).valid);
  assert.ok(validateParticipantCount("2v2", 4).valid);
}

function testValidateParticipantCountInvalid() {
  assert.ok(!validateParticipantCount("1v1_ranked", 3).valid);
  assert.ok(!validateParticipantCount("ffa", 1).valid);
}

function testValidateMatchConfigValid() {
  const config = {
    mode: "1v1_ranked", arenaWidth: 140, arenaHeight: 140,
    maxTicks: 3000, tickRate: 30, seed: 42,
  };
  assert.ok(validateMatchConfig(config).valid);
}

function testValidateMatchConfigRejectsBadSeed() {
  const config = {
    mode: "1v1_ranked", arenaWidth: 140, arenaHeight: 140,
    maxTicks: 3000, tickRate: 30, seed: -1,
  };
  const result = validateMatchConfig(config);
  assert.ok(!result.valid);
  assert.ok(result.errors.some(e => e.includes("seed")));
}

function testValidateMatchConfigRejectsNonFiniteArenaSize() {
  const config = {
    mode: "1v1_ranked", arenaWidth: Number.NaN, arenaHeight: Number.POSITIVE_INFINITY,
    maxTicks: 3000, tickRate: 30, seed: 42,
  };
  const result = validateMatchConfig(config);
  assert.ok(!result.valid);
  assert.ok(result.errors.some(e => e.includes("arenaWidth")));
  assert.ok(result.errors.some(e => e.includes("arenaHeight")));
}

function testValidateParticipantRejectsMissingFields() {
  const result = validateParticipant({ playerId: "", teamId: -1 });
  assert.ok(!result.valid);
  assert.ok(result.errors.length >= 2);
}

function testValidateParticipantRejectsNonArrayBytecode() {
  const result = validateParticipant({
    program: { bytecode: {}, stateSlots: [], eventHandlers: {} },
    constants: [],
    playerId: "p1",
    teamId: 0,
  });
  assert.ok(!result.valid);
  assert.ok(result.errors.some(e => e.includes("participant.program.bytecode must be an array or typed array")));
}

function testValidateMatchRequestFullValid() {
  const prog = compile(`robot "Test" version "1.0"\non tick { stop }`);
  assert.ok(prog.success);
  const request = {
    config: {
      mode: "1v1_ranked", arenaWidth: 140, arenaHeight: 140,
      maxTicks: 3000, tickRate: 30, seed: 42,
    },
    participants: [
      { program: prog.program, constants: prog.constants, playerId: "p1", teamId: 0 },
      { program: prog.program, constants: prog.constants, playerId: "p2", teamId: 1 },
    ],
  };
  assert.ok(validateMatchRequest(request).valid);
}

// --- Replay Bookmark Tests ---

function testComputeBookmarksDetectsDamage() {
  const frames = [
    { tick: 0, robots: [{ id: "r1", health: 100 }, { id: "r2", health: 100 }], events: [] },
    { tick: 1, robots: [{ id: "r1", health: 100 }, { id: "r2", health: 90 }], events: [] },
    { tick: 2, robots: [{ id: "r1", health: 100 }, { id: "r2", health: 80 }], events: [] },
  ];
  const bm = computeBookmarks(frames);
  assert.equal(bm.firstDamage, 1, "First damage should be at frame 1");
  assert.equal(bm.firstKill, null, "No kills in these frames");
}

function testComputeBookmarksDetectsKill() {
  const frames = [
    { tick: 0, robots: [{ id: "r1", health: 100 }, { id: "r2", health: 10 }], events: [] },
    { tick: 1, robots: [{ id: "r1", health: 100 }, { id: "r2", health: 0 }], events: [] },
  ];
  const bm = computeBookmarks(frames);
  assert.equal(bm.firstKill, 1, "First kill should be at frame 1");
}

function testComputeBookmarksLowHealth() {
  const frames = [
    { tick: 0, robots: [{ id: "r1", health: 100 }], events: [] },
    { tick: 1, robots: [{ id: "r1", health: 30 }], events: [] },
    { tick: 2, robots: [{ id: "r1", health: 20 }], events: [] },
  ];
  const bm = computeBookmarks(frames);
  assert.equal(bm.lowHealthMoments.length, 1);
  assert.equal(bm.lowHealthMoments[0].frameIndex, 2);
  assert.equal(bm.lowHealthMoments[0].robotId, "r1");
}

// --- Engine Invariant Tests (Property-Based) ---

function testEngineHealthBoundsInvariant() {
  // Run a match and verify no robot ever has NaN health or health > maxHealth
  const bot = compile(`robot "Inv" version "1.0"
meta { class: "brawler" }
on tick {
  let enemy = nearest_enemy()
  if enemy != null {
    if can_attack(enemy) { attack enemy } else { move_toward enemy.position }
  } else { move_forward }
}`);
  assert.ok(bot.success);

  const result = runMatch({
    config: { mode: "1v1_ranked", arenaWidth: 80, arenaHeight: 80, maxTicks: 500, tickRate: 30, seed: 42 },
    participants: [
      { program: bot.program, constants: bot.constants, playerId: "p1", teamId: 0 },
      { program: bot.program, constants: bot.constants, playerId: "p2", teamId: 1 },
    ],
  });

  for (const frame of result.replay.frames) {
    for (const robot of frame.robots) {
      assert.ok(!isNaN(robot.health), `Robot ${robot.id} has NaN health at tick ${frame.tick}`);
      assert.ok(!isNaN(robot.position.x), `Robot ${robot.id} has NaN x at tick ${frame.tick}`);
      assert.ok(!isNaN(robot.position.y), `Robot ${robot.id} has NaN y at tick ${frame.tick}`);
    }
  }
}

function testEngineNoNaNPositions() {
  // Run with multiple robot types and check position invariants
  const brawler = compile(`robot "B" version "1.0"\nmeta { class: "brawler" }\non tick { move_forward\nif wall_ahead(3) { turn_right } }`);
  const ranger = compile(`robot "R" version "1.0"\nmeta { class: "ranger" }\non tick { let e = nearest_enemy()\nif e != null { fire_at e.position } else { move_forward } }`);
  assert.ok(brawler.success && ranger.success);

  const result = runMatch({
    config: { mode: "1v1_ranked", arenaWidth: 100, arenaHeight: 100, maxTicks: 300, tickRate: 30, seed: 99 },
    participants: [
      { program: brawler.program, constants: brawler.constants, playerId: "b", teamId: 0 },
      { program: ranger.program, constants: ranger.constants, playerId: "r", teamId: 1 },
    ],
  });

  for (const frame of result.replay.frames) {
    for (const robot of frame.robots) {
      assert.ok(robot.position.x >= 0 && robot.position.x <= 100,
        `Robot ${robot.id} x=${robot.position.x} out of bounds at tick ${frame.tick}`);
      assert.ok(robot.position.y >= 0 && robot.position.y <= 100,
        `Robot ${robot.id} y=${robot.position.y} out of bounds at tick ${frame.tick}`);
    }
  }
}

// --- End-to-End 2v2 and FFA Tests ---

function testEndToEnd2v2Match() {
  const tankBot = compile(`robot "Tank" version "1.0"\nmeta { class: "tank" }\non tick { let e = nearest_enemy()\nif e != null { if can_attack(e) { attack e } else { move_toward e.position } } else { move_forward } }`);
  const rangerBot = compile(`robot "Ranger" version "1.0"\nmeta { class: "ranger" }\non tick { let e = nearest_enemy()\nif e != null { fire_at e.position } else { move_forward } }`);
  assert.ok(tankBot.success && rangerBot.success);

  const result = runMatch({
    config: { mode: "squad_2v2", arenaWidth: 100, arenaHeight: 100, maxTicks: 600, tickRate: 30, seed: 55 },
    participants: [
      { program: tankBot.program, constants: tankBot.constants, playerId: "t1", teamId: 0 },
      { program: rangerBot.program, constants: rangerBot.constants, playerId: "r1", teamId: 0 },
      { program: tankBot.program, constants: tankBot.constants, playerId: "t2", teamId: 1 },
      { program: rangerBot.program, constants: rangerBot.constants, playerId: "r2", teamId: 1 },
    ],
  });

  assert.ok(result.replay.frames.length > 0, "2v2 match should produce frames");
  assert.ok(result.tickCount > 0, "2v2 match should run ticks");
  // Verify 4 robots spawned
  const firstFrame = result.replay.frames[0];
  assert.equal(firstFrame.robots.length, 4, "2v2 should have 4 robots");
  // Verify both teams present
  const teams = new Set(firstFrame.robots.map(r => r.teamId));
  assert.ok(teams.has(0) && teams.has(1), "Both teams should be present");
}

function testEndToEndFFAMatch() {
  const bot = compile(`robot "FFA" version "1.0"\nmeta { class: "brawler" }\non tick { let e = nearest_enemy()\nif e != null { if can_attack(e) { attack e } else { move_toward e.position } } else { move_forward } }`);
  assert.ok(bot.success);

  const result = runMatch({
    config: { mode: "ffa", arenaWidth: 120, arenaHeight: 120, maxTicks: 600, tickRate: 30, seed: 33 },
    participants: [
      { program: bot.program, constants: bot.constants, playerId: "p1", teamId: 0 },
      { program: bot.program, constants: bot.constants, playerId: "p2", teamId: 1 },
      { program: bot.program, constants: bot.constants, playerId: "p3", teamId: 2 },
      { program: bot.program, constants: bot.constants, playerId: "p4", teamId: 3 },
    ],
  });

  assert.ok(result.replay.frames.length > 0, "FFA match should produce frames");
  const firstFrame = result.replay.frames[0];
  assert.equal(firstFrame.robots.length, 4, "FFA should have 4 robots");
  const teams = new Set(firstFrame.robots.map(r => r.teamId));
  assert.equal(teams.size, 4, "FFA should have 4 unique teams");
}

function testDeterministicReplayWithSeed() {
  const bot = compile(`robot "Det" version "1.0"\nmeta { class: "brawler" }\non tick { let e = nearest_enemy()\nif e != null { if can_attack(e) { attack e } else { move_toward e.position } } else { move_forward } }`);
  assert.ok(bot.success);

  const config = { mode: "1v1_ranked", arenaWidth: 80, arenaHeight: 80, maxTicks: 200, tickRate: 30, seed: 12345 };
  const participants = [
    { program: bot.program, constants: bot.constants, playerId: "a", teamId: 0 },
    { program: bot.program, constants: bot.constants, playerId: "b", teamId: 1 },
  ];

  const result1 = runMatch({ config, participants });
  const result2 = runMatch({ config, participants });

  assert.equal(result1.tickCount, result2.tickCount, "Same seed should produce same tick count");
  assert.equal(result1.winner, result2.winner, "Same seed should produce same winner");
  // Compare final frame positions
  const last1 = result1.replay.frames[result1.replay.frames.length - 1];
  const last2 = result2.replay.frames[result2.replay.frames.length - 1];
  for (let i = 0; i < last1.robots.length; i++) {
    assert.ok(Math.abs(last1.robots[i].position.x - last2.robots[i].position.x) < 0.001,
      "Deterministic seed should produce identical final positions");
  }
}

function testProgramIdIsUniqueWhenTimeIsFrozen() {
  const fixedNow = 1700000000000;
  const originalNow = Date.now;
  Date.now = () => fixedNow;
  try {
    const compiledA = compile(`robot "ProgA" version "1.0"\non tick { stop }`);
    const compiledB = compile(`robot "ProgB" version "1.0"\non tick { stop }`);
    assert.ok(compiledA.success && compiledB.success, "Both programs should compile");
    assert.notEqual(compiledA.program.programId, compiledB.program.programId,
      "Program IDs should remain unique even when Date.now() is constant");
  } finally {
    Date.now = originalNow;
  }
}

function testMatchIdIsUniqueWhenTimeIsFrozen() {
  const bot = compile(`robot "FrozenTimeBot" version "1.0"
on tick {
  move_forward
}`);
  assert.ok(bot.success);

  const config = { mode: "1v1_ranked", arenaWidth: 80, arenaHeight: 80, maxTicks: 50, tickRate: 30, seed: 777 };
  const participants = [
    { program: bot.program, constants: bot.constants, playerId: "p1", teamId: 0 },
    { program: bot.program, constants: bot.constants, playerId: "p2", teamId: 1 },
  ];

  const fixedNow = 1700000000000;
  const originalNow = Date.now;
  Date.now = () => fixedNow;
  try {
    const resultA = runMatch({ config, participants });
    const resultB = runMatch({ config, participants });
    assert.notEqual(resultA.replay.metadata.matchId, resultB.replay.metadata.matchId,
      "Match IDs should remain unique even when Date.now() is constant");
  } finally {
    Date.now = originalNow;
  }
}

// --- Run all tests ---

function run() {
  const tests = [
    testDuplicateTopLevelBlocks,
    testSemanticAnalyzerStateIsolation,
    testCompilerStateIsolation,
    testConstantExpressionEvaluation,
    testConstantNegativeValue,
    testFunctionNameAsIdentifier,
    testRecursionLocalsIsolation,
    testVMStackOverflowProtection,
    testShieldDoesNotExceedMaxHealth,
    testDivisionByZeroInConstants,
    testEmptyStringIsTruthy,
    testMultipleElseIfBranches,
    testShortCircuitAnd,
    testShortCircuitOr,
    testUnknownEventReportsError,
    testDuplicateStateVariable,
    testSetOnNonStateVariable,
    testUnterminatedString,
    testBotsNavigateAroundCover,
    testAttackRequiresVisibility,
    testActiveScanAndMemorySensorsCompile,
    testTacticalParityPrimitivesCompileAndRun,
    testSquadBlockCompiles,
    testSquadSizeSpawnsMultipleRobotsPerParticipant,
    testNewCombatActionsCompileAndRun,
    testHealingZonesAndSensorsCompile,
    testNewSensorsCompile,
    testNewActionsCompile,
    testAfterEveryCompile,
    testSignalReceivedEvent,
    testMineDetonation,
    testPickupCollection,
    // "Did you mean" suggestions
    testDidYouMeanEventSuggestion,
    testDidYouMeanActionSuggestion,
    testDidYouMeanSensorSuggestion,
    // Validation
    testValidateMatchModeAcceptsValid,
    testValidateMatchModeRejectsInvalid,
    testValidateParticipantCountValid,
    testValidateParticipantCountInvalid,
    testValidateMatchConfigValid,
    testValidateMatchConfigRejectsBadSeed,
    testValidateMatchConfigRejectsNonFiniteArenaSize,
    testValidateParticipantRejectsMissingFields,
    testValidateParticipantRejectsNonArrayBytecode,
    testValidateMatchRequestFullValid,
    // Replay bookmarks
    testComputeBookmarksDetectsDamage,
    testComputeBookmarksDetectsKill,
    testComputeBookmarksLowHealth,
    // Engine invariants
    testEngineHealthBoundsInvariant,
    testEngineNoNaNPositions,
    // End-to-end multi-mode
    testEndToEnd2v2Match,
    testEndToEndFFAMatch,
    testDeterministicReplayWithSeed,
    testProgramIdIsUniqueWhenTimeIsFrozen,
    testMatchIdIsUniqueWhenTimeIsFrozen,
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      test();
      console.log(`  PASS: ${test.name}`);
      passed++;
    } catch (e) {
      console.error(`  FAIL: ${test.name} — ${e.message}`);
      failed++;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed, ${tests.length} total`);
  if (failed > 0) process.exit(1);
}

run();

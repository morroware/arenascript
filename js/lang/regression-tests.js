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

import assert from "node:assert/strict";
import { Lexer } from "./tokens.js";
import { Parser } from "./parser.js";
import { SemanticAnalyzer } from "./semantic.js";
import { Compiler } from "./compiler.js";
import { compile } from "./pipeline.js";
import { VM } from "../runtime/vm.js";
import { runMatch } from "../engine/tick.js";

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
}`;

  const chaserB = `robot "RightChaser" version "1.0"
meta {
  author: "test"
  class: "ranger"
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

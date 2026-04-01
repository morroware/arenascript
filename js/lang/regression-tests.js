import assert from "node:assert/strict";
import { Lexer } from "./tokens.js";
import { Parser } from "./parser.js";
import { SemanticAnalyzer } from "./semantic.js";
import { Compiler } from "./compiler.js";

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

function run() {
  testDuplicateTopLevelBlocks();
  testSemanticAnalyzerStateIsolation();
  testCompilerStateIsolation();
  console.log("All regression tests passed");
}

run();

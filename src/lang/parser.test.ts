import { describe, it, expect } from "vitest";
import { Lexer } from "./tokens.js";
import { Parser } from "./parser.js";

function parse(source: string) {
  const tokens = new Lexer(source).tokenize();
  return new Parser(tokens).parse();
}

describe("Parser", () => {
  it("parses a minimal program", () => {
    const ast = parse('robot "Test" version "1.0"');
    expect(ast.kind).toBe("Program");
    expect(ast.robot.name).toBe("Test");
    expect(ast.robot.version).toBe("1.0");
  });

  it("parses meta block", () => {
    const ast = parse(`
      robot "Bot" version "1.0"
      meta {
        author: "me"
        class: "ranger"
      }
    `);
    expect(ast.meta).toBeDefined();
    expect(ast.meta!.entries).toHaveLength(2);
    expect(ast.meta!.entries[0].key).toBe("author");
  });

  it("parses const block", () => {
    const ast = parse(`
      robot "Bot" version "1.0"
      const {
        MAX_RANGE = 10
        MIN_HEALTH = 20
      }
    `);
    expect(ast.constants).toBeDefined();
    expect(ast.constants!.entries).toHaveLength(2);
    expect(ast.constants!.entries[0].name).toBe("MAX_RANGE");
  });

  it("parses state block with types", () => {
    const ast = parse(`
      robot "Bot" version "1.0"
      state {
        mode: string = "idle"
        target: id? = null
        count: number = 0
      }
    `);
    expect(ast.state).toBeDefined();
    expect(ast.state!.entries).toHaveLength(3);
    expect(ast.state!.entries[1].type.nullable).toBe(true);
  });

  it("parses event handlers", () => {
    const ast = parse(`
      robot "Bot" version "1.0"
      on spawn {
        stop
      }
      on tick {
        let enemy = nearest_enemy()
        if enemy != null {
          attack enemy
        }
      }
      on damaged(event) {
        retreat
      }
    `);
    expect(ast.handlers).toHaveLength(3);
    expect(ast.handlers[0].event).toBe("spawn");
    expect(ast.handlers[1].event).toBe("tick");
    expect(ast.handlers[2].event).toBe("damaged");
    expect(ast.handlers[2].param).toBe("event");
  });

  it("parses functions", () => {
    const ast = parse(`
      robot "Bot" version "1.0"
      fn should_engage(enemy: enemy) -> boolean {
        return distance_to(enemy) < 8
      }
    `);
    expect(ast.functions).toHaveLength(1);
    expect(ast.functions[0].name).toBe("should_engage");
    expect(ast.functions[0].params).toHaveLength(1);
    expect(ast.functions[0].returnType?.name).toBe("boolean");
  });

  it("parses for loops", () => {
    const ast = parse(`
      robot "Bot" version "1.0"
      on tick {
        for enemy in visible_enemies() {
          attack enemy
        }
      }
    `);
    const handler = ast.handlers[0];
    expect(handler.body[0].kind).toBe("ForStatement");
  });

  it("parses complex expressions", () => {
    const ast = parse(`
      robot "Bot" version "1.0"
      on tick {
        let x = health() > 20 and energy() > 10
      }
    `);
    const handler = ast.handlers[0];
    const letStmt = handler.body[0];
    expect(letStmt.kind).toBe("LetStatement");
  });

  it("parses if/else if/else chains", () => {
    const ast = parse(`
      robot "Bot" version "1.0"
      on tick {
        if health() < 20 {
          retreat
        } else if health() < 50 {
          shield
        } else {
          attack nearest_enemy()
        }
      }
    `);
    const ifStmt = ast.handlers[0].body[0];
    expect(ifStmt.kind).toBe("IfStatement");
    if (ifStmt.kind === "IfStatement") {
      expect(ifStmt.elseIfBranches).toHaveLength(1);
      expect(ifStmt.elseBranch).toBeDefined();
    }
  });
});

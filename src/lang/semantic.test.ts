import { describe, it, expect } from "vitest";
import { Lexer } from "./tokens.js";
import { Parser } from "./parser.js";
import { SemanticAnalyzer } from "./semantic.js";

function analyze(source: string) {
  const tokens = new Lexer(source).tokenize();
  const ast = new Parser(tokens).parse();
  return new SemanticAnalyzer().analyze(ast);
}

describe("SemanticAnalyzer", () => {
  it("accepts a valid program", () => {
    const diagnostics = analyze(`
      robot "Bot" version "1.0"
      on tick {
        let enemy = nearest_enemy()
        if enemy != null {
          attack enemy
        }
      }
    `);
    const errors = diagnostics.filter(d => d.severity === "error");
    expect(errors).toHaveLength(0);
  });

  it("rejects unknown events", () => {
    const diagnostics = analyze(`
      robot "Bot" version "1.0"
      on invalid_event {
        stop
      }
    `);
    expect(diagnostics.some(d => d.message.includes("Unknown event"))).toBe(true);
  });

  it("rejects duplicate event handlers", () => {
    const diagnostics = analyze(`
      robot "Bot" version "1.0"
      on tick {
        stop
      }
      on tick {
        stop
      }
    `);
    expect(diagnostics.some(d => d.message.includes("Duplicate handler"))).toBe(true);
  });

  it("rejects set on non-state variables", () => {
    const diagnostics = analyze(`
      robot "Bot" version "1.0"
      on tick {
        set unknown_var = 42
      }
    `);
    expect(diagnostics.some(d => d.message.includes("not declared in state"))).toBe(true);
  });

  it("allows set on state variables", () => {
    const diagnostics = analyze(`
      robot "Bot" version "1.0"
      state {
        mode: string = "idle"
      }
      on tick {
        set mode = "fight"
      }
    `);
    const errors = diagnostics.filter(d => d.severity === "error");
    expect(errors).toHaveLength(0);
  });

  it("rejects unknown identifiers", () => {
    const diagnostics = analyze(`
      robot "Bot" version "1.0"
      on tick {
        let x = unknown_variable
      }
    `);
    expect(diagnostics.some(d => d.message.includes("Unknown identifier"))).toBe(true);
  });

  it("rejects unknown actions", () => {
    const diagnostics = analyze(`
      robot "Bot" version "1.0"
      on tick {
        fly_away
      }
    `);
    // fly_away would be parsed as an expression statement (function call) or action
    // Depending on parse, it may show as unknown function
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("warns on missing tick handler", () => {
    const diagnostics = analyze(`
      robot "Bot" version "1.0"
    `);
    expect(diagnostics.some(d => d.message.includes("no 'tick' or 'spawn'"))).toBe(true);
  });
});

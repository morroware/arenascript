import { describe, it, expect } from "vitest";
import { Lexer, TokenType, LexerError } from "./tokens.js";

describe("Lexer", () => {
  it("tokenizes a robot declaration", () => {
    const tokens = new Lexer('robot "Bruiser" version "1.0"').tokenize();
    expect(tokens[0].type).toBe(TokenType.Robot);
    expect(tokens[1].type).toBe(TokenType.String);
    expect(tokens[1].value).toBe("Bruiser");
    expect(tokens[2].type).toBe(TokenType.Version);
    expect(tokens[3].type).toBe(TokenType.String);
    expect(tokens[3].value).toBe("1.0");
  });

  it("tokenizes keywords correctly", () => {
    const tokens = new Lexer("if else for in let set fn on return and or not").tokenize();
    expect(tokens[0].type).toBe(TokenType.If);
    expect(tokens[1].type).toBe(TokenType.Else);
    expect(tokens[2].type).toBe(TokenType.For);
    expect(tokens[3].type).toBe(TokenType.In);
    expect(tokens[4].type).toBe(TokenType.Let);
    expect(tokens[5].type).toBe(TokenType.Set);
    expect(tokens[6].type).toBe(TokenType.Fn);
    expect(tokens[7].type).toBe(TokenType.On);
    expect(tokens[8].type).toBe(TokenType.Return);
  });

  it("tokenizes operators", () => {
    const tokens = new Lexer("== != <= >= -> + - * /").tokenize();
    expect(tokens[0].type).toBe(TokenType.EqualEqual);
    expect(tokens[1].type).toBe(TokenType.BangEqual);
    expect(tokens[2].type).toBe(TokenType.LessEqual);
    expect(tokens[3].type).toBe(TokenType.GreaterEqual);
    expect(tokens[4].type).toBe(TokenType.Arrow);
  });

  it("tokenizes numbers", () => {
    const tokens = new Lexer("42 3.14 100").tokenize();
    expect(tokens[0].type).toBe(TokenType.Number);
    expect(tokens[0].value).toBe("42");
    expect(tokens[1].value).toBe("3.14");
  });

  it("skips comments", () => {
    const tokens = new Lexer("let x = 5 // this is a comment\nlet y = 10").tokenize();
    const identifiers = tokens.filter(t => t.type === TokenType.Identifier);
    expect(identifiers).toHaveLength(2);
  });

  it("throws on unterminated string", () => {
    expect(() => new Lexer('"hello').tokenize()).toThrow(LexerError);
  });

  it("tokenizes boolean and null literals", () => {
    const tokens = new Lexer("true false null").tokenize();
    expect(tokens[0].type).toBe(TokenType.True);
    expect(tokens[1].type).toBe(TokenType.False);
    expect(tokens[2].type).toBe(TokenType.Null_KW);
  });
});

// ============================================================================
// ArenaScript Lexer — Tokenizer
// ============================================================================

export enum TokenType {
  // Literals
  Number = "Number",
  String = "String",
  Boolean = "Boolean",
  Null = "Null",

  // Identifiers & Keywords
  Identifier = "Identifier",
  Robot = "Robot",
  Version = "Version",
  Meta = "Meta",
  Const = "Const",
  State = "State",
  On = "On",
  Fn = "Fn",
  Let = "Let",
  Set = "Set",
  If = "If",
  Else = "Else",
  For = "For",
  In = "In",
  Return = "Return",
  And = "And",
  Or = "Or",
  Not = "Not",
  Null_KW = "Null_KW",
  True = "True",
  False = "False",

  // Punctuation
  LeftBrace = "LeftBrace",
  RightBrace = "RightBrace",
  LeftParen = "LeftParen",
  RightParen = "RightParen",
  Comma = "Comma",
  Colon = "Colon",
  Dot = "Dot",
  Arrow = "Arrow",          // ->
  QuestionMark = "QuestionMark",

  // Operators
  Plus = "Plus",
  Minus = "Minus",
  Star = "Star",
  Slash = "Slash",
  Percent = "Percent",
  Equal = "Equal",           // =
  EqualEqual = "EqualEqual", // ==
  BangEqual = "BangEqual",   // !=
  Less = "Less",
  LessEqual = "LessEqual",
  Greater = "Greater",
  GreaterEqual = "GreaterEqual",

  // Special
  Newline = "Newline",
  Comment = "Comment",
  EOF = "EOF",
}

const KEYWORDS: Record<string, TokenType> = {
  robot: TokenType.Robot,
  version: TokenType.Version,
  meta: TokenType.Meta,
  const: TokenType.Const,
  state: TokenType.State,
  on: TokenType.On,
  fn: TokenType.Fn,
  let: TokenType.Let,
  set: TokenType.Set,
  if: TokenType.If,
  else: TokenType.Else,
  for: TokenType.For,
  in: TokenType.In,
  return: TokenType.Return,
  and: TokenType.And,
  or: TokenType.Or,
  not: TokenType.Not,
  null: TokenType.Null_KW,
  true: TokenType.True,
  false: TokenType.False,
};

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

export interface SourceSpan {
  line: number;
  column: number;
  length: number;
}

export class LexerError extends Error {
  constructor(
    message: string,
    public line: number,
    public column: number,
  ) {
    super(`Lexer error at ${line}:${column}: ${message}`);
  }
}

export class Lexer {
  private source: string;
  private pos = 0;
  private line = 1;
  private column = 1;
  private tokens: Token[] = [];

  constructor(source: string) {
    this.source = source;
  }

  tokenize(): Token[] {
    while (this.pos < this.source.length) {
      this.skipWhitespaceExceptNewlines();

      if (this.pos >= this.source.length) break;

      const ch = this.source[this.pos];

      // Newlines
      if (ch === "\n") {
        this.advance();
        continue;
      }

      // Comments
      if (ch === "/" && this.peek(1) === "/") {
        this.readComment();
        continue;
      }

      // Strings
      if (ch === '"') {
        this.readString();
        continue;
      }

      // Numbers
      if (this.isDigit(ch) || (ch === "-" && this.isDigit(this.peek(1)))) {
        this.readNumber();
        continue;
      }

      // Identifiers and keywords
      if (this.isAlpha(ch) || ch === "_") {
        this.readIdentifier();
        continue;
      }

      // Two-character operators
      if (ch === "-" && this.peek(1) === ">") {
        this.addToken(TokenType.Arrow, "->");
        this.advance();
        this.advance();
        continue;
      }
      if (ch === "=" && this.peek(1) === "=") {
        this.addToken(TokenType.EqualEqual, "==");
        this.advance();
        this.advance();
        continue;
      }
      if (ch === "!" && this.peek(1) === "=") {
        this.addToken(TokenType.BangEqual, "!=");
        this.advance();
        this.advance();
        continue;
      }
      if (ch === "<" && this.peek(1) === "=") {
        this.addToken(TokenType.LessEqual, "<=");
        this.advance();
        this.advance();
        continue;
      }
      if (ch === ">" && this.peek(1) === "=") {
        this.addToken(TokenType.GreaterEqual, ">=");
        this.advance();
        this.advance();
        continue;
      }

      // Single-character tokens
      const singleChar: Record<string, TokenType> = {
        "{": TokenType.LeftBrace,
        "}": TokenType.RightBrace,
        "(": TokenType.LeftParen,
        ")": TokenType.RightParen,
        ",": TokenType.Comma,
        ":": TokenType.Colon,
        ".": TokenType.Dot,
        "?": TokenType.QuestionMark,
        "+": TokenType.Plus,
        "-": TokenType.Minus,
        "*": TokenType.Star,
        "/": TokenType.Slash,
        "%": TokenType.Percent,
        "=": TokenType.Equal,
        "<": TokenType.Less,
        ">": TokenType.Greater,
      };

      if (singleChar[ch]) {
        this.addToken(singleChar[ch], ch);
        this.advance();
        continue;
      }

      throw new LexerError(`Unexpected character '${ch}'`, this.line, this.column);
    }

    this.addToken(TokenType.EOF, "");
    return this.tokens;
  }

  private advance(): string {
    const ch = this.source[this.pos];
    this.pos++;
    if (ch === "\n") {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return ch;
  }

  private peek(offset = 0): string {
    const idx = this.pos + offset;
    if (idx >= this.source.length) return "\0";
    return this.source[idx];
  }

  private skipWhitespaceExceptNewlines(): void {
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos];
      if (ch === " " || ch === "\t" || ch === "\r") {
        this.advance();
      } else {
        break;
      }
    }
  }

  private readComment(): void {
    // Skip //
    this.advance();
    this.advance();
    let value = "";
    while (this.pos < this.source.length && this.source[this.pos] !== "\n") {
      value += this.advance();
    }
    // Comments are discarded — not added to token stream
  }

  private readString(): void {
    const startLine = this.line;
    const startCol = this.column;
    this.advance(); // skip opening "
    let value = "";
    while (this.pos < this.source.length && this.source[this.pos] !== '"') {
      if (this.source[this.pos] === "\n") {
        throw new LexerError("Unterminated string", startLine, startCol);
      }
      if (this.source[this.pos] === "\\" && this.pos + 1 < this.source.length) {
        this.advance(); // skip backslash
        const escaped = this.advance();
        switch (escaped) {
          case "n": value += "\n"; break;
          case "t": value += "\t"; break;
          case "\\": value += "\\"; break;
          case '"': value += '"'; break;
          default: value += escaped;
        }
      } else {
        value += this.advance();
      }
    }
    if (this.pos >= this.source.length) {
      throw new LexerError("Unterminated string", startLine, startCol);
    }
    this.advance(); // skip closing "
    this.tokens.push({ type: TokenType.String, value, line: startLine, column: startCol });
  }

  private readNumber(): void {
    const startLine = this.line;
    const startCol = this.column;
    let value = "";

    if (this.source[this.pos] === "-") {
      value += this.advance();
    }

    while (this.pos < this.source.length && this.isDigit(this.source[this.pos])) {
      value += this.advance();
    }

    if (this.pos < this.source.length && this.source[this.pos] === "." && this.isDigit(this.peek(1))) {
      value += this.advance(); // .
      while (this.pos < this.source.length && this.isDigit(this.source[this.pos])) {
        value += this.advance();
      }
    }

    this.tokens.push({ type: TokenType.Number, value, line: startLine, column: startCol });
  }

  private readIdentifier(): void {
    const startLine = this.line;
    const startCol = this.column;
    let value = "";

    while (
      this.pos < this.source.length &&
      (this.isAlphaNumeric(this.source[this.pos]) || this.source[this.pos] === "_")
    ) {
      value += this.advance();
    }

    const type = KEYWORDS[value] ?? TokenType.Identifier;
    this.tokens.push({ type, value, line: startLine, column: startCol });
  }

  private addToken(type: TokenType, value: string): void {
    this.tokens.push({ type, value, line: this.line, column: this.column });
  }

  private isDigit(ch: string): boolean {
    return ch >= "0" && ch <= "9";
  }

  private isAlpha(ch: string): boolean {
    return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
  }

  private isAlphaNumeric(ch: string): boolean {
    return this.isAlpha(ch) || this.isDigit(ch);
  }
}

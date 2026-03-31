// ============================================================================
// ArenaScript AST — Node Definitions
// ============================================================================

export interface SourceSpan {
  line: number;
  column: number;
}

// --- Top-Level Nodes ---

export interface ProgramNode {
  kind: "Program";
  robot: RobotDeclNode;
  meta?: MetaBlockNode;
  constants?: ConstBlockNode;
  state?: StateBlockNode;
  handlers: EventHandlerNode[];
  functions: FunctionDeclNode[];
  span: SourceSpan;
}

export interface RobotDeclNode {
  kind: "RobotDecl";
  name: string;
  version: string;
  span: SourceSpan;
}

export interface MetaBlockNode {
  kind: "MetaBlock";
  entries: Array<{ key: string; value: string }>;
  span: SourceSpan;
}

export interface ConstBlockNode {
  kind: "ConstBlock";
  entries: ConstEntry[];
  span: SourceSpan;
}

export interface ConstEntry {
  name: string;
  value: Expression;
  span: SourceSpan;
}

export interface StateBlockNode {
  kind: "StateBlock";
  entries: StateEntry[];
  span: SourceSpan;
}

export interface StateEntry {
  name: string;
  type: TypeAnnotation;
  initialValue: Expression;
  span: SourceSpan;
}

export interface EventHandlerNode {
  kind: "EventHandler";
  event: string;
  param?: string;
  body: Statement[];
  span: SourceSpan;
}

export interface FunctionDeclNode {
  kind: "FunctionDecl";
  name: string;
  params: FunctionParam[];
  returnType?: TypeAnnotation;
  body: Statement[];
  span: SourceSpan;
}

export interface FunctionParam {
  name: string;
  type: TypeAnnotation;
}

// --- Type Annotations ---

export interface TypeAnnotation {
  kind: "TypeAnnotation";
  name: string;       // "number", "boolean", "string", "enemy", "list", etc.
  nullable: boolean;
  generic?: string;   // for list<enemy> -> generic = "enemy"
}

// --- Statements ---

export type Statement =
  | LetStatement
  | SetStatement
  | IfStatement
  | ForStatement
  | ReturnStatement
  | ActionStatement
  | ExpressionStatement;

export interface LetStatement {
  kind: "LetStatement";
  name: string;
  value: Expression;
  span: SourceSpan;
}

export interface SetStatement {
  kind: "SetStatement";
  name: string;
  value: Expression;
  span: SourceSpan;
}

export interface IfStatement {
  kind: "IfStatement";
  condition: Expression;
  thenBranch: Statement[];
  elseIfBranches: Array<{ condition: Expression; body: Statement[] }>;
  elseBranch?: Statement[];
  span: SourceSpan;
}

export interface ForStatement {
  kind: "ForStatement";
  variable: string;
  iterable: Expression;
  body: Statement[];
  span: SourceSpan;
}

export interface ReturnStatement {
  kind: "ReturnStatement";
  value?: Expression;
  span: SourceSpan;
}

export interface ActionStatement {
  kind: "ActionStatement";
  action: string;
  args: Expression[];
  span: SourceSpan;
}

export interface ExpressionStatement {
  kind: "ExpressionStatement";
  expression: Expression;
  span: SourceSpan;
}

// --- Expressions ---

export type Expression =
  | NumberLiteral
  | StringLiteral
  | BooleanLiteral
  | NullLiteral
  | IdentifierExpr
  | BinaryExpr
  | UnaryExpr
  | CallExpr
  | MemberExpr
  | ComparisonExpr;

export interface NumberLiteral {
  kind: "NumberLiteral";
  value: number;
  span: SourceSpan;
}

export interface StringLiteral {
  kind: "StringLiteral";
  value: string;
  span: SourceSpan;
}

export interface BooleanLiteral {
  kind: "BooleanLiteral";
  value: boolean;
  span: SourceSpan;
}

export interface NullLiteral {
  kind: "NullLiteral";
  span: SourceSpan;
}

export interface IdentifierExpr {
  kind: "Identifier";
  name: string;
  span: SourceSpan;
}

export interface BinaryExpr {
  kind: "BinaryExpr";
  operator: "+" | "-" | "*" | "/" | "%" | "and" | "or";
  left: Expression;
  right: Expression;
  span: SourceSpan;
}

export interface UnaryExpr {
  kind: "UnaryExpr";
  operator: "-" | "not";
  operand: Expression;
  span: SourceSpan;
}

export interface CallExpr {
  kind: "CallExpr";
  callee: string;
  args: Expression[];
  span: SourceSpan;
}

export interface MemberExpr {
  kind: "MemberExpr";
  object: Expression;
  property: string;
  span: SourceSpan;
}

export interface ComparisonExpr {
  kind: "ComparisonExpr";
  operator: "==" | "!=" | "<" | "<=" | ">" | ">=";
  left: Expression;
  right: Expression;
  span: SourceSpan;
}

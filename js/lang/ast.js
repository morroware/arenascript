// ============================================================================
// ArenaScript AST — Node Definitions
// ============================================================================

// AST nodes are plain objects with a `kind` field discriminator.
// No type definitions needed in vanilla JS — nodes are created directly
// as object literals by the parser.
//
// Node kinds:
//   Program, RobotDecl, MetaBlock, ConstBlock, StateBlock,
//   EventHandler, FunctionDecl, TypeAnnotation,
//   LetStatement, SetStatement, IfStatement, ForStatement,
//   ReturnStatement, ActionStatement, ExpressionStatement,
//   NumberLiteral, StringLiteral, BooleanLiteral, NullLiteral,
//   Identifier, BinaryExpr, UnaryExpr, CallExpr, MemberExpr, ComparisonExpr

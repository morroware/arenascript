// ============================================================================
// ArenaScript Compiler — AST → Bytecode
// ============================================================================

import type {
  ProgramNode, Statement, Expression, EventHandlerNode, FunctionDeclNode,
} from "./ast.js";
import { Op, type ConstPoolEntry, type BytecodeChunk } from "../runtime/opcodes.js";
import type { GameEventType, CompiledProgram, StateSlot, RobotClass } from "../shared/types.js";
import { LANGUAGE_VERSION } from "../shared/config.js";

export class CompileError extends Error {
  constructor(message: string, public line: number, public column: number) {
    super(`Compile error at ${line}:${column}: ${message}`);
  }
}

interface LocalVar {
  name: string;
  slot: number;
  depth: number;
}

class ChunkBuilder {
  code: number[] = [];
  constants: ConstPoolEntry[] = [];
  locals: LocalVar[] = [];
  localCount = 0;
  scopeDepth = 0;
  sourceMap = new Map<number, { line: number; column: number }>();

  emit(op: Op, line = 0, column = 0): number {
    const offset = this.code.length;
    this.code.push(op);
    if (line > 0) this.sourceMap.set(offset, { line, column });
    return offset;
  }

  emitWithOperand(op: Op, operand: number, line = 0, column = 0): number {
    const offset = this.emit(op, line, column);
    // Encode operand as 2 bytes (big-endian)
    this.code.push((operand >> 8) & 0xff);
    this.code.push(operand & 0xff);
    return offset;
  }

  addConstant(entry: ConstPoolEntry): number {
    // Dedup constants
    for (let i = 0; i < this.constants.length; i++) {
      const c = this.constants[i];
      if (c.type === entry.type) {
        if (c.type === "null") return i;
        if ("value" in c && "value" in entry && c.value === entry.value) return i;
      }
    }
    this.constants.push(entry);
    return this.constants.length - 1;
  }

  /** Emit a placeholder jump, returns the offset to patch later */
  emitJump(op: Op): number {
    const offset = this.code.length;
    this.code.push(op, 0, 0);
    return offset;
  }

  /** Patch a previously emitted jump to point to current position */
  patchJump(offset: number): void {
    const target = this.code.length;
    this.code[offset + 1] = (target >> 8) & 0xff;
    this.code[offset + 2] = target & 0xff;
  }

  declareLocal(name: string): number {
    const slot = this.localCount++;
    this.locals.push({ name, slot, depth: this.scopeDepth });
    return slot;
  }

  resolveLocal(name: string): number | null {
    for (let i = this.locals.length - 1; i >= 0; i--) {
      if (this.locals[i].name === name) return this.locals[i].slot;
    }
    return null;
  }

  beginScope(): void {
    this.scopeDepth++;
  }

  endScope(): void {
    while (this.locals.length > 0 && this.locals[this.locals.length - 1].depth === this.scopeDepth) {
      this.locals.pop();
    }
    this.scopeDepth--;
  }

  toChunk(): BytecodeChunk {
    return {
      code: this.code,
      constants: this.constants,
      localCount: this.localCount,
      sourceMap: this.sourceMap,
    };
  }
}

export interface CompilerOutput {
  program: CompiledProgram;
  constants: ConstPoolEntry[];
}

export class Compiler {
  private stateSlots: StateSlot[] = [];
  private stateIndexMap = new Map<string, number>();
  private constMap = new Map<string, number>(); // const name -> constant pool index
  private functionOffsets = new Map<string, number>();

  compile(program: ProgramNode): CompilerOutput {
    const builder = new ChunkBuilder();

    // Register state slots
    if (program.state) {
      for (const entry of program.state.entries) {
        const idx = this.stateSlots.length;
        this.stateSlots.push({
          name: entry.name,
          type: entry.type.name + (entry.type.nullable ? "?" : ""),
          initialValue: this.evaluateConstantExpr(entry.initialValue),
        });
        this.stateIndexMap.set(entry.name, idx);
      }
    }

    // Register constants in the constant pool
    if (program.constants) {
      for (const entry of program.constants.entries) {
        const val = this.evaluateConstantExpr(entry.value);
        let constIdx: number;
        if (typeof val === "number") {
          constIdx = builder.addConstant({ type: "number", value: val });
        } else if (typeof val === "string") {
          constIdx = builder.addConstant({ type: "string", value: val });
        } else if (typeof val === "boolean") {
          constIdx = builder.addConstant({ type: "boolean", value: val });
        } else {
          constIdx = builder.addConstant({ type: "null" });
        }
        this.constMap.set(entry.name, constIdx);
      }
    }

    // Two-pass function compilation for forward references:
    // Pass 1: Compile all functions first so their offsets are known
    const functions = new Map<string, number>();
    for (const fn of program.functions) {
      const offset = builder.code.length;
      functions.set(fn.name, offset);
      this.functionOffsets.set(fn.name, offset);
      this.compileFunction(fn, builder);
    }

    // Pass 2: Compile event handlers (can now reference any function)
    const eventHandlers = new Map<GameEventType, number>();
    for (const handler of program.handlers) {
      const offset = builder.code.length;
      eventHandlers.set(handler.event as GameEventType, offset);
      this.compileEventHandler(handler, builder);
      builder.emit(Op.RETURN);
    }

    builder.emit(Op.HALT);

    // Determine robot class from meta
    let robotClass: RobotClass = "ranger";
    if (program.meta) {
      const classEntry = program.meta.entries.find(e => e.key === "class");
      if (classEntry) robotClass = classEntry.value as RobotClass;
    }

    const chunk = builder.toChunk();

    return {
      program: {
        programId: `prog_${Date.now()}`,
        sourceHash: "",
        languageVersion: LANGUAGE_VERSION,
        robotName: program.robot.name,
        robotClass,
        bytecode: new Uint8Array(chunk.code),
        stateSlots: this.stateSlots,
        eventHandlers,
        functions,
      },
      constants: chunk.constants,
    };
  }

  private compileEventHandler(handler: EventHandlerNode, b: ChunkBuilder): void {
    b.beginScope();
    if (handler.param) {
      const slot = b.declareLocal(handler.param);
      // Pop the event parameter (pushed by the VM) into the local slot
      b.emitWithOperand(Op.STORE_LOCAL, slot);
    }
    this.compileStatements(handler.body, b);
    b.endScope();
  }

  private compileFunction(fn: FunctionDeclNode, b: ChunkBuilder): void {
    b.beginScope();
    // Declare local slots for parameters
    const paramSlots: number[] = [];
    for (const param of fn.params) {
      paramSlots.push(b.declareLocal(param.name));
    }
    // Pop caller-pushed arguments into parameter slots (reverse order since stack is LIFO)
    for (let i = paramSlots.length - 1; i >= 0; i--) {
      b.emitWithOperand(Op.STORE_LOCAL, paramSlots[i]);
    }
    this.compileStatements(fn.body, b);
    b.emit(Op.RETURN);
    b.endScope();
  }

  private compileStatements(stmts: Statement[], b: ChunkBuilder): void {
    for (const stmt of stmts) {
      this.compileStatement(stmt, b);
    }
  }

  private compileStatement(stmt: Statement, b: ChunkBuilder): void {
    switch (stmt.kind) {
      case "LetStatement": {
        this.compileExpression(stmt.value, b);
        const slot = b.declareLocal(stmt.name);
        b.emitWithOperand(Op.STORE_LOCAL, slot, stmt.span.line, stmt.span.column);
        break;
      }

      case "SetStatement": {
        this.compileExpression(stmt.value, b);
        const stateIdx = this.stateIndexMap.get(stmt.name);
        if (stateIdx === undefined) {
          throw new CompileError(`Unknown state variable '${stmt.name}'`, stmt.span.line, stmt.span.column);
        }
        b.emitWithOperand(Op.STORE_STATE, stateIdx, stmt.span.line, stmt.span.column);
        break;
      }

      case "IfStatement": {
        this.compileExpression(stmt.condition, b);
        const jumpToElse = b.emitJump(Op.JMP_IF_FALSE);
        b.beginScope();
        this.compileStatements(stmt.thenBranch, b);
        b.endScope();

        if (stmt.elseIfBranches.length > 0 || stmt.elseBranch) {
          // Collect all jumps-to-end so we can patch them after the full chain
          const endJumps: number[] = [];
          endJumps.push(b.emitJump(Op.JMP));
          b.patchJump(jumpToElse);

          for (let i = 0; i < stmt.elseIfBranches.length; i++) {
            const branch = stmt.elseIfBranches[i];
            this.compileExpression(branch.condition, b);
            const jumpNext = b.emitJump(Op.JMP_IF_FALSE);
            b.beginScope();
            this.compileStatements(branch.body, b);
            b.endScope();
            endJumps.push(b.emitJump(Op.JMP));
            b.patchJump(jumpNext);
          }

          if (stmt.elseBranch) {
            b.beginScope();
            this.compileStatements(stmt.elseBranch, b);
            b.endScope();
          }

          // Patch all end-jumps to point here (after the entire if/else chain)
          for (const jump of endJumps) {
            b.patchJump(jump);
          }
        } else {
          b.patchJump(jumpToElse);
        }
        break;
      }

      case "ForStatement": {
        // Compile iterable, then iterate
        this.compileExpression(stmt.iterable, b);
        b.emit(Op.ITER_START);
        const loopStart = b.code.length;
        const exitJump = b.emitJump(Op.ITER_NEXT);

        b.beginScope();
        const slot = b.declareLocal(stmt.variable);
        b.emitWithOperand(Op.STORE_LOCAL, slot);
        this.compileStatements(stmt.body, b);
        b.endScope();

        // Jump back to loop start
        b.emitWithOperand(Op.JMP, loopStart);
        b.patchJump(exitJump);
        b.emit(Op.ITER_END);
        break;
      }

      case "ReturnStatement": {
        if (stmt.value) {
          this.compileExpression(stmt.value, b);
          b.emit(Op.RETURN_VAL, stmt.span.line, stmt.span.column);
        } else {
          b.emit(Op.RETURN, stmt.span.line, stmt.span.column);
        }
        break;
      }

      case "ActionStatement": {
        // Push action name as string constant
        const nameIdx = b.addConstant({ type: "string", value: stmt.action });
        b.emitWithOperand(Op.CONST_STR, nameIdx, stmt.span.line, stmt.span.column);
        // Push arguments
        for (const arg of stmt.args) {
          this.compileExpression(arg, b);
        }
        // Emit action with arg count
        b.emitWithOperand(Op.ACTION, stmt.args.length);
        break;
      }

      case "ExpressionStatement": {
        this.compileExpression(stmt.expression, b);
        b.emit(Op.POP); // discard result
        break;
      }
    }
  }

  private compileExpression(expr: Expression, b: ChunkBuilder): void {
    switch (expr.kind) {
      case "NumberLiteral": {
        const idx = b.addConstant({ type: "number", value: expr.value });
        b.emitWithOperand(Op.CONST_NUM, idx, expr.span.line, expr.span.column);
        break;
      }

      case "StringLiteral": {
        const idx = b.addConstant({ type: "string", value: expr.value });
        b.emitWithOperand(Op.CONST_STR, idx, expr.span.line, expr.span.column);
        break;
      }

      case "BooleanLiteral":
        b.emitWithOperand(Op.CONST_BOOL, expr.value ? 1 : 0, expr.span.line, expr.span.column);
        break;

      case "NullLiteral":
        b.emit(Op.CONST_NULL, expr.span.line, expr.span.column);
        break;

      case "Identifier": {
        // Check local first
        const local = b.resolveLocal(expr.name);
        if (local !== null) {
          b.emitWithOperand(Op.LOAD_LOCAL, local, expr.span.line, expr.span.column);
          break;
        }
        // Check state
        const stateIdx = this.stateIndexMap.get(expr.name);
        if (stateIdx !== undefined) {
          b.emitWithOperand(Op.LOAD_STATE, stateIdx, expr.span.line, expr.span.column);
          break;
        }
        // Check constants
        const constIdx = this.constMap.get(expr.name);
        if (constIdx !== undefined) {
          b.emitWithOperand(Op.LOAD_CONST, constIdx, expr.span.line, expr.span.column);
          break;
        }
        throw new CompileError(`Unresolved identifier '${expr.name}'`, expr.span.line, expr.span.column);
      }

      case "BinaryExpr": {
        this.compileExpression(expr.left, b);
        this.compileExpression(expr.right, b);
        const opMap: Record<string, Op> = {
          "+": Op.ADD, "-": Op.SUB, "*": Op.MUL, "/": Op.DIV, "%": Op.MOD,
          "and": Op.AND, "or": Op.OR,
        };
        b.emit(opMap[expr.operator], expr.span.line, expr.span.column);
        break;
      }

      case "UnaryExpr": {
        this.compileExpression(expr.operand, b);
        if (expr.operator === "-") b.emit(Op.NEG, expr.span.line, expr.span.column);
        else b.emit(Op.NOT, expr.span.line, expr.span.column);
        break;
      }

      case "ComparisonExpr": {
        this.compileExpression(expr.left, b);
        this.compileExpression(expr.right, b);
        const compMap: Record<string, Op> = {
          "==": Op.EQ, "!=": Op.NEQ, "<": Op.LT, "<=": Op.LTE, ">": Op.GT, ">=": Op.GTE,
        };
        b.emit(compMap[expr.operator], expr.span.line, expr.span.column);
        break;
      }

      case "CallExpr": {
        // Push arguments
        for (const arg of expr.args) {
          this.compileExpression(arg, b);
        }
        // Check if it's a user function or built-in
        if (this.functionOffsets.has(expr.callee)) {
          b.emitWithOperand(Op.CALL, this.functionOffsets.get(expr.callee)!, expr.span.line, expr.span.column);
        } else {
          // Built-in call — encode name as constant
          const nameIdx = b.addConstant({ type: "string", value: expr.callee });
          b.emitWithOperand(Op.CALL_BUILTIN, nameIdx, expr.span.line, expr.span.column);
          // arg count follows
          b.code.push(expr.args.length);
        }
        break;
      }

      case "MemberExpr": {
        this.compileExpression(expr.object, b);
        const propIdx = b.addConstant({ type: "string", value: expr.property });
        b.emitWithOperand(Op.GET_MEMBER, propIdx, expr.span.line, expr.span.column);
        break;
      }
    }
  }

  private evaluateConstantExpr(expr: Expression): unknown {
    switch (expr.kind) {
      case "NumberLiteral": return expr.value;
      case "StringLiteral": return expr.value;
      case "BooleanLiteral": return expr.value;
      case "NullLiteral": return null;
      default: return null;
    }
  }
}

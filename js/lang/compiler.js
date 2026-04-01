// ============================================================================
// ArenaScript Compiler — AST → Bytecode
// ============================================================================

import { Op } from "../runtime/opcodes.js";
import { LANGUAGE_VERSION } from "../shared/config.js";

export class CompileError extends Error {
  constructor(message, line, column) {
    super(`Compile error at ${line}:${column}: ${message}`);
    this.line = line;
    this.column = column;
  }
}

class ChunkBuilder {
  code = [];
  constants = [];
  locals = [];
  localCount = 0;
  scopeDepth = 0;
  sourceMap = new Map();

  emit(op, line = 0, column = 0) {
    const offset = this.code.length;
    this.code.push(op);
    if (line > 0) this.sourceMap.set(offset, { line, column });
    return offset;
  }

  emitWithOperand(op, operand, line = 0, column = 0) {
    const offset = this.emit(op, line, column);
    // Encode operand as 2 bytes (big-endian)
    this.code.push((operand >> 8) & 0xff);
    this.code.push(operand & 0xff);
    return offset;
  }

  addConstant(entry) {
    // Dedup constants
    for (let i = 0; i < this.constants.length; i++) {
      const c = this.constants[i];
      if (c.type === entry.type) {
        if (c.type === "null") return i;
        if ("value" in c && "value" in entry && c.value === entry.value) return i;
      }
    }
    if (this.constants.length >= 0xFFFF) {
      throw new Error("Constant pool overflow: program exceeds 65535 constants");
    }
    this.constants.push(entry);
    return this.constants.length - 1;
  }

  /** Emit a placeholder jump, returns the offset to patch later */
  emitJump(op) {
    const offset = this.code.length;
    this.code.push(op, 0, 0);
    return offset;
  }

  /** Patch a previously emitted jump to point to current position */
  patchJump(offset) {
    const target = this.code.length;
    this.code[offset + 1] = (target >> 8) & 0xff;
    this.code[offset + 2] = target & 0xff;
  }

  declareLocal(name) {
    const slot = this.localCount++;
    this.locals.push({ name, slot, depth: this.scopeDepth });
    return slot;
  }

  resolveLocal(name) {
    for (let i = this.locals.length - 1; i >= 0; i--) {
      if (this.locals[i].name === name) return this.locals[i].slot;
    }
    return null;
  }

  beginScope() {
    this.scopeDepth++;
  }

  endScope() {
    while (this.locals.length > 0 && this.locals[this.locals.length - 1].depth === this.scopeDepth) {
      this.locals.pop();
    }
    this.scopeDepth--;
  }

  toChunk() {
    return {
      code: this.code,
      constants: this.constants,
      localCount: this.localCount,
      sourceMap: this.sourceMap,
    };
  }
}

export class Compiler {
  #stateSlots = [];
  #stateIndexMap = new Map();
  #constMap = new Map();
  #functionOffsets = new Map();
  #userFunctionNames = new Set();
  #pendingCalls = [];

  #reset() {
    this.#stateSlots = [];
    this.#stateIndexMap = new Map();
    this.#constMap = new Map();
    this.#functionOffsets = new Map();
    this.#userFunctionNames = new Set();
    this.#pendingCalls = [];
  }

  compile(program) {
    this.#reset();
    const builder = new ChunkBuilder();

    // Register state slots
    if (program.state) {
      for (const entry of program.state.entries) {
        const idx = this.#stateSlots.length;
        this.#stateSlots.push({
          name: entry.name,
          type: entry.type.name + (entry.type.nullable ? "?" : ""),
          initialValue: this.#evaluateConstantExpr(entry.initialValue),
        });
        this.#stateIndexMap.set(entry.name, idx);
      }
    }

    // Register constants in the constant pool
    if (program.constants) {
      for (const entry of program.constants.entries) {
        const val = this.#evaluateConstantExpr(entry.value);
        let constIdx;
        if (typeof val === "number") {
          constIdx = builder.addConstant({ type: "number", value: val });
        } else if (typeof val === "string") {
          constIdx = builder.addConstant({ type: "string", value: val });
        } else if (typeof val === "boolean") {
          constIdx = builder.addConstant({ type: "boolean", value: val });
        } else {
          constIdx = builder.addConstant({ type: "null" });
        }
        this.#constMap.set(entry.name, constIdx);
      }
    }

    // Pre-register all function names so forward references resolve correctly
    for (const fn of program.functions) {
      this.#userFunctionNames.add(fn.name);
    }

    // Compile all functions, recording their bytecode offsets
    const functions = new Map();
    for (const fn of program.functions) {
      const offset = builder.code.length;
      functions.set(fn.name, offset);
      this.#functionOffsets.set(fn.name, offset);
      this.#compileFunction(fn, builder);
    }

    // Back-patch any forward function references
    for (const pending of this.#pendingCalls) {
      const target = this.#functionOffsets.get(pending.name);
      if (target !== undefined) {
        builder.code[pending.offset + 1] = (target >> 8) & 0xff;
        builder.code[pending.offset + 2] = target & 0xff;
      }
    }

    // Compile event handlers (can now reference any function)
    const eventHandlers = new Map();
    for (const handler of program.handlers) {
      const offset = builder.code.length;
      eventHandlers.set(handler.event, offset);
      this.#compileEventHandler(handler, builder);
      builder.emit(Op.RETURN);
    }

    builder.emit(Op.HALT);

    // Determine robot class from meta
    let robotClass = "ranger";
    if (program.meta) {
      const classEntry = program.meta.entries.find(e => e.key === "class");
      if (classEntry) robotClass = classEntry.value;
    }

    const chunk = builder.toChunk();
    const squadSizeRaw = program.squad?.size !== undefined ? Number(program.squad.size) : 1;
    const squadSize = Number.isInteger(squadSizeRaw) ? squadSizeRaw : 1;
    const squadRoles = Array.isArray(program.squad?.roles) ? program.squad.roles : [];

    return {
      program: {
        programId: `prog_${Date.now()}`,
        sourceHash: "",
        languageVersion: LANGUAGE_VERSION,
        robotName: program.robot.name,
        robotClass,
        bytecode: new Uint8Array(chunk.code),
        stateSlots: this.#stateSlots,
        eventHandlers,
        functions,
        localWindowSize: chunk.localCount,
        squad: {
          size: squadSize,
          roles: squadRoles,
        },
      },
      constants: chunk.constants,
    };
  }

  #compileEventHandler(handler, b) {
    b.beginScope();
    if (handler.param) {
      const slot = b.declareLocal(handler.param);
      // Pop the event parameter (pushed by the VM) into the local slot
      b.emitWithOperand(Op.STORE_LOCAL, slot);
    }
    this.#compileStatements(handler.body, b);
    b.endScope();
  }

  #compileFunction(fn, b) {
    b.beginScope();
    // Declare local slots for parameters
    const paramSlots = [];
    for (const param of fn.params) {
      paramSlots.push(b.declareLocal(param.name));
    }
    // Pop caller-pushed arguments into parameter slots (reverse order since stack is LIFO)
    for (let i = paramSlots.length - 1; i >= 0; i--) {
      b.emitWithOperand(Op.STORE_LOCAL, paramSlots[i]);
    }
    this.#compileStatements(fn.body, b);
    b.emit(Op.RETURN);
    b.endScope();
  }

  #compileStatements(stmts, b) {
    for (const stmt of stmts) {
      this.#compileStatement(stmt, b);
    }
  }

  #compileStatement(stmt, b) {
    switch (stmt.kind) {
      case "LetStatement": {
        this.#compileExpression(stmt.value, b);
        const slot = b.declareLocal(stmt.name);
        b.emitWithOperand(Op.STORE_LOCAL, slot, stmt.span.line, stmt.span.column);
        break;
      }

      case "SetStatement": {
        this.#compileExpression(stmt.value, b);
        const stateIdx = this.#stateIndexMap.get(stmt.name);
        if (stateIdx === undefined) {
          throw new CompileError(`Unknown state variable '${stmt.name}'`, stmt.span.line, stmt.span.column);
        }
        b.emitWithOperand(Op.STORE_STATE, stateIdx, stmt.span.line, stmt.span.column);
        break;
      }

      case "IfStatement": {
        this.#compileExpression(stmt.condition, b);
        const jumpToElse = b.emitJump(Op.JMP_IF_FALSE);
        b.beginScope();
        this.#compileStatements(stmt.thenBranch, b);
        b.endScope();

        if (stmt.elseIfBranches.length > 0 || stmt.elseBranch) {
          // Collect all jumps-to-end so we can patch them after the full chain
          const endJumps = [];
          endJumps.push(b.emitJump(Op.JMP));
          b.patchJump(jumpToElse);

          for (let i = 0; i < stmt.elseIfBranches.length; i++) {
            const branch = stmt.elseIfBranches[i];
            this.#compileExpression(branch.condition, b);
            const jumpNext = b.emitJump(Op.JMP_IF_FALSE);
            b.beginScope();
            this.#compileStatements(branch.body, b);
            b.endScope();
            endJumps.push(b.emitJump(Op.JMP));
            b.patchJump(jumpNext);
          }

          if (stmt.elseBranch) {
            b.beginScope();
            this.#compileStatements(stmt.elseBranch, b);
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
        this.#compileExpression(stmt.iterable, b);
        b.emit(Op.ITER_START);
        const loopStart = b.code.length;
        const exitJump = b.emitJump(Op.ITER_NEXT);

        b.beginScope();
        const slot = b.declareLocal(stmt.variable);
        b.emitWithOperand(Op.STORE_LOCAL, slot);
        this.#compileStatements(stmt.body, b);
        b.endScope();

        // Jump back to loop start
        b.emitWithOperand(Op.JMP, loopStart);
        b.patchJump(exitJump);
        b.emit(Op.ITER_END);
        break;
      }

      case "ReturnStatement": {
        if (stmt.value) {
          this.#compileExpression(stmt.value, b);
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
          this.#compileExpression(arg, b);
        }
        // Emit action with arg count
        b.emitWithOperand(Op.ACTION, stmt.args.length);
        break;
      }

      case "ExpressionStatement": {
        this.#compileExpression(stmt.expression, b);
        b.emit(Op.POP); // discard result
        break;
      }
    }
  }

  #compileExpression(expr, b) {
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
        const stateIdx = this.#stateIndexMap.get(expr.name);
        if (stateIdx !== undefined) {
          b.emitWithOperand(Op.LOAD_STATE, stateIdx, expr.span.line, expr.span.column);
          break;
        }
        // Check constants
        const constIdx = this.#constMap.get(expr.name);
        if (constIdx !== undefined) {
          b.emitWithOperand(Op.LOAD_CONST, constIdx, expr.span.line, expr.span.column);
          break;
        }
        throw new CompileError(`Unresolved identifier '${expr.name}'`, expr.span.line, expr.span.column);
      }

      case "BinaryExpr": {
        if (expr.operator === "and") {
          // Short-circuit: if left is falsy, skip right entirely
          this.#compileExpression(expr.left, b);
          b.emit(Op.DUP);
          const skipRight = b.emitJump(Op.JMP_IF_FALSE);
          b.emit(Op.POP); // discard truthy left value
          this.#compileExpression(expr.right, b);
          b.patchJump(skipRight);
          break;
        }
        if (expr.operator === "or") {
          // Short-circuit: if left is truthy, skip right entirely
          this.#compileExpression(expr.left, b);
          b.emit(Op.DUP);
          const skipRight = b.emitJump(Op.JMP_IF_TRUE);
          b.emit(Op.POP); // discard falsy left value
          this.#compileExpression(expr.right, b);
          b.patchJump(skipRight);
          break;
        }
        this.#compileExpression(expr.left, b);
        this.#compileExpression(expr.right, b);
        const opMap = {
          "+": Op.ADD, "-": Op.SUB, "*": Op.MUL, "/": Op.DIV, "%": Op.MOD,
        };
        b.emit(opMap[expr.operator], expr.span.line, expr.span.column);
        break;
      }

      case "UnaryExpr": {
        this.#compileExpression(expr.operand, b);
        if (expr.operator === "-") b.emit(Op.NEG, expr.span.line, expr.span.column);
        else b.emit(Op.NOT, expr.span.line, expr.span.column);
        break;
      }

      case "ComparisonExpr": {
        this.#compileExpression(expr.left, b);
        this.#compileExpression(expr.right, b);
        const compMap = {
          "==": Op.EQ, "!=": Op.NEQ, "<": Op.LT, "<=": Op.LTE, ">": Op.GT, ">=": Op.GTE,
        };
        b.emit(compMap[expr.operator], expr.span.line, expr.span.column);
        break;
      }

      case "CallExpr": {
        // Push arguments
        for (const arg of expr.args) {
          this.#compileExpression(arg, b);
        }
        // Check if it's a user function (already compiled or forward reference) or built-in
        if (this.#functionOffsets.has(expr.callee)) {
          b.emitWithOperand(Op.CALL, this.#functionOffsets.get(expr.callee), expr.span.line, expr.span.column);
        } else if (this.#userFunctionNames.has(expr.callee)) {
          // Forward reference — emit placeholder CALL, will be back-patched
          const offset = b.emitWithOperand(Op.CALL, 0, expr.span.line, expr.span.column);
          this.#pendingCalls.push({ offset, name: expr.callee });
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
        this.#compileExpression(expr.object, b);
        const propIdx = b.addConstant({ type: "string", value: expr.property });
        b.emitWithOperand(Op.GET_MEMBER, propIdx, expr.span.line, expr.span.column);
        break;
      }
    }
  }

  #evaluateConstantExpr(expr) {
    switch (expr.kind) {
      case "NumberLiteral": return expr.value;
      case "StringLiteral": return expr.value;
      case "BooleanLiteral": return expr.value;
      case "NullLiteral": return null;
      case "UnaryExpr": {
        const operand = this.#evaluateConstantExpr(expr.operand);
        if (expr.operator === "-" && typeof operand === "number") return -operand;
        if (expr.operator === "not") return !operand;
        return null;
      }
      case "BinaryExpr": {
        const left = this.#evaluateConstantExpr(expr.left);
        const right = this.#evaluateConstantExpr(expr.right);
        if (typeof left === "number" && typeof right === "number") {
          switch (expr.operator) {
            case "+": return left + right;
            case "-": return left - right;
            case "*": return left * right;
            case "/": return right !== 0 ? left / right : 0;
            case "%": return right !== 0 ? left % right : 0;
          }
        }
        if (typeof left === "string" && typeof right === "string" && expr.operator === "+") {
          return left + right;
        }
        return null;
      }
      case "ComparisonExpr": {
        const left = this.#evaluateConstantExpr(expr.left);
        const right = this.#evaluateConstantExpr(expr.right);
        if (left === null || right === null) return null;
        switch (expr.operator) {
          case "==": return left === right;
          case "!=": return left !== right;
          case "<": return left < right;
          case "<=": return left <= right;
          case ">": return left > right;
          case ">=": return left >= right;
        }
        return null;
      }
      default: return null;
    }
  }
}

// ============================================================================
// ArenaScript VM — Stack-based bytecode interpreter
// ============================================================================

import { Op } from "./opcodes.js";
import { ExecutionBudget, BudgetExceededError } from "./budget.js";

export class VM {
  static MAX_STACK_DEPTH = 1024;
  static MAX_CALL_DEPTH = 64;

  constructor(program, robotId, sensorGateway) {
    this.program = program;
    this.bytecode = program.bytecode;
    this.constants = []; // Set via setConstants() after construction
    this.robotId = robotId;
    this.sensorGateway = sensorGateway;
    this.budget = new ExecutionBudget();

    this.ip = 0;
    this.stack = [];
    this.callStack = [];
    this.actions = [];
    this.iterStack = [];
    this.timers = []; // { triggerTick, bodyOffset, repeat, interval }
    this.currentTick = 0;

    // Initialize state slots with default values
    this.stateSlots = program.stateSlots.map(s => s.initialValue);
    this.locals = new Array(256).fill(null);
    this.localBase = 0;
  }

  /** Execute an event handler */
  executeEvent(eventType, event, currentTick) {
    if (currentTick !== undefined) this.currentTick = currentTick;

    const offset = this.program.eventHandlers.get(eventType);
    if (offset === undefined) {
      return { actions: [], budgetExceeded: false };
    }

    this.ip = offset;
    this.stack = [];
    this.actions = [];
    this.budget.reset();
    this.callStack = [];
    this.iterStack = [];
    this.localBase = 0;

    // Push event data onto the stack for handlers that declare a parameter
    // The compiled handler will pop it into a local slot via STORE_LOCAL
    if (event) {
      this.stack.push(this.eventToVMObject(event));
    }

    return this.run();
  }

  run() {
    let budgetExceeded = false;
    let error;

    try {
      while (this.ip < this.bytecode.length) {
        this.budget.tick();
        const op = this.bytecode[this.ip++];

        switch (op) {
          case Op.CONST_NUM: {
            const idx = this.readU16();
            const c = this.constants[idx];
            this.push(c && c.type === "number" ? c.value : 0);
            break;
          }

          case Op.CONST_STR: {
            const idx = this.readU16();
            const c = this.constants[idx];
            this.push(c && c.type === "string" ? c.value : "");
            break;
          }

          case Op.CONST_BOOL: {
            const val = this.readU16();
            this.push(val !== 0);
            break;
          }

          case Op.CONST_NULL:
            this.push(null);
            break;

          case Op.LOAD_LOCAL: {
            const slot = this.localBase + this.readU16();
            if (slot >= this.locals.length) {
              throw new Error(`Local slot ${slot} out of bounds (max ${this.locals.length - 1})`);
            }
            this.budget.memoryOp();
            this.push(this.locals[slot]);
            break;
          }

          case Op.STORE_LOCAL: {
            const slot = this.localBase + this.readU16();
            if (slot >= this.locals.length) {
              throw new Error(`Local slot ${slot} out of bounds (max ${this.locals.length - 1})`);
            }
            this.budget.memoryOp();
            this.locals[slot] = this.pop();
            break;
          }

          case Op.LOAD_STATE: {
            const idx = this.readU16();
            this.budget.memoryOp();
            this.push(this.stateSlots[idx]);
            break;
          }

          case Op.STORE_STATE: {
            const idx = this.readU16();
            this.budget.memoryOp();
            this.stateSlots[idx] = this.pop();
            break;
          }

          case Op.LOAD_CONST: {
            const idx = this.readU16();
            const c = this.constants[idx];
            if (!c) { this.push(null); break; }
            if (c.type === "null") this.push(null);
            else this.push(c.value);
            break;
          }

          // Arithmetic
          case Op.ADD: { const b = this.popNum(); const a = this.popNum(); this.push(a + b); break; }
          case Op.SUB: { const b = this.popNum(); const a = this.popNum(); this.push(a - b); break; }
          case Op.MUL: { const b = this.popNum(); const a = this.popNum(); this.push(a * b); break; }
          case Op.DIV: { const b = this.popNum(); const a = this.popNum(); this.push(b !== 0 ? a / b : 0); break; }
          case Op.MOD: { const b = this.popNum(); const a = this.popNum(); this.push(b !== 0 ? a % b : 0); break; }
          case Op.NEG: { this.push(-this.popNum()); break; }

          // Comparison
          case Op.EQ:  { const b = this.pop(); const a = this.pop(); this.push(a === b); break; }
          case Op.NEQ: { const b = this.pop(); const a = this.pop(); this.push(a !== b); break; }
          case Op.LT:  { const b = this.popNum(); const a = this.popNum(); this.push(a < b); break; }
          case Op.LTE: { const b = this.popNum(); const a = this.popNum(); this.push(a <= b); break; }
          case Op.GT:  { const b = this.popNum(); const a = this.popNum(); this.push(a > b); break; }
          case Op.GTE: { const b = this.popNum(); const a = this.popNum(); this.push(a >= b); break; }

          // Logic (AND/OR opcodes are reserved but unused — compiler emits short-circuit jumps instead)
          case Op.AND: { const b = this.popBool(); const a = this.popBool(); this.push(a && b); break; }
          case Op.OR:  { const b = this.popBool(); const a = this.popBool(); this.push(a || b); break; }
          case Op.NOT: { this.push(!this.popBool()); break; }

          // Jumps
          case Op.JMP: {
            this.ip = this.readU16();
            break;
          }
          case Op.JMP_IF_FALSE: {
            const target = this.readU16();
            if (!this.isTruthy(this.pop())) this.ip = target;
            break;
          }
          case Op.JMP_IF_TRUE: {
            const target = this.readU16();
            if (this.isTruthy(this.pop())) this.ip = target;
            break;
          }

          // Functions
          case Op.CALL: {
            this.budget.callFunction();
            if (this.callStack.length >= VM.MAX_CALL_DEPTH) {
              throw new Error("Call stack overflow: maximum recursion depth exceeded");
            }
            const target = this.readU16();
            const prevBase = this.localBase;
            // Each call frame gets its own local variable window
            this.callStack.push({ returnAddress: this.ip, localBase: prevBase });
            this.localBase = prevBase + this.program.localWindowSize;
            this.ip = target;
            break;
          }

          case Op.CALL_BUILTIN: {
            this.budget.callSensor();
            const nameIdx = this.readU16();
            const argCount = this.bytecode[this.ip++];
            const nameConst = this.constants[nameIdx];
            const name = nameConst && nameConst.type === "string" ? nameConst.value : "";
            const args = [];
            for (let i = 0; i < argCount; i++) {
              args.unshift(this.pop());
            }
            const result = this.sensorGateway(this.robotId, name, args);
            this.push(result);
            break;
          }

          case Op.RETURN: {
            if (this.callStack.length > 0) {
              const frame = this.callStack.pop();
              this.ip = frame.returnAddress;
              this.localBase = frame.localBase;
            } else {
              return { actions: this.actions, budgetExceeded: false };
            }
            break;
          }

          case Op.RETURN_VAL: {
            const val = this.pop();
            if (this.callStack.length > 0) {
              const frame = this.callStack.pop();
              this.ip = frame.returnAddress;
              this.localBase = frame.localBase;
              this.push(val);
            } else {
              // At top-level (event handler) — return with value
              this.push(val);
              return { actions: this.actions, budgetExceeded: false };
            }
            break;
          }

          // Actions
          case Op.ACTION: {
            const argCount = this.readU16();
            const args = [];
            for (let i = 0; i < argCount; i++) {
              args.unshift(this.pop());
            }
            const actionName = this.pop();
            this.actions.push(this.buildActionIntent(actionName, args));
            break;
          }

          // Member access
          case Op.GET_MEMBER: {
            const propIdx = this.readU16();
            const propConst = this.constants[propIdx];
            const prop = propConst && propConst.type === "string" ? propConst.value : "";
            const obj = this.pop();
            if (obj && typeof obj === "object" && !Array.isArray(obj)) {
              this.push(obj[prop] ?? null);
            } else {
              this.push(null);
            }
            break;
          }

          // Iteration
          case Op.ITER_START: {
            const list = this.pop();
            if (Array.isArray(list)) {
              this.iterStack.push({ items: list, index: 0 });
            } else {
              this.iterStack.push({ items: [], index: 0 });
            }
            break;
          }

          case Op.ITER_NEXT: {
            const target = this.readU16();
            const iter = this.iterStack[this.iterStack.length - 1];
            if (!iter || iter.index >= iter.items.length) {
              this.ip = target;
            } else {
              this.push(iter.items[iter.index]);
              iter.index++;
            }
            break;
          }

          case Op.ITER_END: {
            this.iterStack.pop();
            break;
          }

          // Timers
          case Op.SCHEDULE_ONCE: {
            const bodyEnd = this.readU16();
            const delay = Math.max(1, this.popNum());
            const bodyStart = this.ip; // body begins right after the opcode+operand
            this.timers.push({
              triggerTick: this.currentTick + delay,
              bodyOffset: bodyStart,
              repeat: false,
              interval: 0,
            });
            this.ip = bodyEnd; // skip past the body
            break;
          }

          case Op.SCHEDULE_REPEAT: {
            const bodyEnd = this.readU16();
            const interval = Math.max(1, this.popNum());
            const bodyStart = this.ip;
            this.timers.push({
              triggerTick: this.currentTick + interval,
              bodyOffset: bodyStart,
              repeat: true,
              interval,
            });
            this.ip = bodyEnd;
            break;
          }

          // Stack
          case Op.POP: this.pop(); break;
          case Op.DUP: { const v = this.peek(); this.push(v); break; }

          case Op.HALT:
            return { actions: this.actions, budgetExceeded: false };

          default:
            return { actions: this.actions, budgetExceeded: false, error: `Unknown opcode: 0x${op.toString(16)}` };
        }
      }
    } catch (e) {
      if (e instanceof BudgetExceededError) {
        budgetExceeded = true;
      } else {
        error = e instanceof Error ? e.message : String(e);
      }
    }

    return { actions: this.actions, budgetExceeded, error };
  }

  // --- Stack helpers ---

  push(val) {
    if (this.stack.length >= VM.MAX_STACK_DEPTH) {
      throw new Error("Stack overflow: maximum depth exceeded");
    }
    this.stack.push(val);
  }

  pop() {
    return this.stack.pop() ?? null;
  }

  peek() {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1] : null;
  }

  popNum() {
    const v = this.pop();
    return typeof v === "number" ? v : 0;
  }

  popBool() {
    return this.isTruthy(this.pop());
  }

  isTruthy(v) {
    if (v === null || v === false || v === 0) return false;
    return true;
  }

  readU16() {
    const hi = this.bytecode[this.ip++] ?? 0;
    const lo = this.bytecode[this.ip++] ?? 0;
    return (hi << 8) | lo;
  }

  // --- Helpers ---

  buildActionIntent(actionName, args) {
    const intent = {
      robotId: this.robotId,
      type: actionName,
    };

    if (args.length > 0) {
      const arg = args[0];
      if (typeof arg === "string") {
        // String args: signal data, waypoint names, ability names, entity IDs
        if (actionName === "use_ability") {
          intent.ability = arg;
        } else if (actionName === "send_signal" || actionName === "mark_position") {
          intent.data = arg;
        } else {
          intent.target = arg;
        }
      } else if (typeof arg === "number") {
        // Numeric args (e.g. send_signal with numeric data)
        if (actionName === "send_signal") {
          intent.data = arg;
        } else {
          intent.target = arg;
        }
      } else if (arg && typeof arg === "object" && "x" in arg && "y" in arg) {
        intent.target = {
          x: Number(arg.x),
          y: Number(arg.y),
        };
      } else if (arg && typeof arg === "object" && "id" in arg) {
        intent.target = arg.id;
      } else if (arg !== null && arg !== undefined) {
        // For send_signal with any other value type
        if (actionName === "send_signal") {
          intent.data = arg;
        }
      }
    }

    return intent;
  }

  eventToVMObject(event) {
    const obj = {
      type: event.type,
      tick: event.tick,
    };
    if (event.data) {
      for (const [k, v] of Object.entries(event.data)) {
        obj[k] = v;
      }
    }
    return obj;
  }

  /** Execute any timers that have fired at the given tick */
  executeTimers(tick) {
    this.currentTick = tick;
    const allActions = [];
    const firedIndices = [];

    for (let i = 0; i < this.timers.length; i++) {
      const timer = this.timers[i];
      if (tick >= timer.triggerTick) {
        // Execute the timer body
        this.ip = timer.bodyOffset;
        this.stack = [];
        this.actions = [];
        this.budget.reset();
        this.callStack = [];
        this.iterStack = [];
        this.localBase = 0;

        const result = this.run();
        allActions.push(...result.actions);

        if (timer.repeat) {
          timer.triggerTick = tick + timer.interval;
        } else {
          firedIndices.push(i);
        }
      }
    }

    // Remove one-shot timers that fired (reverse order to preserve indices)
    for (let i = firedIndices.length - 1; i >= 0; i--) {
      this.timers.splice(firedIndices[i], 1);
    }

    return allActions;
  }

  /** Set the constant pool directly (used by the match runner) */
  setConstants(constants) {
    this.constants = constants;
  }

  /** Get current state for replay/inspection */
  getState() {
    return [...this.stateSlots];
  }
}

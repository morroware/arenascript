// ============================================================================
// ArenaScript VM — Stack-based bytecode interpreter
// ============================================================================

import { Op, type ConstPoolEntry } from "./opcodes.js";
import { ExecutionBudget, BudgetExceededError } from "./budget.js";
import type { CompiledProgram, ActionIntent, GameEvent, GameEventType, EntityId, Vec2 } from "../shared/types.js";

/** The sensor gateway function signature — provided by the simulation engine */
export type SensorGateway = (robotId: EntityId, sensorName: string, args: unknown[]) => unknown;

/** Collected action intent from a robot's execution */
export interface VMExecutionResult {
  actions: ActionIntent[];
  budgetExceeded: boolean;
  error?: string;
}

type VMValue = number | string | boolean | null | VMObject | VMValue[];

interface VMObject {
  [key: string]: VMValue;
}

interface CallFrame {
  returnAddress: number;
  baseSlot: number;
}

export class VM {
  private bytecode: Uint8Array;
  private constants: ConstPoolEntry[];
  private ip = 0;
  private stack: VMValue[] = [];
  private locals: VMValue[] = [];
  private stateSlots: VMValue[];
  private callStack: CallFrame[] = [];
  private actions: ActionIntent[] = [];
  private budget: ExecutionBudget;
  private robotId: EntityId;
  private sensorGateway: SensorGateway;
  private iterStack: Array<{ items: VMValue[]; index: number }> = [];

  constructor(
    private program: CompiledProgram,
    robotId: EntityId,
    sensorGateway: SensorGateway,
  ) {
    this.bytecode = program.bytecode;
    this.constants = this.rebuildConstants(program.bytecode);
    this.robotId = robotId;
    this.sensorGateway = sensorGateway;
    this.budget = new ExecutionBudget();

    // Initialize state slots with default values
    this.stateSlots = program.stateSlots.map(s => s.initialValue as VMValue);
    this.locals = new Array(256).fill(null);
  }

  /** Execute an event handler */
  executeEvent(eventType: GameEventType, event?: GameEvent): VMExecutionResult {
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

    // Push event data onto the stack for handlers that declare a parameter
    // The compiled handler will pop it into a local slot via STORE_LOCAL
    if (event) {
      this.stack.push(this.eventToVMObject(event));
    }

    return this.run();
  }

  private run(): VMExecutionResult {
    let budgetExceeded = false;
    let error: string | undefined;

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
            const slot = this.readU16();
            this.budget.memoryOp();
            this.push(this.locals[slot]);
            break;
          }

          case Op.STORE_LOCAL: {
            const slot = this.readU16();
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

          // Logic
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
            const target = this.readU16();
            this.callStack.push({ returnAddress: this.ip, baseSlot: 0 });
            this.ip = target;
            break;
          }

          case Op.CALL_BUILTIN: {
            this.budget.callSensor();
            const nameIdx = this.readU16();
            const argCount = this.bytecode[this.ip++];
            const nameConst = this.constants[nameIdx];
            const name = nameConst && nameConst.type === "string" ? nameConst.value : "";
            const args: unknown[] = [];
            for (let i = 0; i < argCount; i++) {
              args.unshift(this.pop());
            }
            const result = this.sensorGateway(this.robotId, name, args);
            this.push(result as VMValue);
            break;
          }

          case Op.RETURN: {
            if (this.callStack.length > 0) {
              const frame = this.callStack.pop()!;
              this.ip = frame.returnAddress;
            } else {
              return { actions: this.actions, budgetExceeded: false };
            }
            break;
          }

          case Op.RETURN_VAL: {
            const val = this.pop();
            if (this.callStack.length > 0) {
              const frame = this.callStack.pop()!;
              this.ip = frame.returnAddress;
            }
            this.push(val);
            if (this.callStack.length === 0) {
              return { actions: this.actions, budgetExceeded: false };
            }
            break;
          }

          // Actions
          case Op.ACTION: {
            const argCount = this.readU16();
            const args: VMValue[] = [];
            for (let i = 0; i < argCount; i++) {
              args.unshift(this.pop());
            }
            const actionName = this.pop() as string;
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
              this.push((obj as VMObject)[prop] ?? null);
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

  private push(val: VMValue): void {
    this.stack.push(val);
  }

  private pop(): VMValue {
    return this.stack.pop() ?? null;
  }

  private peek(): VMValue {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1] : null;
  }

  private popNum(): number {
    const v = this.pop();
    return typeof v === "number" ? v : 0;
  }

  private popBool(): boolean {
    return this.isTruthy(this.pop());
  }

  private isTruthy(v: VMValue): boolean {
    if (v === null || v === false || v === 0) return false;
    return true;
  }

  private readU16(): number {
    const hi = this.bytecode[this.ip++] ?? 0;
    const lo = this.bytecode[this.ip++] ?? 0;
    return (hi << 8) | lo;
  }

  // --- Helpers ---

  private buildActionIntent(actionName: string, args: VMValue[]): ActionIntent {
    const intent: ActionIntent = {
      robotId: this.robotId,
      type: actionName as ActionIntent["type"],
    };

    if (args.length > 0) {
      const arg = args[0];
      if (typeof arg === "string") {
        // Could be entity ID or ability name
        if (actionName === "use_ability") {
          intent.ability = arg;
        } else {
          intent.target = arg;
        }
      } else if (arg && typeof arg === "object" && "x" in arg && "y" in arg) {
        intent.target = {
          x: Number((arg as { x: unknown }).x),
          y: Number((arg as { y: unknown }).y),
        };
      } else if (arg && typeof arg === "object" && "id" in arg) {
        intent.target = (arg as { id: string }).id;
      }
    }

    return intent;
  }

  private eventToVMObject(event: GameEvent): VMObject {
    const obj: VMObject = {
      type: event.type,
      tick: event.tick,
    };
    if (event.data) {
      for (const [k, v] of Object.entries(event.data)) {
        obj[k] = v as VMValue;
      }
    }
    return obj;
  }

  /** Rebuild constant pool from bytecode — for PoC we store it alongside the program */
  private rebuildConstants(_bytecode: Uint8Array): ConstPoolEntry[] {
    // In the PoC the compiler returns the program with constants embedded.
    // We store them separately. This is a placeholder for a proper serialization format.
    return [];
  }

  /** Set the constant pool directly (used by the match runner) */
  setConstants(constants: ConstPoolEntry[]): void {
    this.constants = constants;
  }

  /** Get current state for replay/inspection */
  getState(): VMValue[] {
    return [...this.stateSlots];
  }
}

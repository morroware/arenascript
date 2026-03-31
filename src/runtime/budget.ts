// ============================================================================
// Execution Budget — Deterministic resource accounting per tick
// ============================================================================

import {
  BUDGET_INSTRUCTIONS, BUDGET_FUNCTION_CALLS,
  BUDGET_SENSOR_CALLS, BUDGET_MEMORY_OPS,
} from "../shared/config.js";

export class BudgetExceededError extends Error {
  constructor(public dimension: string) {
    super(`Budget exceeded: ${dimension}`);
  }
}

export class ExecutionBudget {
  instructions: number;
  functionCalls: number;
  sensorCalls: number;
  memoryOps: number;

  constructor(
    instructions = BUDGET_INSTRUCTIONS,
    functionCalls = BUDGET_FUNCTION_CALLS,
    sensorCalls = BUDGET_SENSOR_CALLS,
    memoryOps = BUDGET_MEMORY_OPS,
  ) {
    this.instructions = instructions;
    this.functionCalls = functionCalls;
    this.sensorCalls = sensorCalls;
    this.memoryOps = memoryOps;
  }

  tick(): void {
    this.instructions--;
    if (this.instructions <= 0) {
      throw new BudgetExceededError("instructions");
    }
  }

  callFunction(): void {
    this.functionCalls--;
    if (this.functionCalls <= 0) {
      throw new BudgetExceededError("function_calls");
    }
  }

  callSensor(): void {
    this.sensorCalls--;
    if (this.sensorCalls <= 0) {
      throw new BudgetExceededError("sensor_calls");
    }
  }

  memoryOp(): void {
    this.memoryOps--;
    if (this.memoryOps <= 0) {
      throw new BudgetExceededError("memory_ops");
    }
  }

  isExhausted(): boolean {
    return this.instructions <= 0 || this.functionCalls <= 0 ||
           this.sensorCalls <= 0 || this.memoryOps <= 0;
  }

  reset(): void {
    this.instructions = BUDGET_INSTRUCTIONS;
    this.functionCalls = BUDGET_FUNCTION_CALLS;
    this.sensorCalls = BUDGET_SENSOR_CALLS;
    this.memoryOps = BUDGET_MEMORY_OPS;
  }
}

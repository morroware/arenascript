// ============================================================================
// ArenaScript Bytecode — Instruction Set
// ============================================================================

export const Op = Object.freeze({
  // Stack operations
  CONST_NUM: 0x01,     // push number literal
  CONST_STR: 0x02,     // push string literal
  CONST_BOOL: 0x03,    // push boolean literal
  CONST_NULL: 0x04,    // push null

  // Variables
  LOAD_LOCAL: 0x10,    // push local variable
  STORE_LOCAL: 0x11,   // pop into local variable
  LOAD_STATE: 0x12,    // push state variable
  STORE_STATE: 0x13,   // pop into state variable
  LOAD_CONST: 0x14,    // push constant

  // Arithmetic
  ADD: 0x20,
  SUB: 0x21,
  MUL: 0x22,
  DIV: 0x23,
  MOD: 0x24,
  NEG: 0x25,           // unary negate

  // Comparison
  EQ: 0x30,
  NEQ: 0x31,
  LT: 0x32,
  LTE: 0x33,
  GT: 0x34,
  GTE: 0x35,

  // Logic
  AND: 0x40,
  OR: 0x41,
  NOT: 0x42,

  // Control flow
  JMP: 0x50,           // unconditional jump
  JMP_IF_FALSE: 0x51,  // pop, jump if falsy
  JMP_IF_TRUE: 0x52,   // pop, jump if truthy

  // Functions
  CALL: 0x60,          // call user function
  CALL_BUILTIN: 0x61,  // call built-in sensor/function
  RETURN: 0x62,        // return from function
  RETURN_VAL: 0x63,    // return with value

  // Actions
  ACTION: 0x70,        // submit action intent

  // Object access
  GET_MEMBER: 0x80,    // get property from object on stack

  // Iteration
  ITER_START: 0x90,    // begin bounded iteration
  ITER_NEXT: 0x91,     // advance iterator, jump if done
  ITER_END: 0x92,      // cleanup iterator

  // Stack manipulation
  POP: 0xA0,           // discard top of stack
  DUP: 0xA1,           // duplicate top of stack

  // Timers
  SCHEDULE_ONCE: 0xB0,  // pop delay, register one-shot timer with body at operand offset
  SCHEDULE_REPEAT: 0xB1, // pop interval, register repeating timer with body at operand offset

  // Program control
  HALT: 0xFF,
});

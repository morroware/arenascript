// ============================================================================
// ArenaScript Semantic Analyzer — Type checking, scope resolution, validation
// ============================================================================

const VALID_EVENTS = new Set([
  "spawn", "tick", "damaged", "enemy_seen", "enemy_lost",
  "cooldown_ready", "low_health", "destroyed",
]);

const BUILTIN_SENSORS = new Set([
  "health", "max_health", "energy", "position", "velocity", "heading", "cooldown",
  "nearest_enemy", "visible_enemies", "enemy_count_in_range",
  "nearest_ally", "visible_allies",
  "nearest_cover", "nearest_resource", "nearest_control_point",
  "nearest_enemy_control_point",
  "distance_to", "line_of_sight", "current_tick",
  "can_attack", "scan", "scan_enemies", "last_seen_enemy", "has_recent_enemy_contact",
]);

const VALID_ACTIONS = new Set([
  "move_to", "move_toward", "strafe_left", "strafe_right", "stop",
  "attack", "fire_at", "use_ability", "shield", "retreat",
  "mark_target", "capture", "ping",
]);

const VALID_TYPES = new Set([
  "number", "boolean", "string", "id", "vector", "direction",
  "robot_ref", "enemy", "ally", "projectile", "resource_node",
  "control_point", "event", "position", "list",
]);

export class SemanticAnalyzer {
  #diagnostics = [];
  #constants = new Set();
  #stateVars = new Set();
  #functions = new Map();
  #localScopes = [];

  analyze(program) {
    this.#diagnostics = [];
    this.#constants = new Set();
    this.#stateVars = new Set();
    this.#functions = new Map();
    this.#localScopes = [];

    // Validate robot declaration
    if (!program.robot.name || program.robot.name.trim() === "") {
      this.#addError("Robot name cannot be empty", program.robot.span.line, program.robot.span.column);
    }
    if (!program.robot.version) {
      this.#addError("Robot version is required", program.robot.span.line, program.robot.span.column);
    }

    // Validate meta
    if (program.meta) {
      for (const entry of program.meta.entries) {
        if (entry.key === "class") {
          const validClasses = ["brawler", "ranger", "tank", "support"];
          if (!validClasses.includes(entry.value)) {
            this.#addWarning(
              `Unknown robot class '${entry.value}'. Valid: ${validClasses.join(", ")}`,
              program.meta.span.line, program.meta.span.column,
            );
          }
        }
      }
    }

    // Register constants
    if (program.constants) {
      for (const entry of program.constants.entries) {
        if (this.#constants.has(entry.name)) {
          this.#addError(`Duplicate constant '${entry.name}'`, entry.span.line, entry.span.column);
        }
        this.#constants.add(entry.name);
      }
    }

    // Register state variables
    if (program.state) {
      for (const entry of program.state.entries) {
        if (this.#stateVars.has(entry.name) || this.#constants.has(entry.name)) {
          this.#addError(`Duplicate state variable '${entry.name}'`, entry.span.line, entry.span.column);
        }
        this.#validateType(entry.type);
        this.#stateVars.add(entry.name);
      }
    }

    // Register functions (first pass for forward references)
    for (const fn of program.functions) {
      if (this.#functions.has(fn.name) || BUILTIN_SENSORS.has(fn.name)) {
        this.#addError(`Duplicate or conflicting function name '${fn.name}'`, fn.span.line, fn.span.column);
      }
      this.#functions.set(fn.name, fn);
    }

    // Validate event handlers
    const seenEvents = new Set();
    for (const handler of program.handlers) {
      if (!VALID_EVENTS.has(handler.event)) {
        this.#addError(`Unknown event '${handler.event}'`, handler.span.line, handler.span.column);
      }
      if (seenEvents.has(handler.event)) {
        this.#addError(`Duplicate handler for event '${handler.event}'`, handler.span.line, handler.span.column);
      }
      seenEvents.add(handler.event);

      // Validate handler body
      this.#pushScope();
      if (handler.param) {
        this.#addLocal(handler.param, handler.span);
      }
      this.#validateStatements(handler.body);
      this.#popScope();
    }

    // Validate functions
    for (const fn of program.functions) {
      this.#pushScope();
      for (const param of fn.params) {
        this.#validateType(param.type);
        this.#addLocal(param.name, param.type?.span ?? fn.span);
      }
      if (fn.returnType) {
        this.#validateType(fn.returnType);
      }
      this.#validateStatements(fn.body);
      this.#popScope();
    }

    // Must have at least a tick handler
    if (!seenEvents.has("tick") && !seenEvents.has("spawn")) {
      this.#addWarning("Program has no 'tick' or 'spawn' handler", program.span.line, program.span.column);
    }

    return this.#diagnostics;
  }

  #validateStatements(stmts) {
    for (const stmt of stmts) {
      this.#validateStatement(stmt);
    }
  }

  #validateStatement(stmt) {
    switch (stmt.kind) {
      case "LetStatement":
        this.#validateExpression(stmt.value);
        this.#addLocal(stmt.name, stmt.span);
        break;

      case "SetStatement":
        if (!this.#stateVars.has(stmt.name)) {
          this.#addError(`'set' can only mutate state variables. '${stmt.name}' is not declared in state {}`, stmt.span.line, stmt.span.column);
        }
        this.#validateExpression(stmt.value);
        break;

      case "IfStatement":
        this.#validateExpression(stmt.condition);
        this.#pushScope();
        this.#validateStatements(stmt.thenBranch);
        this.#popScope();
        for (const branch of stmt.elseIfBranches) {
          this.#validateExpression(branch.condition);
          this.#pushScope();
          this.#validateStatements(branch.body);
          this.#popScope();
        }
        if (stmt.elseBranch) {
          this.#pushScope();
          this.#validateStatements(stmt.elseBranch);
          this.#popScope();
        }
        break;

      case "ForStatement":
        this.#validateExpression(stmt.iterable);
        this.#pushScope();
        this.#addLocal(stmt.variable, stmt.span);
        this.#validateStatements(stmt.body);
        this.#popScope();
        break;

      case "ReturnStatement":
        if (stmt.value) {
          this.#validateExpression(stmt.value);
        }
        break;

      case "ActionStatement":
        if (!VALID_ACTIONS.has(stmt.action)) {
          this.#addError(`Unknown action '${stmt.action}'`, stmt.span.line, stmt.span.column);
        }
        for (const arg of stmt.args) {
          this.#validateExpression(arg);
        }
        break;

      case "ExpressionStatement":
        this.#validateExpression(stmt.expression);
        break;
    }
  }

  #validateExpression(expr) {
    switch (expr.kind) {
      case "Identifier":
        if (!this.#isResolvable(expr.name)) {
          this.#addError(`Unknown identifier '${expr.name}'`, expr.span.line, expr.span.column);
        }
        break;

      case "CallExpr":
        if (!BUILTIN_SENSORS.has(expr.callee) && !this.#functions.has(expr.callee)) {
          this.#addError(`Unknown function '${expr.callee}'`, expr.span.line, expr.span.column);
        } else if (this.#functions.has(expr.callee)) {
          const fn = this.#functions.get(expr.callee);
          if (fn.params.length !== expr.args.length) {
            this.#addError(
              `Function '${expr.callee}' expects ${fn.params.length} argument(s), got ${expr.args.length}`,
              expr.span.line, expr.span.column,
            );
          }
        }
        for (const arg of expr.args) {
          this.#validateExpression(arg);
        }
        break;

      case "BinaryExpr":
        this.#validateExpression(expr.left);
        this.#validateExpression(expr.right);
        break;

      case "UnaryExpr":
        this.#validateExpression(expr.operand);
        break;

      case "ComparisonExpr":
        this.#validateExpression(expr.left);
        this.#validateExpression(expr.right);
        break;

      case "MemberExpr":
        this.#validateExpression(expr.object);
        break;

      case "NumberLiteral":
      case "StringLiteral":
      case "BooleanLiteral":
      case "NullLiteral":
        break;
    }
  }

  #validateType(type) {
    const line = type.span ? type.span.line : 0;
    const col = type.span ? type.span.column : 0;
    if (!VALID_TYPES.has(type.name)) {
      this.#addError(`Unknown type '${type.name}'`, line, col);
    }
    if (type.generic && !VALID_TYPES.has(type.generic)) {
      this.#addError(`Unknown generic type '${type.generic}'`, line, col);
    }
  }

  #isResolvable(name) {
    if (this.#constants.has(name) || this.#stateVars.has(name)) return true;
    for (let i = this.#localScopes.length - 1; i >= 0; i--) {
      if (this.#localScopes[i].has(name)) return true;
    }
    // Built-in sensors without () are also valid identifiers in some contexts
    if (BUILTIN_SENSORS.has(name)) return true;
    // User-defined function names are valid references
    if (this.#functions.has(name)) return true;
    return false;
  }

  #pushScope() {
    this.#localScopes.push(new Set());
  }

  #popScope() {
    this.#localScopes.pop();
  }

  #addLocal(name, span = null) {
    if (this.#localScopes.length > 0) {
      const scope = this.#localScopes[this.#localScopes.length - 1];
      if (scope.has(name) && span) {
        this.#addWarning(`Local '${name}' shadows an existing local in the same scope`, span.line, span.column);
      }
      scope.add(name);
    }
  }

  #addError(message, line, column) {
    this.#diagnostics.push({ severity: "error", message, line, column });
  }

  #addWarning(message, line, column) {
    this.#diagnostics.push({ severity: "warning", message, line, column });
  }
}

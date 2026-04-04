// ============================================================================
// ArenaScript Semantic Analyzer — Type checking, scope resolution, validation
// ============================================================================

const VALID_EVENTS = new Set([
  "spawn", "tick", "damaged", "enemy_seen", "enemy_lost",
  "cooldown_ready", "low_health", "destroyed",
  "signal_received",
]);

const BUILTIN_SENSORS = new Set([
  "health", "max_health", "energy", "position", "velocity", "heading", "cooldown",
  "nearest_enemy", "visible_enemies", "enemy_count_in_range",
  "nearest_ally", "visible_allies",
  "nearest_cover", "nearest_resource", "nearest_control_point",
  "nearest_enemy_control_point", "nearest_heal_zone", "nearest_hazard",
  "distance_to", "line_of_sight", "current_tick",
  "can_attack", "scan", "scan_enemies", "last_seen_enemy", "has_recent_enemy_contact",
  "enemy_visible", "random", "wall_ahead", "damage_percent",
  "team_size", "my_index", "my_role",
  "is_in_heal_zone", "is_in_hazard",
  "arena_width", "arena_height", "spawn_position",
  "discovered_count",
  // New perception sensors
  "health_percent", "angle_to", "is_facing", "enemy_heading",
  "is_enemy_facing_me", "ally_health", "kills", "time_alive",
  // Noise & signals
  "nearest_sound",
  // Mines & pickups
  "nearest_mine", "nearest_pickup",
  // Waypoint memory
  "recall_position",
  // State queries
  "is_taunted", "is_in_overwatch", "has_effect",
]);

const VALID_ACTIONS = new Set([
  "move_to", "move_toward", "strafe_left", "strafe_right", "stop",
  "attack", "fire_at", "use_ability", "shield", "retreat",
  "mark_target", "capture", "ping",
  "burst_fire", "grenade",
  "move_forward", "move_backward", "turn_left", "turn_right",
  "place_mine", "send_signal", "mark_position", "taunt", "overwatch",
]);

const VALID_TYPES = new Set([
  "number", "boolean", "string", "id", "vector", "direction",
  "robot_ref", "enemy", "ally", "projectile", "resource_node",
  "control_point", "event", "position", "list",
]);

/** Find the closest match from a set of candidates using Levenshtein distance */
function findClosestMatch(name, candidates, maxDistance = 3) {
  let best = null;
  let bestDist = maxDistance + 1;
  for (const candidate of candidates) {
    const dist = levenshtein(name.toLowerCase(), candidate.toLowerCase());
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return best;
}

function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[b.length][a.length];
}

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

    // Validate squad composition
    if (program.squad) {
      const { size, roles, span } = program.squad;
      if (size !== undefined) {
        const parsedSize = Number(size);
        if (!Number.isInteger(parsedSize) || parsedSize < 1 || parsedSize > 5) {
          this.#addError("squad.size must be an integer from 1 to 5", span.line, span.column);
        }
      }
      if (roles) {
        if (!Array.isArray(roles) || roles.length === 0) {
          this.#addError("squad.roles must contain at least one role string", span.line, span.column);
        }
        const normalized = new Set();
        for (const role of roles) {
          if (!role || role.trim() === "") {
            this.#addError("squad.roles cannot include empty strings", span.line, span.column);
          }
          if (normalized.has(role)) {
            this.#addWarning(`Duplicate squad role '${role}'`, span.line, span.column);
          }
          normalized.add(role);
        }
        if (size !== undefined && roles.length > Number(size)) {
          this.#addError("squad.roles length cannot exceed squad.size", span.line, span.column);
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
        const suggestion = findClosestMatch(handler.event, VALID_EVENTS);
        const hint = suggestion ? `. Did you mean '${suggestion}'?` : "";
        this.#addError(`Unknown event '${handler.event}'${hint}`, handler.span.line, handler.span.column);
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
          if (this.#constants.has(stmt.name)) {
            this.#addError(`Cannot mutate constant '${stmt.name}'. Constants are immutable`, stmt.span.line, stmt.span.column);
          } else {
            this.#addError(`'set' can only mutate state variables. '${stmt.name}' is not declared in state {}`, stmt.span.line, stmt.span.column);
          }
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
          const suggestion = findClosestMatch(stmt.action, VALID_ACTIONS);
          const hint = suggestion ? `. Did you mean '${suggestion}'?` : "";
          this.#addError(`Unknown action '${stmt.action}'${hint}`, stmt.span.line, stmt.span.column);
        }
        for (const arg of stmt.args) {
          this.#validateExpression(arg);
        }
        break;

      case "AfterStatement":
        this.#validateExpression(stmt.delay);
        this.#pushScope();
        this.#validateStatements(stmt.body);
        this.#popScope();
        break;

      case "EveryStatement":
        this.#validateExpression(stmt.interval);
        this.#pushScope();
        this.#validateStatements(stmt.body);
        this.#popScope();
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
          const suggestion = findClosestMatch(expr.callee, BUILTIN_SENSORS);
          const hint = suggestion ? `. Did you mean '${suggestion}'?` : "";
          this.#addError(`Unknown function '${expr.callee}'${hint}`, expr.span.line, expr.span.column);
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
      const suggestion = findClosestMatch(type.name, VALID_TYPES);
      const hint = suggestion ? `. Did you mean '${suggestion}'?` : "";
      this.#addError(`Unknown type '${type.name}'${hint}`, line, col);
    }
    if (type.generic && !VALID_TYPES.has(type.generic)) {
      const suggestion = findClosestMatch(type.generic, VALID_TYPES);
      const hint = suggestion ? `. Did you mean '${suggestion}'?` : "";
      this.#addError(`Unknown generic type '${type.generic}'${hint}`, line, col);
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

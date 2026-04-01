// ============================================================================
// Telemetry – lightweight counter & metric infrastructure
// ============================================================================

export class Telemetry {
  // --- Predefined counter names ---
  static COMPILE_SUCCESS = "compile_success";
  static COMPILE_FAILURE = "compile_failure";
  static MATCH_RUN = "match_run";
  static MATCH_ERROR = "match_error";
  static REPLAY_LOAD = "replay_load";
  static REPLAY_LOAD_FAILURE = "replay_load_failure";
  static QUEUE_JOIN = "queue_join";
  static QUEUE_ABANDON = "queue_abandon";

  // --- Predefined metric names ---
  static COMPILE_TIME_MS = "compile_time_ms";
  static MATCH_DURATION_TICKS = "match_duration_ticks";
  static QUEUE_WAIT_MS = "queue_wait_ms";

  /** @type {Telemetry | null} */
  static _instance = null;

  /**
   * Returns the singleton Telemetry instance, creating it on first call.
   * @returns {Telemetry}
   */
  static instance() {
    if (!Telemetry._instance) {
      Telemetry._instance = new Telemetry();
    }
    return Telemetry._instance;
  }

  constructor() {
    /** @type {Map<string, number>} */
    this._counters = new Map();
    /** @type {Map<string, {sum: number, count: number, min: number, max: number}>} */
    this._metrics = new Map();
  }

  /**
   * Increment a named counter by 1.
   * @param {string} counter
   */
  increment(counter) {
    this._counters.set(counter, (this._counters.get(counter) || 0) + 1);
  }

  /**
   * Record a numeric value for a metric (running sum, count, min, max).
   * @param {string} metric
   * @param {number} value
   */
  record(metric, value) {
    const existing = this._metrics.get(metric);
    if (existing) {
      existing.sum += value;
      existing.count += 1;
      if (value < existing.min) existing.min = value;
      if (value > existing.max) existing.max = value;
    } else {
      this._metrics.set(metric, { sum: value, count: 1, min: value, max: value });
    }
  }

  /**
   * Start a timer for the given label. Returns a function that, when called,
   * records the elapsed time in milliseconds under that metric.
   * @param {string} label
   * @returns {() => number} stop function – returns elapsed ms
   */
  startTimer(label) {
    const start = performance.now();
    return () => {
      const elapsed = performance.now() - start;
      this.record(label, elapsed);
      return elapsed;
    };
  }

  /**
   * Get the current value of a counter (0 if never incremented).
   * @param {string} name
   * @returns {number}
   */
  getCounter(name) {
    return this._counters.get(name) || 0;
  }

  /**
   * Get aggregated metric data, or null if no values have been recorded.
   * @param {string} name
   * @returns {{sum: number, count: number, min: number, max: number, avg: number} | null}
   */
  getMetric(name) {
    const m = this._metrics.get(name);
    if (!m) return null;
    return { sum: m.sum, count: m.count, min: m.min, max: m.max, avg: m.sum / m.count };
  }

  /**
   * Return a plain-object snapshot of all counters and metrics.
   * @returns {{counters: Record<string, number>, metrics: Record<string, {sum: number, count: number, min: number, max: number, avg: number}>}}
   */
  snapshot() {
    const counters = Object.fromEntries(this._counters);
    const metrics = {};
    for (const [name, m] of this._metrics) {
      metrics[name] = { sum: m.sum, count: m.count, min: m.min, max: m.max, avg: m.sum / m.count };
    }
    return { counters, metrics };
  }

  /**
   * Clear all counters and metrics.
   */
  reset() {
    this._counters.clear();
    this._metrics.clear();
  }
}

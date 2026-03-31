// ============================================================================
// Seeded Deterministic PRNG (xoshiro128**)
// Guarantees identical sequences for identical seeds across all platforms
// ============================================================================

export class SeededRNG {
  private s: Uint32Array;

  constructor(seed: number) {
    // Initialize state from seed using splitmix32
    this.s = new Uint32Array(4);
    let s = seed >>> 0;
    for (let i = 0; i < 4; i++) {
      s += 0x9e3779b9;
      s = s >>> 0;
      let t = s ^ (s >>> 16);
      t = Math.imul(t, 0x21f0aaad);
      t = t >>> 0;
      t = t ^ (t >>> 15);
      t = Math.imul(t, 0x735a2d97);
      t = t >>> 0;
      t = t ^ (t >>> 15);
      this.s[i] = t >>> 0;
    }
  }

  /** Returns a uint32 */
  nextU32(): number {
    const s = this.s;
    const result = Math.imul(s[1] * 5, 1) >>> 0;
    const rotl = ((result << 7) | (result >>> 25)) >>> 0;
    const final = (Math.imul(rotl, 9)) >>> 0;

    const t = (s[1] << 9) >>> 0;

    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];

    s[2] ^= t;
    s[3] = ((s[3] << 11) | (s[3] >>> 21)) >>> 0;

    return final;
  }

  /** Returns a float in [0, 1) */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  /** Returns an integer in [min, max] inclusive */
  nextInt(min: number, max: number): number {
    return min + (this.nextU32() % (max - min + 1));
  }

  /** Returns a float in [min, max) */
  nextFloat(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Shuffles an array in place (Fisher-Yates) */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.nextU32() % (i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

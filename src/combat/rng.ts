// Kleiner, deterministischer Zufallsgenerator (xorshift32).
//
// Nur 32-Bit-Ganzzahlrechnung, damit dieselbe Folge in C# entsteht:
//   uint x; x ^= x << 13; x ^= x >> 17; x ^= x << 5;
// `Math.random()` waere weder wiederholbar noch uebertragbar.

export class Rng {
  private state: number;

  constructor(seed: number) {
    // 0 ist fuer xorshift ein Fixpunkt und wuerde nur Nullen liefern.
    this.state = (seed | 0) === 0 ? 0x9e3779b9 | 0 : seed | 0;
  }

  /** Naechste Zahl als vorzeichenlose 32-Bit-Ganzzahl. */
  nextUint(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x | 0;
    return this.state >>> 0;
  }

  /** Gleichverteilt in [0, 1). */
  next(): number {
    return this.nextUint() / 4294967296;
  }

  /** Gleichverteilt in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Mittelwert plus/minus Streuung, gleichverteilt. */
  jitter(mean: number, spread: number): number {
    return mean + (this.next() * 2 - 1) * spread;
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** Waehlt einen Index nach Gewichten. -1, wenn alle Gewichte 0 sind. */
  pickWeighted(weights: readonly number[]): number {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += Math.max(0, weights[i]);
    if (total <= 0) return -1;
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= Math.max(0, weights[i]);
      if (r < 0) return i;
    }
    return weights.length - 1;
  }
}

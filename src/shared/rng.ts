export type RngState = readonly [number, number, number, number];

const encoder = new TextEncoder();

function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function fnv1a32(text: string): number {
  let h = 0x811c9dc5;
  for (const byte of encoder.encode(text)) h = Math.imul(h ^ byte, 0x01000193);
  return h >>> 0;
}

function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

export function deriveSeed(seed: number, ...names: string[]): number {
  let h = fmix32((seed >>> 0) ^ 0x9e3779b9);
  for (const name of names) h = fmix32(h ^ fnv1a32(name));
  return h;
}

export class Rng {
  #a: number;
  #b: number;
  #c: number;
  #d: number;

  constructor(seed: number) {
    const sm = splitmix32(seed);
    this.#a = sm();
    this.#b = sm();
    this.#c = sm();
    this.#d = sm();
    for (let i = 0; i < 12; i++) this.nextU32();
  }

  static fromState(state: RngState): Rng {
    const r = new Rng(0);
    [r.#a, r.#b, r.#c, r.#d] = state;
    return r;
  }

  static stream(seed: number, ...names: string[]): Rng {
    return new Rng(deriveSeed(seed, ...names));
  }

  state(): RngState {
    return [this.#a, this.#b, this.#c, this.#d];
  }

  nextU32(): number {
    const t = (((this.#a + this.#b) | 0) + this.#d) | 0;
    this.#d = (this.#d + 1) | 0;
    this.#a = this.#b ^ (this.#b >>> 9);
    this.#b = (this.#c + (this.#c << 3)) | 0;
    this.#c = (this.#c << 21) | (this.#c >>> 11);
    this.#c = (this.#c + t) | 0;
    return t >>> 0;
  }

  next(): number {
    return this.nextU32() / 4294967296;
  }

  int(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) throw new RangeError(`int(${maxExclusive})`);
    return Math.floor(this.next() * maxExclusive);
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  bool(p: number): boolean {
    return this.next() < p;
  }

  normal(mean = 0, sd = 1): number {
    const u = 1 - this.next();
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  truncNormal(mean: number, sd: number, min: number, max: number): number {
    for (let i = 0; i < 64; i++) {
      const x = this.normal(mean, sd);
      if (x >= min && x <= max) return x;
    }
    return Math.min(max, Math.max(min, mean));
  }

  lognormal(median: number, sigma: number): number {
    return median * Math.exp(this.normal(0, sigma));
  }

  gumbel(scale: number): number {
    return -scale * Math.log(-Math.log(1 - this.next() * (1 - 1e-12)));
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError("pick from empty array");
    return items[this.int(items.length)] as T;
  }

  weightedIndex(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) {
      if (!(w >= 0) || !Number.isFinite(w)) throw new RangeError(`bad weight ${w}`);
      total += w;
    }
    if (total <= 0) throw new RangeError("weights sum to zero");
    let x = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      x -= weights[i] as number;
      if (x < 0) return i;
    }
    return weights.length - 1;
  }

  shuffled<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  }
}

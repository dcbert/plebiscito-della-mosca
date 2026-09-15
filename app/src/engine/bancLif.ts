import { DEFAULT_PARAMS, type LifParams, type Pack, type RunResult, type SpikeTrain } from "./types";

/** mulberry32 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Closed-form leaky integrate-and-fire (Shiu et al. 2024 constants).
 * dv/dt = (Vrest - v + g) / τm
 * dg/dt = -g / τsyn
 *
 * WASM-shaped API: load / stimulate / run / rate / reset.
 */
export class BancLif {
  pack: Pack;
  params: LifParams;
  seed: number;
  rand: () => number;
  stimLocal: number[] = [];
  stimHz = 0;
  v: Float32Array;
  g: Float32Array;
  ref: Float32Array;
  spikes: Uint32Array;
  elapsedMs = 0;
  delayBuf: Float32Array[];
  delayLen: number;
  delayI = 0;

  static async load(opts: { pack: Pack; seed: number; params?: Partial<LifParams> }): Promise<BancLif> {
    return new BancLif(opts.pack, opts.seed, opts.params);
  }

  constructor(pack: Pack, seed: number, params?: Partial<LifParams>) {
    this.pack = pack;
    this.params = { ...DEFAULT_PARAMS, ...params };
    this.seed = seed >>> 0;
    this.rand = rng(this.seed);
    const n = pack.n;
    this.v = new Float32Array(n);
    this.g = new Float32Array(n);
    this.ref = new Float32Array(n);
    this.spikes = new Uint32Array(n);
    this.delayLen = Math.max(1, Math.round(this.params.tDelay / this.params.dt));
    this.delayBuf = Array.from({ length: this.delayLen }, () => new Float32Array(n));
    this.reset(seed);
  }

  stimulate(rootIds: Array<string | bigint>, hz: number): void {
    this.stimLocal = [];
    for (const id of rootIds) {
      const loc = this.pack.localOf.get(String(id));
      if (loc !== undefined) this.stimLocal.push(loc);
    }
    this.stimHz = hz;
  }

  reset(seed: number): void {
    this.seed = seed >>> 0;
    this.rand = rng(this.seed);
    this.v.fill(this.params.vRest);
    this.g.fill(0);
    this.ref.fill(0);
    this.spikes.fill(0);
    this.elapsedMs = 0;
    this.delayI = 0;
    for (const b of this.delayBuf) b.fill(0);
  }

  rate(rootIds: Array<string | bigint>): number[] {
    const s = Math.max(this.elapsedMs / 1000, 1e-6);
    return rootIds.map((id) => {
      const loc = this.pack.localOf.get(String(id));
      if (loc === undefined) return 0;
      return this.spikes[loc] / s;
    });
  }

  run(ms: number, watchLocal?: number[]): RunResult {
    const p = this.params;
    const pack = this.pack;
    const n = pack.n;
    const dt = p.dt;
    const steps = Math.max(1, Math.round(ms / dt));
    const tauM = p.tauM;
    const tauS = p.tauSyn;
    const k = tauS / (tauS - tauM);
    const expM = Math.exp(-dt / tauM);
    const expS = Math.exp(-dt / tauS);
    const kick = p.wSyn * p.fPoi;
    const pSpike = this.stimHz > 0 ? 1 - Math.exp(-this.stimHz * (dt / 1000)) : 0;
    const stim = this.stimLocal;
    const watch = new Set<number>(watchLocal ?? stim);
    const trainsMap = new Map<number, number[]>();
    for (const i of watch) trainsMap.set(i, []);
    const events: { local: number; t: number }[] = [];
    let nSpikes = 0;
    let nan = false;
    const vRest = p.vRest;

    for (let t = 0; t < steps; t++) {
      const timeMs = this.elapsedMs + t * dt;
      const slot = this.delayI;
      const incoming = this.delayBuf[slot];
      for (let i = 0; i < n; i++) {
        const inc = incoming[i];
        if (inc !== 0) {
          this.g[i] += inc;
          incoming[i] = 0;
        }
      }
      const deliver = incoming; // write here → read after delayLen steps

      if (pSpike > 0) {
        for (let s = 0; s < stim.length; s++) {
          if (this.rand() < pSpike) this.v[stim[s]] += kick;
        }
      }

      for (let i = 0; i < n; i++) {
        if (this.ref[i] > 0) {
          this.ref[i] -= dt;
          if (this.ref[i] < 0) this.ref[i] = 0;
        }
        const g0 = this.g[i];
        const v0 = this.v[i];
        if (g0 === 0 && v0 === vRest && this.ref[i] <= 0) continue;
        const g1 = g0 * expS;
        const v1 = vRest + (v0 - vRest - g0 * k) * expM + g0 * k * expS;
        this.g[i] = g1;
        this.v[i] = v1;
        if (!Number.isFinite(v1) || !Number.isFinite(g1)) {
          nan = true;
          break;
        }
      }
      if (nan) break;

      for (let i = 0; i < n; i++) {
        if (this.ref[i] > 0) continue;
        if (this.v[i] > p.vTh) {
          this.v[i] = p.vReset;
          this.g[i] = 0;
          this.ref[i] = p.tRef;
          this.spikes[i] += 1;
          nSpikes += 1;
          const arr = trainsMap.get(i);
          if (arr && arr.length < 80) arr.push(timeMs);
          if (events.length < 16000) events.push({ local: i, t: timeMs });
          const a = pack.indptr[i];
          const b = pack.indptr[i + 1];
          for (let e = a; e < b; e++) {
            deliver[pack.indices[e]] += pack.weight[e];
          }
        }
      }
      this.delayI = (slot + 1) % this.delayLen;
    }

    this.elapsedMs += steps * dt;
    const durS = Math.max(this.elapsedMs / 1000, 1e-6);
    const rates = new Float32Array(n);
    let mean = 0;
    let active = 0;
    for (let i = 0; i < n; i++) {
      rates[i] = this.spikes[i] / durS;
      mean += rates[i];
      if (rates[i] > 0.5) active += 1;
    }
    mean /= n;

    const trains: SpikeTrain[] = [];
    for (const [local, times] of trainsMap) {
      trains.push({ local, rootId: pack.rootStr[local], times });
    }
    trains.sort((a, b) => a.local - b.local);

    return {
      durationMs: this.elapsedMs,
      nSpikes,
      trains,
      events,
      rates,
      flags: {
        nan,
        silent: active < 2,
        runaway: mean > 200,
      },
    };
  }
}

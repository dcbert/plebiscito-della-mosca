import type { Bucket } from "./classify";
import { rng } from "./engine/bancLif";
import type { Wing } from "./engine/types";

/** Arbitrary Δrate table. Shown in the UI. Not physiology. */
export const THRESHOLDS = {
  escapeNoHz: 8,
  sugarSiHz: 0.5,
  bitterNoHz: -0.5,
  fermentationSiHz: 0.5,
  mechanoSiHz: 4,
  silentHz: 0.3,
};

export type Verdict = "SI" | "NO" | "ASTENUTA";

/** 3 sinistra, 2 centro, 3 destra. Same BANC graph; different decoder. */
export const SEAT_WING: Wing[] = [
  "sinistra",
  "sinistra",
  "sinistra",
  "centro",
  "centro",
  "destra",
  "destra",
  "destra",
];

export type WingPolicy = {
  label: string;
  blurb: string;
  stimScale: number;
  gain: number;
  invertAlarm: boolean;
  abstainBelow: number;
};

export const WING_POLICY: Record<Wing, WingPolicy> = {
  sinistra: {
    label: "Sinistra",
    blurb: "Tende al NO sull'allarme. Non è un partito: è una tabella con rumore.",
    stimScale: 0.9,
    gain: 1,
    invertAlarm: false,
    abstainBelow: 3,
  },
  centro: {
    label: "Centro",
    blurb: "Tende all'AST, ma a volte sceglie. Soglia e segno pescati dal seme.",
    stimScale: 1,
    gain: 0.9,
    invertAlarm: false,
    abstainBelow: 12,
  },
  destra: {
    label: "Destra",
    blurb: "Tende al SI sull'allarme (segno invertito). Qualche ribelle vota NO.",
    stimScale: 1.15,
    gain: 1.1,
    invertAlarm: true,
    abstainBelow: 3,
  },
};

export type SeatDecoder = {
  wing: Wing;
  hz: number;
  gain: number;
  invertAlarm: boolean;
  abstainBelow: number;
  alarmHz: number;
  rebel: boolean;
  listenFrac: number;
};

export function wingOf(seat: number): Wing {
  return SEAT_WING[seat] ?? "centro";
}

/** Per-seat, per-run personality. Deterministic in (runSeed, seat). */
export function personality(runSeed: number, seat: number, baseHz: number): SeatDecoder {
  const wing = wingOf(seat);
  const p = WING_POLICY[wing];
  const r = rng((runSeed ^ Math.imul(seat + 1, 2654435761)) >>> 0);
  const hzJ = 0.5 + r() * 1.0; // 0.5–1.5×
  const gainJ = 0.65 + r() * 0.8;
  const rebelP = wing === "centro" ? 0.4 : 0.24;
  const rebel = r() < rebelP;
  let invert = p.invertAlarm;
  if (rebel) invert = !invert;
  if (wing === "centro" && r() < 0.5) invert = r() < 0.5;
  const abstainSpan = wing === "centro" ? 14 : 7;
  const abstainBelow = Math.max(0.2, p.abstainBelow + (r() - 0.5) * abstainSpan);
  const alarmHz = 5 + r() * 12; // 5–17 Hz, near the real Δrate
  return {
    wing,
    hz: Math.max(0, Math.round(baseHz * p.stimScale * hzJ)),
    gain: p.gain * gainJ,
    invertAlarm: invert,
    abstainBelow,
    alarmHz,
    rebel,
    listenFrac: 0.3 + r() * 0.7,
  };
}

/** Average a seed-chosen subset of motor/DN rates — each fly "listens" to different cells. */
export function mixRates(rates: number[], frac: number, runSeed: number, seat: number): number {
  if (!rates.length) return 0;
  const r = rng((runSeed + Math.imul(seat + 3, 97_991)) >>> 0);
  const n = Math.max(1, Math.round(rates.length * frac));
  const idx = rates.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = idx[i];
    idx[i] = idx[j];
    idx[j] = t;
  }
  let s = 0;
  for (let k = 0; k < n; k++) s += rates[idx[k]];
  return s / n;
}

export function verdictFromDelta(
  bucket: Bucket,
  deltaHz: number,
  silent: boolean,
  dec: SeatDecoder,
): { verdict: Verdict; copy: string } {
  const wing = dec.wing;
  if (bucket === "none" || silent || !Number.isFinite(deltaHz)) {
    return { verdict: "ASTENUTA", copy: copyFor("none", "ASTENUTA", wing, dec.rebel) };
  }
  const x = deltaHz * dec.gain;

  if (bucket === "escape" || bucket === "mechano") {
    if (Math.abs(x) < dec.abstainBelow) {
      return { verdict: "ASTENUTA", copy: copyFor(bucket, "ASTENUTA", wing, dec.rebel) };
    }
    const alarmed = x >= dec.alarmHz;
    const verdict: Verdict = dec.invertAlarm ? (alarmed ? "SI" : "NO") : alarmed ? "NO" : "SI";
    return { verdict, copy: copyFor(bucket, verdict, wing, dec.rebel) };
  }

  if (Math.abs(x) < dec.abstainBelow) {
    return { verdict: "ASTENUTA", copy: copyFor(bucket, "ASTENUTA", wing, dec.rebel) };
  }
  if (bucket === "sugar" && x >= THRESHOLDS.sugarSiHz) {
    return { verdict: "SI", copy: copyFor("sugar", "SI", wing, dec.rebel) };
  }
  if (bucket === "bitter" && x <= THRESHOLDS.bitterNoHz) {
    return { verdict: "NO", copy: copyFor("bitter", "NO", wing, dec.rebel) };
  }
  if (bucket === "fermentation" && x >= THRESHOLDS.fermentationSiHz) {
    return { verdict: "SI", copy: copyFor("fermentation", "SI", wing, dec.rebel) };
  }
  return { verdict: "ASTENUTA", copy: copyFor(bucket, "ASTENUTA", wing, dec.rebel) };
}

export function copyFor(bucket: Bucket, verdict: Verdict, wing: Wing = "centro", rebel = false): string {
  const rib = rebel ? " Ribelle del banco." : "";
  if (bucket === "escape" && verdict === "NO") return "NO. Più stivali, più scacciamosche." + rib;
  if (bucket === "escape" && verdict === "SI") return "SI. Meglio lo scacciamosche di Stato." + rib;
  if (bucket === "sugar" && verdict === "SI") return "SI, ma solo al tagliere." + rib;
  if (bucket === "mechano" && verdict === "SI") return "SI. Il ponte vibra, il banco dice sì." + rib;
  if (bucket === "mechano" && verdict === "NO") return "NO. Troppa vibrazione, resta posata." + rib;
  if (verdict === "ASTENUTA") {
    if (wing === "centro") return "ASTENUTA. Il centro attende la relazione tecnica." + rib;
    if (bucket === "mechano") return "ASTENUTA. Il ponte trema, la mosca no." + rib;
    return "ASTENUTA. Si posa sulla ricevuta." + rib;
  }
  if (bucket === "bitter" && verdict === "NO") return "NO. Amaro. Non assaggia." + rib;
  if (bucket === "fermentation" && verdict === "SI") return "SI. Odore di frutta che marcia." + rib;
  if (verdict === "SI") return "SI." + rib;
  if (verdict === "NO") return "NO." + rib;
  return "ASTENUTA." + rib;
}

export function majority(votes: Verdict[]): Verdict {
  const c = { SI: 0, NO: 0, ASTENUTA: 0 };
  for (const v of votes) c[v]++;
  if (c.SI > c.NO && c.SI > c.ASTENUTA) return "SI";
  if (c.NO > c.SI && c.NO > c.ASTENUTA) return "NO";
  return "ASTENUTA";
}

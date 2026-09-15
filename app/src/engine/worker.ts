import { BancLif } from "./bancLif";
import { decodePack } from "./pack";
import type { LifParams, Pack } from "./types";

let pack: Pack | null = null;
let brain: BancLif | null = null;

type InitMsg = { type: "init"; pack: ArrayBuffer };
type RunMsg = {
  type: "run";
  seed: number;
  hz: number;
  stimIds: string[];
  readoutIds: string[];
  watchIds: string[];
  ms: number;
  params?: Partial<LifParams>;
};
type Msg = InitMsg | RunMsg;

self.onmessage = (ev: MessageEvent<Msg>) => {
  const msg = ev.data;
  if (msg.type === "init") {
    pack = decodePack(msg.pack);
    self.postMessage({ type: "ready", n: pack.n, nnz: pack.nnz });
    return;
  }
  if (msg.type === "run") {
    if (!pack) {
      self.postMessage({ type: "error", error: "pack not loaded" });
      return;
    }
    brain = new BancLif(pack, msg.seed, msg.params);
    brain.stimulate(msg.stimIds, msg.hz);
    const watch = msg.watchIds
      .map((id) => pack!.localOf.get(id))
      .filter((x): x is number => x !== undefined);
    const run = brain.run(msg.ms, watch);
    const readoutRates = brain.rate(msg.readoutIds);
    const stimRates = brain.rate(msg.stimIds);
    const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    self.postMessage({
      type: "result",
      seed: msg.seed,
      hz: msg.hz,
      trains: run.trains,
      events: run.events,
      nSpikes: run.nSpikes,
      flags: run.flags,
      meanReadoutHz: mean(readoutRates),
      meanStimHz: mean(stimRates),
      readoutRates,
      durationMs: run.durationMs,
    });
  }
};

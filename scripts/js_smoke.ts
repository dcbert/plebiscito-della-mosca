import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { decodePack } from "../app/src/engine/pack.ts";
import { BancLif } from "../app/src/engine/bancLif.ts";

const raw = gunzipSync(readFileSync("app/public/packs/circuit.pack.bin.gz"));
const pack = decodePack(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
const man = JSON.parse(readFileSync("app/public/packs/circuit.manifest.json", "utf8"));
console.log("n", pack.n, "nnz", pack.nnz, "id0", pack.rootStr[0]);

const b = man.buckets.escape;
const brain = await BancLif.load({ pack, seed: 1 });
brain.stimulate(b.stimRootIds, 150);
const t0 = Date.now();
const run = brain.run(400, [...b.stimLocal.slice(0, 8), ...b.readoutLocal]);
const dt = Date.now() - t0;
const rates = brain.rate(b.readoutRootIds);
const mean = rates.reduce((a, c) => a + c, 0) / rates.length;
console.log({
  msWall: dt,
  nSpikes: run.nSpikes,
  meanReadoutHz: mean,
  flags: run.flags,
  trains: run.trains.length,
});
if (run.flags.nan) throw new Error("NaN");
if (mean < 8) throw new Error("escape readout too low for first-loop NO");
console.log("OK escape");

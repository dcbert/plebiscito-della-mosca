export type LifParams = {
  vRest: number;
  vReset: number;
  vTh: number;
  tauM: number;
  tauSyn: number;
  tRef: number;
  tDelay: number;
  wSyn: number;
  fPoi: number;
  dt: number;
};

export const DEFAULT_PARAMS: LifParams = {
  vRest: -52,
  vReset: -52,
  vTh: -45,
  tauM: 20,
  tauSyn: 5,
  tRef: 2.2,
  tDelay: 1.8,
  wSyn: 0.275,
  fPoi: 250,
  dt: 0.1,
};

export type NeuronLabel = {
  rootId: string;
  cellType: string;
  cellClass: string;
  superClass: string;
  nt: string;
  function: string;
  functionDetailed: string;
};

export type BucketSpec = {
  stimRootIds: string[];
  readoutRootIds: string[];
  stimLocal: number[];
  readoutLocal: number[];
  note: string;
  supported: boolean;
};

export type Manifest = {
  dataset: string;
  notBanc: boolean;
  materialization: number;
  edgelist: string;
  citation: string;
  cutoffSynapses: number;
  hops: number;
  n: number;
  nnz: number;
  mVPerSynapse: number;
  packFile: string;
  packBytesGzip?: number;
  transmitterRule: Record<string, unknown>;
  buckets: Record<string, BucketSpec>;
  neurons: NeuronLabel[];
  limitations: string[];
  smoke?: Record<string, unknown>;
};

export type Pack = {
  n: number;
  nnz: number;
  indptr: Uint32Array;
  indices: Uint32Array;
  weight: Float32Array;
  roots: BigUint64Array;
  rootStr: string[];
  ntSign: Int8Array;
  role: Uint8Array;
  localOf: Map<string, number>;
  xyz?: Float32Array; // n * 3, centered BANC nm, uniform scale
};

export type SpikeTrain = { local: number; rootId: string; times: number[] };

export type SpikeEvent = { local: number; t: number };

export type RunResult = {
  durationMs: number;
  nSpikes: number;
  trains: SpikeTrain[];
  events: SpikeEvent[];
  rates: Float32Array;
  flags: { nan: boolean; silent: boolean; runaway: boolean };
};

export type Wing = "sinistra" | "centro" | "destra";

export type SeatResult = {
  seat: number;
  seed: number;
  hz: number;
  wing: Wing;
  rebel?: boolean;
  verdict: "SI" | "NO" | "ASTENUTA";
  copy: string;
  meanReadoutHz: number;
  baselineHz: number;
  deltaHz: number;
  trains: SpikeTrain[];
  events?: SpikeEvent[];
  nSpikes: number;
  flags: RunResult["flags"];
};

import type { Bucket } from "./classify";

export type Official = {
  fav: number | null;
  contr: number | null;
  ast: number | null;
  esito: string | null;
  presenti?: number | null;
  votanti?: number | null;
};

export type Session = {
  id: string;
  pin?: boolean;
  archivio?: boolean;
  domanda: string;
  bucket: Bucket;
  bucketUnsupported?: string;
  title: string;
  description?: string;
  date: string | null;
  branch: string;
  source: { kind: string; ids: string[]; attribution: string; url?: string };
  official: Official;
  flags?: { is_key_vote?: boolean; is_final?: boolean; is_confidence?: boolean; sub_vote_type?: string };
  stimulusHz: number;
  neuronIds: string[];
  motorIds: string[];
  thresholds?: Record<string, unknown>;
  banc?: { materialization: number; edgelist: string; pack: string; notBanc?: boolean };
};

export type Feed = {
  legislature: string;
  generatedAt: string;
  attribution: string;
  sessions: Session[];
};

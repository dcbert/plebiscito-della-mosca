/** Hardcoded allow-list. The fly never reads the bill. Unsure → none. */

export type Bucket = "escape" | "sugar" | "bitter" | "fermentation" | "mechano" | "none";

const NONE_RE =
  /\b(tass[ae]|isee|irpef|flat\s*tax|elettoral|procedur|emendamento|\bem\.\s|calendario|numero legale|pregiudizial|odg\b|ordine del giorno|soglia\s*100|concordato|aliquota)\b/i;

const ESCAPE_RE =
  /\b(militar|strade sicure|sicurezza pubblica|scacciamosche|ordine pubblico|caserm|stival|difesa|loom|minacci|polizia|carabinier|decreto sicurezza)\b/i;

const SUGAR_RE =
  /\b(cibo|agricol|cilieg|vino|tagliere|zucchero|aliment|viticol|frutta|suzukii|drosophila suzukii)\b/i;

const BITTER_RE = /\b(amaro|pesticid|velen[oi]|erbicid)\b/i;

const FERMENT_RE = /\b(casa green|epbd|prestazione energetica|frutta che marcia|compost|ferment|rifiuti organici)\b/i;

const MECHANO_RE =
  /\b(ponte|stretto|messina|treno|cantier|infrastruttur|alta velocit|vibraz|viadott|pnrr)\b/i;

const IMMIG_RE = /\b(immigraz|migrant|sbarch|rimpatri|asilo|ong)\b/i;
const PEST_RE = /\b(suzukii|moscerino|parassita|frutta)\b/i;

export function classifyBucket(title: string, description = "", proposed?: string): Bucket {
  const text = `${title} ${description}`;
  if (NONE_RE.test(text)) return "none";
  if (IMMIG_RE.test(text) && !PEST_RE.test(text)) return "none";
  const hits: Bucket[] = [];
  if (ESCAPE_RE.test(text)) hits.push("escape");
  if (SUGAR_RE.test(text)) hits.push("sugar");
  if (BITTER_RE.test(text)) hits.push("bitter");
  if (FERMENT_RE.test(text)) hits.push("fermentation");
  if (MECHANO_RE.test(text)) hits.push("mechano");
  if (hits.length === 1) return hits[0];
  if (hits.length === 0) {
    const allow: Bucket[] = ["escape", "sugar", "bitter", "fermentation", "mechano", "none"];
    if (proposed && (allow as string[]).includes(proposed)) return proposed as Bucket;
    return "none";
  }
  // conflicting keywords → do not invent a stimulus
  return "none";
}

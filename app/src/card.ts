import type { SeatResult } from "./engine/types";
import type { Session } from "./sessions";

const CREAM = "#f3ead8";
const INK = "#1a1208";
const RULE = "#2a1810";
const RED = "#7a1515";

function footer(source: string, notBanc: boolean): string {
  const data = notBanc
    ? "PACK: NOT BANC (stub)."
    : "Dati: BANC v888 · Bates, Phelps, Kim et al., Nature 2026.";
  return `Modello anatomico, non fisiologico. La mosca non ha letto il testo. ${data} Voti: ${source}. Il voto dello sciame è satira.`;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number): number {
  const words = text.split(/\s+/);
  let line = "";
  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (ctx.measureText(t).width > maxW && line) {
      ctx.fillText(line, x, y);
      y += lineH;
      line = w;
    } else line = t;
  }
  if (line) {
    ctx.fillText(line, x, y);
    y += lineH;
  }
  return y;
}

export function drawCard(opts: {
  w: number;
  h: number;
  session: Session;
  sciame: "SI" | "NO" | "ASTENUTA";
  copy: string;
  seats: SeatResult[];
  notBanc: boolean;
  source: string;
}): HTMLCanvasElement {
  const { w, h, session, sciame, copy, seats, notBanc, source } = opts;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = CREAM;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = RULE;
  ctx.lineWidth = Math.max(6, w * 0.012);
  ctx.strokeRect(w * 0.04, h * 0.03, w * 0.92, h * 0.94);

  const x = w * 0.1;
  let y = h * 0.1;
  ctx.fillStyle = INK;
  ctx.font = `700 ${Math.floor(w * 0.055)}px Didot, "Bodoni 72", Palatino, serif`;
  ctx.textAlign = "center";
  ctx.fillText("IL PLEBISCITO DELLA MOSCA", w / 2, y);
  y += h * 0.035;
  ctx.font = `${Math.floor(w * 0.09)}px serif`;
  ctx.fillText("🪰", w / 2, y);
  y += h * 0.04;
  ctx.font = `italic ${Math.floor(w * 0.028)}px Palatino, serif`;
  ctx.fillText("Il Parlamento non ha un connectome. La mosca sì.", w / 2, y);

  y += h * 0.06;
  ctx.textAlign = "left";
  ctx.font = `${Math.floor(w * 0.038)}px Palatino, serif`;
  y = wrap(ctx, session.domanda, x, y, w * 0.8, h * 0.035);

  y += h * 0.04;
  ctx.textAlign = "center";
  ctx.fillStyle = sciame === "NO" ? RED : INK;
  ctx.font = `700 ${Math.floor(w * 0.18)}px Didot, "Bodoni 72", Palatino, serif`;
  ctx.fillText(sciame, w / 2, y);
  y += h * 0.05;
  ctx.fillStyle = INK;
  ctx.font = `italic ${Math.floor(w * 0.032)}px Palatino, serif`;
  ctx.fillText(copy, w / 2, y);

  y += h * 0.05;
  const off = session.official;
  ctx.font = `${Math.floor(w * 0.022)}px Palatino, serif`;
  const offLine =
    off.fav == null
      ? `Ufficiale: ${off.esito || "n.d."}`
      : `Ufficiale  SI ${off.fav}  NO ${off.contr}  AST ${off.ast}  ·  ${off.esito}`;
  ctx.fillText(offLine, w / 2, y);
  const sci = { SI: 0, NO: 0, ASTENUTA: 0 };
  for (const s of seats) sci[s.verdict]++;
  y += h * 0.03;
  ctx.fillText(`Sciame  SI ${sci.SI}  NO ${sci.NO}  AST ${sci.ASTENUTA}`, w / 2, y);

  // tiny raster
  y += h * 0.04;
  const rw = w * 0.8;
  const rh = h * 0.16;
  const rx = (w - rw) / 2;
  ctx.strokeStyle = RULE;
  ctx.lineWidth = 1;
  ctx.strokeRect(rx, y, rw, rh);
  const trains = seats[0]?.trains ?? [];
  const rows = Math.min(trains.length, 18);
  const dur = 400;
  ctx.fillStyle = INK;
  for (let r = 0; r < rows; r++) {
    const yy = y + ((r + 0.5) * rh) / rows;
    for (const t of trains[r].times) {
      const xx = rx + (t / dur) * rw;
      ctx.fillRect(xx, yy - 1, 2, 2);
    }
  }

  y += rh + h * 0.04;
  ctx.font = `${Math.floor(w * 0.02)}px Palatino, serif`;
  ctx.fillText(
    notBanc ? "NOT BANC · pack sintetico" : "BANC v888  ·  " + (session.date || ""),
    w / 2,
    y,
  );
  if (session.archivio) {
    y += h * 0.025;
    ctx.fillText("ARCHIVIO", w / 2, y);
  }

  y += h * 0.05;
  ctx.font = `${Math.floor(w * 0.016)}px Palatino, serif`;
  ctx.textAlign = "left";
  wrap(ctx, footer(source, notBanc), w * 0.1, y, w * 0.8, h * 0.02);
  return c;
}

export function downloadCanvas(canvas: HTMLCanvasElement, name: string): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }, "image/png");
}

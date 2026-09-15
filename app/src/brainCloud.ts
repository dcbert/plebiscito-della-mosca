import type { Pack, SpikeEvent } from "./engine/types";

const ROLE_SENSORY = 1;
const ROLE_DESCENDING = 2;
const ROLE_MOTOR = 4;
const ROLE_VISUAL = 16;

type Edge = { a: number; b: number };

export class BrainCloud {
  canvas: HTMLCanvasElement;
  pack: Pack;
  yaw = 0.55;
  pitch = 0.35;
  scale = 0;
  dragging = false;
  lastX = 0;
  lastY = 0;
  auto = true;
  events: SpikeEvent[] = [];
  duration = 400;
  playT = 0;
  playing = false;
  raf = 0;
  edges: Edge[] = [];
  glow: Float32Array;
  lastTs = 0;
  dpr = 1;
  cssW = 0;
  cssH = 0;

  constructor(canvas: HTMLCanvasElement, pack: Pack) {
    this.canvas = canvas;
    this.pack = pack;
    this.glow = new Float32Array(pack.n);
    this.edges = pickEdges(pack, 1800);
    this.bind();
    this.resize();
    this.loop(0);
  }

  bind(): void {
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      this.auto = false;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.yaw += dx * 0.008;
      this.pitch = clamp(this.pitch + dy * 0.006, -1.1, 1.1);
    });
    const up = () => {
      this.dragging = false;
    };
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, this.canvas.clientWidth || this.canvas.parentElement?.clientWidth || 1);
    const h = Math.max(1, this.canvas.clientHeight || this.canvas.parentElement?.clientHeight || 1);
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
    }
    this.dpr = dpr;
    this.cssW = w;
    this.cssH = h;
    this.scale = Math.min(w, h) * 0.42;
  }

  setEvents(events: SpikeEvent[], durationMs: number): void {
    this.events = events;
    this.duration = Math.max(1, durationMs);
    this.playT = 0;
    this.glow.fill(0);
    this.playing = true;
    this.auto = true;
  }

  replay(): void {
    this.playT = 0;
    this.glow.fill(0);
    this.playing = true;
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
  }

  loop = (ts: number): void => {
    const dt = this.lastTs ? Math.min(0.05, (ts - this.lastTs) / 1000) : 0.016;
    this.lastTs = ts;
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    if (cw !== this.cssW || ch !== this.cssH) this.resize();
    if (this.auto && !this.dragging) this.yaw += dt * 0.22;
    if (this.playing) {
      this.playT += dt * 140; // 400 ms biology → ~2.9 s wall
      if (this.playT > this.duration + 80) {
        this.playing = false;
        this.playT = this.duration;
      }
    }
    for (let i = 0; i < this.glow.length; i++) this.glow[i] *= Math.exp(-dt * 7);
    if (this.playing || this.playT > 0) {
      const t0 = this.playT - 28;
      const t1 = this.playT;
      for (const e of this.events) {
        if (e.t >= t0 && e.t <= t1) this.glow[e.local] = 1;
      }
    }
    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  };

  draw(): void {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const w = this.cssW;
    const h = this.cssH;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = "#07080c";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const xyz = this.pack.xyz;
    if (!xyz) {
      ctx.fillStyle = "#8a9aa8";
      ctx.font = "italic 13px Palatino, serif";
      ctx.fillText("Niente coordinate BANC in questo pack.", 16, h / 2);
      return;
    }
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const n = this.pack.n;
    const cx = w * 0.5;
    const cy0 = h * 0.5;
    const sc = this.scale;
    const px = new Float32Array(n);
    const py = new Float32Array(n);
    const depth = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = xyz[i * 3];
      const y = xyz[i * 3 + 1];
      const z = xyz[i * 3 + 2];
      const xr = x * cy + z * sy;
      const zr = -x * sy + z * cy;
      const yr = y * cp - zr * sp;
      const zr2 = y * sp + zr * cp;
      px[i] = cx + xr * sc;
      py[i] = cy0 - yr * sc;
      depth[i] = zr2;
    }

    ctx.lineWidth = 0.6;
    for (const e of this.edges) {
      const g = Math.max(this.glow[e.a], this.glow[e.b]);
      ctx.strokeStyle = g > 0.15 ? `rgba(180, 230, 255, ${0.08 + g * 0.35})` : "rgba(90, 110, 130, 0.07)";
      ctx.beginPath();
      ctx.moveTo(px[e.a], py[e.a]);
      ctx.lineTo(px[e.b], py[e.b]);
      ctx.stroke();
    }

    const order = new Uint32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    order.sort((a, b) => depth[a] - depth[b]);

    for (let k = 0; k < n; k++) {
      const i = order[k];
      const g = this.glow[i];
      const role = this.pack.role[i];
      const col = colorFor(role, g);
      const r = g > 0.2 ? 2.6 + g * 3.2 : 1.15;
      if (g > 0.35) {
        ctx.beginPath();
        ctx.fillStyle = `rgba(${col.r},${col.g},${col.b},${0.12 + g * 0.2})`;
        ctx.arc(px[i], py[i], r * 3.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.fillStyle = `rgba(${col.r},${col.g},${col.b},${0.35 + g * 0.65})`;
      ctx.arc(px[i], py[i], r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = "rgba(243,234,216,0.45)";
    ctx.font = "11px Palatino, serif";
    ctx.fillText("BANC v888 · soma", 10, 18);
    const pct = Math.min(1, this.playT / this.duration);
    ctx.fillRect(10, h - 14, (w - 20) * pct, 3);
  }
}

function colorFor(role: number, glow: number): { r: number; g: number; b: number } {
  if (glow > 0.55) return { r: 255, g: 255, b: 255 };
  if (role & ROLE_MOTOR) return { r: 255, g: 191, b: 71 };
  if (role & ROLE_DESCENDING) return { r: 255, g: 77, b: 141 };
  if (role & ROLE_VISUAL || role & ROLE_SENSORY) return { r: 92, g: 225, b: 255 };
  return { r: 120, g: 138, b: 158 };
}

function pickEdges(pack: Pack, max: number): Edge[] {
  const scored: { a: number; b: number; w: number }[] = [];
  for (let i = 0; i < pack.n; i++) {
    const a = pack.indptr[i];
    const b = pack.indptr[i + 1];
    let best = 0;
    let bestJ = -1;
    for (let e = a; e < b; e++) {
      const w = Math.abs(pack.weight[e]);
      if (w > best) {
        best = w;
        bestJ = pack.indices[e];
      }
    }
    if (bestJ >= 0) scored.push({ a: i, b: bestJ, w: best });
  }
  scored.sort((p, q) => q.w - p.w);
  return scored.slice(0, max).map((e) => ({ a: e.a, b: e.b }));
}

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

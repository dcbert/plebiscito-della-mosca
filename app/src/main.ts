import { classifyBucket, type Bucket } from "./classify";
import { drawCard, downloadCanvas } from "./card";
import { BrainCloud } from "./brainCloud";
import { loadPackAndManifest } from "./engine/pack";
import { DEFAULT_PARAMS, type Manifest, type SeatResult } from "./engine/types";
import type { Feed, Session } from "./sessions";
import { majority, SEAT_WING, THRESHOLDS, WING_POLICY, mixRates, personality, verdictFromDelta, wingOf } from "./verdict";
import type { Wing } from "./engine/types";

const N_SEATS = 8;
const asset = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;
const RUN_MS = 400;
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];
const BUCKET_IT: Record<Bucket, string> = {
  escape: "fuga / looming (sicurezza)",
  sugar: "zucchero / cibo",
  bitter: "amaro",
  fermentation: "fermentazione / frutta",
  mechano: "meccanosenso (ponte, cantieri)",
  none: "nessuno — la mosca si astiene",
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let manifest: Manifest;
let feed: Feed;
let session: Session;
let worker: Worker;
let seats: SeatResult[] = [];
let revealedN = 0;
let selectedSeat = 0;
let running = false;
let paused = false;
let slamSeat = -1;
let packBuf: ArrayBuffer;
let labels = new Map<string, string>();
let runSeed = 1;
let pendingSeed: number | undefined;
let cloud: BrainCloud | undefined;
let runGen = 0;

function sourceAttr(s: Session): string {
  return s.source?.attribution || "Openpolis / Camera / Senato";
}

function footerText(s: Session, notBanc: boolean): string {
  const data = notBanc ? "PACK: NOT BANC." : "Dati: BANC v888 · Bates, Phelps, Kim et al., Nature 2026.";
  return `Modello anatomico, non fisiologico. La mosca non ha letto il testo. ${data} Voti: ${sourceAttr(s)}. Il voto dello sciame è satira.`;
}

function setTab(tab: string): void {
  document.body.dataset.tab = tab;
  document.querySelectorAll<HTMLButtonElement>(".tabs [data-tab]").forEach((btn) => {
    btn.classList.toggle("is-on", btn.dataset.tab === tab);
  });
  requestAnimationFrame(() => {
    cloud?.resize();
    if (seats[selectedSeat] && selectedSeat < revealedN) drawRaster(seats[selectedSeat]!);
    else drawRaster(null);
  });
}

function layoutChrome(): void {
  const dock = document.querySelector(".dock") as HTMLElement | null;
  const desktop = window.matchMedia("(min-width: 1100px)").matches;
  const h = !desktop && dock ? dock.offsetHeight : 0;
  document.documentElement.style.setProperty("--dock-space", `${h}px`);
}

function toast(msg: string): void {
  const el = $("toast");
  el.hidden = false;
  el.textContent = msg;
  window.setTimeout(() => {
    el.hidden = true;
  }, 2200);
}

function parseQuery(): { s?: string; seed?: number; hz?: number } {
  const q = new URLSearchParams(location.search);
  return {
    s: q.get("s") || undefined,
    seed: q.get("seed") ? Number(q.get("seed")) : undefined,
    hz: q.get("hz") ? Number(q.get("hz")) : undefined,
  };
}

function writeQuery(): void {
  const u = new URL(location.href);
  u.searchParams.set("s", session.id);
  u.searchParams.set("hz", String(Number($<HTMLInputElement>("hz").value) || 0));
  u.searchParams.set("seed", String(pendingSeed ?? runSeed));
  history.replaceState(null, "", u);
}

function fillSessions(): void {
  const sel = $<HTMLSelectElement>("session");
  sel.innerHTML = "";
  for (const s of feed.sessions) {
    const o = document.createElement("option");
    o.value = s.id;
    const tag = s.archivio ? " · archivio" : s.pin ? "" : " · live";
    o.textContent = (s.domanda || s.title).slice(0, 88) + tag;
    sel.appendChild(o);
  }
}

function shiftSession(delta: number): void {
  const i = feed.sessions.findIndex((s) => s.id === session.id);
  const next = feed.sessions[(i + delta + feed.sessions.length) % feed.sessions.length];
  session = next;
  renderSession();
}

function setHz(v: number): void {
  const n = Math.max(0, Math.min(400, Math.round(v)));
  $<HTMLInputElement>("hz").value = String(n);
  $<HTMLInputElement>("hz-range").value = String(Math.min(250, n));
}

function bucketOf(s: Session): Bucket {
  return classifyBucket(s.title, s.description || "", s.bucket);
}

function renderChips(s: Session): void {
  const host = $("meta-chips");
  host.innerHTML = "";
  const bits: { t: string; live?: boolean }[] = [
    { t: s.branch === "senato" ? "Senato" : "Camera" },
    { t: s.date || "s.d." },
  ];
  if (s.flags?.is_confidence) bits.push({ t: "fiducia" });
  if (s.flags?.is_final) bits.push({ t: "finale" });
  if (s.flags?.is_key_vote) bits.push({ t: "voto chiave" });
  if (s.archivio) bits.push({ t: "archivio" });
  else if (!s.pin) bits.push({ t: "live", live: true });
  for (const b of bits) {
    const el = document.createElement("span");
    el.className = "chip" + (b.live ? " live" : "");
    el.textContent = b.t;
    host.appendChild(el);
  }
}

function clearBallotSciame(): void {
  $("b-sci-si").textContent = "—";
  $("b-sci-no").textContent = "—";
  $("b-sci-ast").textContent = "—";
}

function renderSession(opts?: { keepHz?: boolean }): void {
  const s = session;
  $<HTMLSelectElement>("session").value = s.id;
  $("domanda").textContent = s.domanda;
  $("official-title").textContent = s.title;
  $("official-branch").textContent =
    (s.branch === "senato" ? "Palazzo Madama" : "Montecitorio") + (s.date ? ` · ${s.date}` : "");
  $("archivio").hidden = !s.archivio;
  renderChips(s);
  const b = bucketOf(s);
  session.bucket = b;
  const spec = manifest.buckets[b];
  const nStim = spec?.stimRootIds.length ?? s.neuronIds.length;
  $("bucket-line").textContent =
    b === "none"
      ? "Canale sensoriale: nessuno. Nessuno stimolo inventato."
      : `Canale: ${BUCKET_IT[b]} · ${nStim} neuroni stimolati · ${spec?.readoutRootIds.length ?? s.motorIds.length} in lettura`;

  const off = s.official;
  const approved = (off.esito || "").toLowerCase().startsWith("approv");
  const rejected = (off.esito || "").toLowerCase().startsWith("respint");
  const giant =
    off.esito === "non_votata_in_aula"
      ? "NON VOTATA"
      : approved
        ? "APPROVATA"
        : rejected
          ? "RESPINTA"
          : off.esito || "—";
  $("official-verdict").textContent = giant;
  $("official-counts").textContent =
    off.fav == null ? "Nessun conteggio d'Aula. Non inventiamo i numeri." : `fav ${off.fav} · contr ${off.contr} · ast ${off.ast}`;
  $("b-off-si").textContent = off.fav == null ? "—" : String(off.fav);
  $("b-off-no").textContent = off.contr == null ? "—" : String(off.contr);
  $("b-off-ast").textContent = off.ast == null ? "—" : String(off.ast);
  $("footer").textContent = footerText(s, manifest.notBanc);
  if (!opts?.keepHz) setHz(s.stimulusHz || (b === "none" ? 0 : 150));
  $("sciame-verdict").textContent = "—";
  $("sciame-verdict").classList.remove("reveal", "pending");
  $("sciame-card").classList.remove("counting");
  $("sciame-copy").textContent = "";
  $("sciame-counts").textContent = "";
  $("sciame-tally").textContent = "";
  $("seat-detail").hidden = true;
  $("seat-detail").innerHTML = "";
  document.querySelector(".lab-extra")?.classList.remove("has-data");
  clearBallotSciame();
  seats = [];
  revealedN = 0;
  slamSeat = -1;
  drawSeats();
  drawRaster(null);
  $("motor-bars").innerHTML = "";
  writeQuery();
}

function hostForWing(w: Wing): HTMLElement {
  if (w === "sinistra") return $("seats-left");
  if (w === "destra") return $("seats-right");
  return $("seats-center");
}

function drawSeats(): void {
  $("seats-left").innerHTML = "";
  $("seats-center").innerHTML = "";
  $("seats-right").innerHTML = "";
  const thinking = running && revealedN === 0 && seats.length < N_SEATS;
  for (let i = 0; i < N_SEATS; i++) {
    const b = document.createElement("button");
    b.className = "seat";
    b.type = "button";
    const wing = wingOf(i);
    b.setAttribute("aria-label", `${WING_POLICY[wing].label} ${ROMAN[i]}`);
    const shown = i < revealedN;
    const v = shown ? seats[i]?.verdict : undefined;
    if (v === "SI") b.classList.add("is-si");
    if (v === "NO") b.classList.add("is-no");
    if (v === "ASTENUTA") b.classList.add("is-ast");
    if (!shown && revealedN > 0) b.classList.add("is-pending");
    if (thinking || (running && !shown && seats[i])) b.classList.add("thinking");
    if (i === slamSeat) b.classList.add("slam");
    if (i === selectedSeat && revealedN > 0) b.classList.add("active");
    const mark = v === "ASTENUTA" ? "AST" : v || "";
    b.innerHTML = `<span class="glyph">🪰</span><span class="n">${ROMAN[i]}</span>${mark ? `<span class="v">${mark}</span>` : ""}`;
    b.title = shown && seats[i] ? `${WING_POLICY[wing].label} · ${seats[i].verdict} · Δ ${seats[i].deltaHz.toFixed(1)} Hz` : `${WING_POLICY[wing].label} ${ROMAN[i]}`;
    b.onclick = () => {
      selectedSeat = i;
      drawSeats();
      showSeat(i, true);
    };
    hostForWing(wing).appendChild(b);
  }
}

function showSeat(i: number, fromTap = false): void {
  const box = $("seat-detail");
  const s = seats[i];
  if (!s || i >= revealedN) {
    box.hidden = true;
    box.innerHTML = "";
    drawRaster(null);
    return;
  }
  const wing = s.wing ?? wingOf(i);
  const rib = s.rebel ? " · <strong>ribelle</strong>" : "";
  box.hidden = false;
  box.innerHTML = `<strong>${WING_POLICY[wing].label} · On. ${ROMAN[i]}</strong>${rib} · seme ${s.seed} · ${s.hz} Hz<br>${s.verdict} · delta ${s.deltaHz.toFixed(2)} Hz · ${s.nSpikes} spike<br><em>${s.copy}</em><br><span class="cap">${WING_POLICY[wing].blurb}</span>`;
  drawRaster(s);
  drawMotors(s);
  if (cloud && s.events?.length) {
    cloud.setEvents(s.events, RUN_MS);
    $("cloud-cap").textContent = `On. ${ROMAN[i]} · ${s.nSpikes.toLocaleString("it-IT")} spike · somi BANC`;
    if (fromTap && window.matchMedia("(max-width: 1099px)").matches) setTab("cervello");
  }
}

function drawRaster(_seat: SeatResult | null): void {
  /* Raster UI removed; activity is the BANC point-cloud. */
}

function drawMotors(seat: SeatResult): void {
  const host = $("motor-bars");
  const pct = Math.min(100, (seat.meanReadoutHz / 40) * 100);
  const dpct = Math.min(100, (Math.abs(seat.deltaHz) / 40) * 100);
  host.innerHTML = `
    <div class="bar-row"><span>baseline</span><div class="bar"><span style="width:0%"></span></div><span>0 Hz</span></div>
    <div class="bar-row"><span>stimolo</span><div class="bar"><span style="width:${pct}%"></span></div><span>${seat.meanReadoutHz.toFixed(2)} Hz</span></div>
    <div class="bar-row"><span>delta</span><div class="bar delta"><span style="width:${dpct}%"></span></div><span>${seat.deltaHz.toFixed(2)} Hz</span></div>
  `;
  document.querySelector(".lab-extra")?.classList.add("has-data");
}

function watchIds(s: Session, man: Manifest): string[] {
  const b = man.buckets[s.bucket];
  const stim = (b?.stimRootIds || s.neuronIds || []).slice(0, 10);
  const mot = (b?.readoutRootIds || s.motorIds || []).slice(0, 14);
  return [...new Set([...stim, ...mot])];
}

function stimIds(s: Session, man: Manifest): string[] {
  const b = man.buckets[s.bucket];
  return b?.stimRootIds || s.neuronIds || [];
}

function readoutIds(s: Session, man: Manifest): string[] {
  const b = man.buckets[s.bucket];
  return b?.readoutRootIds || s.motorIds || [];
}

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0 || reducedMotion()) return Promise.resolve();
  return new Promise((r) => setTimeout(r, ms));
}

function abstainAll(copy: string): SeatResult[] {
  return Array.from({ length: N_SEATS }, (_, i) => ({
    seat: i,
    seed: 1 + i * 10007,
    hz: 0,
    wing: wingOf(i),
    rebel: false,
    verdict: "ASTENUTA" as const,
    copy,
    meanReadoutHz: 0,
    baselineHz: 0,
    deltaHz: 0,
    trains: [],
    nSpikes: 0,
    flags: { nan: false, silent: true, runaway: false },
  }));
}

function setProgress(i: number, n: number): void {
  const wrap = $("progress");
  const bar = $("progress-bar");
  wrap.hidden = n <= 0;
  bar.style.width = n <= 0 ? "0%" : `${Math.round((i / n) * 100)}%`;
}

function stillThisRun(gen: number): boolean {
  return gen === runGen && !paused;
}

async function runSciame(): Promise<void> {
  if (running) return;
  const gen = ++runGen;
  paused = false;
  running = true;
  revealedN = 0;
  slamSeat = -1;
  $<HTMLButtonElement>("run").disabled = true;
  $("sciame-card").classList.add("counting");
  $("sciame-verdict").classList.add("pending");
  $("sciame-verdict").classList.remove("reveal");
  $("sciame-verdict").textContent = "…";
  $("sciame-copy").textContent = "Lo sciame si posa.";
  runSeed = pendingSeed ?? freshSeed();
  pendingSeed = undefined;
  writeQuery();
  const baseHz = Number($<HTMLInputElement>("hz").value);
  const bucket = bucketOf(session);
  session.bucket = bucket;
  try {
    if (bucket === "none" || baseHz <= 0) {
      seats = abstainAll("ASTENUTA. Si posa sulla ricevuta.");
      await revealCeremony(gen, "Nessuno stimolo: canale none.");
      return;
    }
    const stim = stimIds(session, manifest);
    const readout = readoutIds(session, manifest);
    if (!stim.length || !readout.length) {
      seats = abstainAll("ASTENUTA. Si posa sulla ricevuta.");
      await revealCeremony(gen, "Bucket senza IDs BANC.");
      return;
    }
    const watch = watchIds(session, manifest);
    seats = [];
    drawSeats();
    setProgress(0, N_SEATS);
    $("status").textContent = "Il connectome sta sparando…";
    for (let i = 0; i < N_SEATS; i++) {
      if (!stillThisRun(gen)) break;
      const dec = personality(runSeed, i, baseHz);
      $("status").textContent = `Sparo ${WING_POLICY[dec.wing].label.toLowerCase()} · On. ${ROMAN[i]}`;
      const seed = (runSeed + Math.imul(i + 1, 10007)) >>> 0;
      const result = await runWorker({ seed, hz: dec.hz, stim, readout, watch });
      if (!stillThisRun(gen)) break;
      const rates = result.readoutRates?.length ? result.readoutRates : [result.meanReadoutHz];
      const delta = mixRates(rates, dec.listenFrac, runSeed, i);
      const silent = result.flags.silent || result.flags.nan || delta < THRESHOLDS.silentHz;
      const { verdict, copy } = verdictFromDelta(bucket, delta, silent, dec);
      seats.push({
        seat: i,
        seed,
        hz: dec.hz,
        wing: dec.wing,
        rebel: dec.rebel,
        verdict,
        copy,
        meanReadoutHz: delta,
        baselineHz: 0,
        deltaHz: delta,
        trains: result.trains,
        events: result.events,
        nSpikes: result.nSpikes,
        flags: result.flags,
      });
      drawSeats();
      setProgress(i + 1, N_SEATS);
    }
    if (!stillThisRun(gen)) {
      if (gen === runGen) {
        $("sciame-card").classList.remove("counting");
        setProgress(0, 0);
        $("status").textContent = paused ? "Pausa." : "Reset.";
      }
      return;
    }
    await revealCeremony(gen, "Spoglio dei banchi…");
  } finally {
    if (gen === runGen) {
      running = false;
      $<HTMLButtonElement>("run").disabled = false;
    }
  }
}

async function revealCeremony(gen: number, preface: string): Promise<void> {
  if (!stillThisRun(gen)) return;
  $("status").textContent = preface + " Lo spoglio è teatro. Il delta c'è già.";
  setProgress(0, 0);
  revealedN = 0;
  drawSeats();
  const beat = reducedMotion() ? 0 : 520;
  const wingBeat = reducedMotion() ? 0 : 640;
  let lastWing: Wing | null = null;
  for (let i = 0; i < seats.length; i++) {
    if (!stillThisRun(gen)) break;
    const wing = seats[i].wing ?? wingOf(i);
    if (lastWing && wing !== lastWing) {
      await sleep(wingBeat);
      if (!stillThisRun(gen)) break;
    }
    lastWing = wing;
    $("status").textContent = `Spoglio · ${WING_POLICY[wing].label} · On. ${ROMAN[i]}`;
    revealedN = i + 1;
    slamSeat = i;
    selectedSeat = i;
    drawSeats();
    showSeat(i);
    await sleep(beat);
    if (!stillThisRun(gen)) break;
    slamSeat = -1;
    drawSeats();
  }
  if (!stillThisRun(gen)) {
    if (gen === runGen) {
      slamSeat = -1;
      drawSeats();
      $("sciame-card").classList.remove("counting");
      $("status").textContent = paused ? "Pausa. Lo spoglio è fermo." : "Reset.";
    }
    return;
  }
  await sleep(reducedMotion() ? 0 : 720);
  if (!stillThisRun(gen)) return;
  finishSciame();
}

function finishSciame(): void {
  revealedN = seats.length;
  slamSeat = -1;
  drawSeats();
  const votes = seats.map((s) => s.verdict);
  const sci = majority(votes);
  const tally = { SI: 0, NO: 0, ASTENUTA: 0 };
  for (const v of votes) tally[v]++;
  $("sciame-card").classList.remove("counting");
  const g = $("sciame-verdict");
  g.classList.remove("pending");
  g.classList.add("reveal");
  g.textContent = sci;
  const copies = seats.filter((s) => s.verdict === sci).map((s) => s.copy);
  $("sciame-copy").textContent = copies[0] || "";
  $("sciame-counts").textContent = `SI ${tally.SI} · NO ${tally.NO} · AST ${tally.ASTENUTA}`;
  $("sciame-tally").textContent = `SIN ${seats.filter((s) => s.wing === "sinistra").map((s) => s.verdict[0]).join("")}  ·  CEN ${seats.filter((s) => s.wing === "centro").map((s) => s.verdict[0]).join("")}  ·  DES ${seats.filter((s) => s.wing === "destra").map((s) => s.verdict[0]).join("")}`;
  $("b-sci-si").textContent = String(tally.SI);
  $("b-sci-no").textContent = String(tally.NO);
  $("b-sci-ast").textContent = String(tally.ASTENUTA);
  $("status").textContent = seats.some((s) => s.flags.nan)
    ? "NaN nel LIF. Corsa abortita."
    : seats.some((s) => s.flags.runaway)
      ? "Allarme runaway (>200 Hz medi)."
      : sci === "ASTENUTA" && tally.SI === tally.NO
        ? "Pareggio tra i banchi. Lo sciame si astiene. La mosca non ha letto il testo."
        : `Fatto. Seme ${runSeed}. La mosca non ha letto il testo. I banchi sì, a modo loro: tabelle.`;
  writeQuery();
}

function freshSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] >>> 0;
}

function runWorker(opts: {
  seed: number;
  hz: number;
  stim: string[];
  readout: string[];
  watch: string[];
}): Promise<{
  meanReadoutHz: number;
  readoutRates: number[];
  trains: SeatResult["trains"];
  events: SeatResult["events"];
  nSpikes: number;
  flags: SeatResult["flags"];
}> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener("message", onMsg);
      worker.removeEventListener("error", onErr);
    };
    const onMsg = (ev: MessageEvent) => {
      if (ev.data?.type === "result") {
        cleanup();
        resolve(ev.data);
      } else if (ev.data?.type === "error") {
        cleanup();
        reject(new Error(ev.data.error));
      }
    };
    const onErr = (e: ErrorEvent) => {
      cleanup();
      reject(e.error ?? new Error(e.message));
    };
    worker.addEventListener("message", onMsg);
    worker.addEventListener("error", onErr);
    worker.postMessage({
      type: "run",
      seed: opts.seed,
      hz: opts.hz,
      stimIds: opts.stim,
      readoutIds: opts.readout,
      watchIds: opts.watch,
      ms: RUN_MS,
    });
  });
}

function exportJson(): void {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          session: session.id,
          seed: runSeed,
          hz: Number($<HTMLInputElement>("hz").value),
          bucket: session.bucket,
          seats: seats.map((s) => ({
            seat: s.seat,
            wing: s.wing,
            seed: s.seed,
            hz: s.hz,
            verdict: s.verdict,
            deltaHz: s.deltaHz,
            nSpikes: s.nSpikes,
            flags: s.flags,
          })),
          sciame: majority(seats.map((x) => x.verdict)),
          banc: session.banc,
        },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `plebiscito-${session.id}.json`;
  a.click();
}

async function exportCard(kind: "story" | "sq"): Promise<void> {
  if (!seats.length) {
    toast("Prima premi Run.");
    return;
  }
  const canvas = drawCard({
    w: 1080,
    h: kind === "story" ? 1920 : 1080,
    session,
    sciame: majority(seats.map((s) => s.verdict)),
    copy: $("sciame-copy").textContent || "",
    seats,
    notBanc: manifest.notBanc,
    source: sourceAttr(session),
  });
  const name = `plebiscito-${session.id}-${kind === "story" ? "1080x1920" : "1x1"}.png`;
  const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/png"));
  if (blob && typeof navigator.share === "function") {
    const file = new File([blob], name, { type: "image/png" });
    const payload = { files: [file], title: "IL PLEBISCITO DELLA MOSCA", text: session.domanda };
    if (!navigator.canShare || navigator.canShare(payload)) {
      try {
        await navigator.share(payload);
        return;
      } catch (err) {
        if ((err as DOMException).name === "AbortError") return;
      }
    }
  }
  downloadCanvas(canvas, name);
}

async function shareLink(): Promise<void> {
  writeQuery();
  const data = { title: "IL PLEBISCITO DELLA MOSCA", text: session.domanda, url: location.href };
  if (typeof navigator.share === "function") {
    try {
      await navigator.share(data);
      return;
    } catch (err) {
      if ((err as DOMException).name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(location.href);
    toast("URL copiato.");
    $("status").textContent = "URL copiato.";
  } catch {
    toast(location.href);
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function itNum(n: number, digits = 0): string {
  return n.toLocaleString("it-IT", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

type SmokeRow = { status?: string; meanReadoutHz?: number; stimN?: number; readoutN?: number };

function renderMethods(): void {
  const p = DEFAULT_PARAMS;
  const smoke = (manifest.smoke || {}) as Record<string, SmokeRow>;
  const gz = manifest.packBytesGzip
    ? `${itNum(Math.round(manifest.packBytesGzip / 1024))} KB gzip`
    : "—";
  const packName = manifest.notBanc ? "NOT BANC · stub sintetico" : "BANC v888";

  const facts = [
    ["Pack", packName],
    ["Neuroni", itNum(manifest.n)],
    ["Sinapsi", itNum(manifest.nnz)],
    ["Taglio", `≥ ${manifest.cutoffSynapses} · BFS ${manifest.hops} hop`],
    ["Edgelist", manifest.edgelist],
    ["Peso", `${manifest.mVPerSynapse} mV / sinapsi`],
    ["File", gz],
  ];

  const lif = [
    ["Vrest / reset", `${p.vRest} mV`],
    ["Vth", `${p.vTh} mV`],
    ["τ membrana", `${p.tauM} ms`],
    ["τ sinapsi", `${p.tauSyn} ms`],
    ["Refrattario", `${p.tRef} ms`],
    ["Ritardo", `${p.tDelay} ms`],
    ["Poisson", `f<sub>poi</sub> = ${p.fPoi}`],
    ["Glutammato", "−1 nel CNS, +1 se motore"],
    ["Modulatori", "DA, 5HT, OA, TA = 0"],
  ];

  const soglie = [
    ["fuga / looming", `allarme se |Δ| ≥ ~${THRESHOLDS.escapeNoHz} Hz`],
    ["zucchero", `SI se Δ ≥ ${THRESHOLDS.sugarSiHz} Hz`],
    ["amaro", `NO se Δ ≤ ${THRESHOLDS.bitterNoHz} Hz`],
    ["fermentazione", `SI se Δ ≥ ${THRESHOLDS.fermentationSiHz} Hz`],
    ["meccanosenso", `allarme se |Δ| ≥ ~${THRESHOLDS.mechanoSiHz} Hz`],
    ["nessuno / zitto", `Δ &lt; ${THRESHOLDS.silentHz} Hz → ASTENUTA`],
  ];

  const wings = (["sinistra", "centro", "destra"] as const)
    .map((w) => {
      const pol = WING_POLICY[w];
      const n = SEAT_WING.filter((x) => x === w).length;
      return `<article class="meth-wing ${w}">
        <h4>${esc(pol.label)} · ${n}</h4>
        <p>${esc(pol.blurb)}</p>
        <p class="meth-meta">stim ×${pol.stimScale} · gain ${pol.gain} · soglia ${pol.abstainBelow} Hz${pol.invertAlarm ? " · segno invertito" : ""}</p>
      </article>`;
    })
    .join("");

  const buckets = Object.entries(manifest.buckets)
    .map(([k, v]) => {
      const sm = smoke[k];
      const title = BUCKET_IT[k as Bucket] || k;
      const hz = sm?.meanReadoutHz;
      const badge = sm
        ? sm.status === "ok"
          ? `ok · ${itNum(hz ?? 0, 1)} Hz`
          : `${sm.status || "—"}`
        : v.supported
          ? "in pack"
          : "non in pack";
      const tone = sm?.status === "ok" ? "ok" : sm?.status ? "silent" : v.supported ? "ok" : "silent";
      const ex = v.stimRootIds[0]
        ? `es. stim <code>${esc(v.stimRootIds[0])}</code>${v.readoutRootIds[0] ? ` · readout <code>${esc(v.readoutRootIds[0])}</code>` : ""}`
        : "";
      return `<article class="meth-bucket">
        <header>
          <strong>${esc(title)}</strong>
          <span class="meth-badge ${tone}">${esc(badge)}</span>
        </header>
        <p>${esc(v.note)}</p>
        <p class="meth-meta">stim ${v.stimRootIds.length} · readout ${v.readoutRootIds.length}${ex ? ` · ${ex}` : ""}</p>
      </article>`;
    })
    .join("");

  const limits = (manifest.limitations || []).map((x) => `<li>${esc(x)}</li>`).join("");

  $("methods").innerHTML = `
    <section class="meth-block">
      <h3>Provenienza</h3>
      <p class="meth-lede">${esc(manifest.citation)}</p>
      <dl class="meth-facts">${facts
        .map(([dt, dd]) => `<div><dt>${dt}</dt><dd>${esc(dd)}</dd></div>`)
        .join("")}</dl>
    </section>
    <section class="meth-block">
      <h3>LIF · Shiu 2024</h3>
      <p class="meth-note">Costanti di default su un edgelist BANC. Non è una simulazione fisiologica validata.</p>
      <dl class="meth-facts meth-facts-3">${lif
        .map(([dt, dd]) => `<div><dt>${dt}</dt><dd>${dd}</dd></div>`)
        .join("")}</dl>
    </section>
    <section class="meth-block">
      <h3>Decoder arbitrario</h3>
      <p class="meth-note">Tabella con unità, non ideologia della mosca. Il seme in URL (<code>?seed=</code>) ripete un Run.</p>
      <div class="meth-wings">${wings}</div>
      <dl class="meth-facts">${soglie
        .map(([dt, dd]) => `<div><dt>${dt}</dt><dd>${dd}</dd></div>`)
        .join("")}</dl>
    </section>
    <section class="meth-block">
      <h3>Canali nel pack</h3>
      <div class="meth-buckets">${buckets}</div>
    </section>
    <section class="meth-block">
      <h3>Limiti</h3>
      <ul class="meth-limits">${limits}</ul>
    </section>
  `;
}

async function boot(): Promise<void> {
  $("status").textContent = "Scarico pack e voti…";
  const q = parseQuery();
  const loaded = await loadPackAndManifest(
    asset("packs/circuit.pack.bin.gz"),
    asset("packs/circuit.manifest.json"),
  );
  manifest = loaded.manifest;
  packBuf = loaded.buffer;
  labels = new Map(manifest.neurons.map((n) => [n.rootId, n.cellType || n.cellClass || n.rootId]));
  if (manifest.notBanc) $("stamp-notbanc").hidden = false;
  renderMethods();

  worker = new Worker(new URL("./engine/worker.ts", import.meta.url), { type: "module" });
  await new Promise<void>((resolve, reject) => {
    const onReady = (ev: MessageEvent) => {
      if (ev.data?.type === "ready") {
        worker.removeEventListener("message", onReady);
        worker.removeEventListener("error", onErr);
        resolve();
      }
      if (ev.data?.type === "error") {
        worker.removeEventListener("message", onReady);
        worker.removeEventListener("error", onErr);
        reject(new Error(ev.data.error));
      }
    };
    const onErr = (e: ErrorEvent) => {
      worker.removeEventListener("message", onReady);
      worker.removeEventListener("error", onErr);
      reject(e);
    };
    worker.addEventListener("message", onReady);
    worker.addEventListener("error", onErr);
    const copy = packBuf.slice(0);
    worker.postMessage({ type: "init", pack: copy }, [copy]);
  });

  const fr = await fetch(asset("sessions.json"));
  feed = (await fr.json()) as Feed;
  fillSessions();
  session = feed.sessions.find((s) => s.id === q.s) || feed.sessions[0];
  if (q.seed != null && Number.isFinite(q.seed)) {
    runSeed = q.seed >>> 0;
    pendingSeed = runSeed;
  }
  if (q.hz != null) setHz(q.hz);
  renderSession({ keepHz: q.hz != null });
  $("boot-bar").classList.add("off");
  try {
    cloud = new BrainCloud($<HTMLCanvasElement>("cloud"), loaded.pack);
    $("cloud-replay").onclick = () => cloud?.replay();
  } catch (e) {
    console.warn("cloud viz", e);
  }
  $("status").textContent = manifest.notBanc
    ? "Pack NOT BANC. UI pronta. Non è un cervello di mosca."
    : `Pack BANC v888 · ${manifest.n} neuroni · ${manifest.nnz} sinapsi. Pronto.`;

  $("session").onchange = () => {
    const id = $<HTMLSelectElement>("session").value;
    session = feed.sessions.find((s) => s.id === id)!;
    renderSession();
  };
  $("prev-s").onclick = () => shiftSession(-1);
  $("next-s").onclick = () => shiftSession(1);
  $("hz").oninput = () => setHz(Number($<HTMLInputElement>("hz").value));
  $("hz-range").oninput = () => setHz(Number($<HTMLInputElement>("hz-range").value));
  $("run").onclick = () => void runSciame();
  $("pause").onclick = () => {
    paused = true;
    $("status").textContent = "Pausa.";
  };
  $("reset").onclick = () => {
    runGen += 1;
    paused = true;
    running = false;
    seats = [];
    revealedN = 0;
    slamSeat = -1;
    $<HTMLButtonElement>("run").disabled = false;
    setProgress(0, 0);
    $("sciame-card").classList.remove("counting");
    renderSession({ keepHz: true });
    $("status").textContent = "Reset.";
  };
  $("card-story").onclick = () => void exportCard("story");
  $("card-sq").onclick = () => void exportCard("sq");
  $("export-json").onclick = exportJson;
  $("share").onclick = () => void shareLink();
  document.querySelectorAll<HTMLButtonElement>(".tabs [data-tab]").forEach((btn) => {
    btn.onclick = () => setTab(btn.dataset.tab || "sciame");
  });
  const info = document.getElementById("info") as HTMLDialogElement | null;
  $("open-info").onclick = () => info?.showModal();
  info?.addEventListener("click", (ev) => {
    if (ev.target === info) info.close();
  });
  layoutChrome();
  window.addEventListener("resize", () => {
    layoutChrome();
    cloud?.resize();
    if (seats[selectedSeat] && selectedSeat < revealedN) drawRaster(seats[selectedSeat]!);
    else drawRaster(null);
  });
}

boot().catch((err) => {
  console.error(err);
  $("boot-bar").classList.add("off");
  $("status").textContent = String(err);
});

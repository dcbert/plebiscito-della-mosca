# Report — circuits, IDs, checks

Lab notes for the default pack. The joke lives in the [README](README.md).

Built against **BANC v888** compiled public data (not FAFB, not MaleCNS, not synthetic).

- Meta: `banc_888_meta.feather` (188 508 rows). Primary key `banc_888_id` kept as decimal string / uint64.
- Edgelist: `banc_888_edgelist_simple_v3.feather` (13 620 865 edges). Filter `count ≥ 5` → 1 926 146 edges.
- Pack: 2 781 neurons, 51 440 edges, **152 282 bytes gzip** (`data/packs/circuit.pack.bin.gz`).
- Materialization 888, snapshot 2026-04-16.

The LIF uses Shiu et al. 2024 constants. **This is not validated BANC physiology.** Motor Δrate is not walking or flying.

## Circuits in the default pack

BFS 2 hops from a seed union of 264 identified neurons, then cap at 2 800 neurons / 28 000 strongest edges (actual cap landed at 51k edges among 2 781 neurons because seeds were forced back in).

### escape (first loop: «Più militari nelle strade?»)

- Stim: LPLC2 (32), LC4 (20), LPLC1 (8). Example roots: `720575941437855264` (LPLC2), `720575941454999533`-class LC4 in the same list.
- Readout:
  - DNp01 (giant fibre): `720575941509145950`, `720575941451068597`
  - DNp02: `720575941409519022`, `720575941507073303`
  - DNp04: `720575941559874831`, `720575941583264121`
  - DNp06: `720575941611791590`, `720575941657879576`
  - jump_escape TTM: `720575941500579913` (`tergotrochanter_extensor_TT`), `720575941476434996`
  - wing-power DLM/DVM (labelled as motor Δrate, **not flight**)
- Smoke (400 ms, 150 Hz Poisson on stim, seed 1): mean readout **15.9 Hz**, mean all 4.4 Hz, max 230 Hz (driven sensory cells). Status **ok**.
- Arbitrary table: Δ ≥ 8 Hz → **NO**. Copy: «NO. Più stivali, più scacciamosche.»

### sugar

- Stim: labellum sugar GRNs LB3b (26), LB3c (10), dorsal_tpGRN (4). Example `720575941537516786`.
- Readout: proboscis/pharynx MN1, MN7, MN4a, **MN10** (3), MN5, MN8, MN9, …
- Smoke: mean readout **0.92 Hz**. Status **ok** (not silent). Arbitrary table: Δ ≥ 0.5 Hz → **SI**.

### bitter

- Stim: labellum bitter (Gr33a) 24 cells, e.g. `720575941505592901`.
- Same feeding motors as sugar.
- Smoke: readout **0.0 Hz** (`silent_readout`). The cut does not propagate aversive suppression to those motors. **The app abstains** (silent-net guard). We did not invent a bitter-to-motor path.

### fermentation

- Stim: ORN_DM1 / VA2 / DM2 / VM2 (36 cells). Food/fruit glomeruli, **not** a validated fermentation circuit.
- Smoke: readout **0.0 Hz**. **Abstain** at runtime. Casa Green is also **absent** from the Openpolis XIX feed we could reach — no fake vote was added.

### mechano

- Stim: Johnston organ A + front-leg club chordotonal (28 cells).
- Readout: escape DNs + TTM + a few leg motors (stand-in; not “the fly walks the bridge”).
- Smoke: mean readout **8.1 Hz**. Arbitrary table: Δ ≥ 4 Hz → **SI**. Ponte sullo Stretto (Openpolis `19-71-141`, 2023-05-24, fav 103 / contr 49 / ast 3) uses this bucket.

### none (always available)

Tasse / ISEE / IRPEF / legge elettorale / procedurali. No stimulus. ASTENUTA.  
Pinned teaching example: Senato em. 1.202 legge elettorale (`19-453-2`, 2026-09-14, fav 54 / contr 93 / ast 2, respinta).

## Silent / runaway

| bucket | smoke status | mean readout Hz | mean all Hz | max Hz |
|---|---|---:|---:|---:|
| escape | ok | 15.9 | 4.4 | 230 |
| sugar | ok | 0.92 | 2.4 | 188 |
| bitter | silent_readout | 0.0 | 1.2 | 173 |
| fermentation | silent_readout | 0.0 | 3.1 | 210 |
| mechano | ok | 8.1 | 2.0 | 188 |

- Silent readout → UI ASTENUTA, never a forced joke.
- Runaway guard: mean rate > 200 Hz (not max; driven Poisson cells can exceed 150 Hz).
- NaN aborts the run.
- Baseline of the Shiu model is 0 Hz by assumption.

## Buckets abstained, and why

- **bitter** — real Gr33a IDs exist; the *cut graph* does not move feeding motors. Abstain rather than fake a synapse.
- **fermentation** — ORNs exist; feeding motors stay silent in this cut. Abstain. No Casa Green vote found in Openpolis XIX search.
- **immigrazione as people** — classifier forces `none` unless the text is the biological pest *Drosophila suzukii*.
- **Pontida** — not a parliamentary vote. Not in the feed.

## Votes shipped

Pinned (real identifiers; counts from Openpolis detail, never invented):

1. Strade Sicure risoluzione 7-00342 — **archivio**, `non_votata_in_aula`, no counts.
2. Fiducia DL sicurezza 2026 `vs19_648_123` — fav 203 / contr 117 / ast 3.
3. Conversione DL ponte Stretto `19-71-141` — fav 103 / contr 49 / ast 3.
4. Conversione decreto Irpef `vs19_495_008` — fav 153 / contr 0 / ast 101 → none.
5. Delega nucleare 2026 — fav 155 / contr 86 / ast 8 → none.
6. Fiducia DL infrastrutture e Pnrr — fav 104 / contr 62 / ast 1 → mechano.
7. Emendamento legge elettorale `19-453-2` — fav 54 / contr 93 / ast 2 → none.

Plus last-7-days key/final/confidence leftovers, classified in the app.

## Transmitter rule (documented)

acetylcholine +1; GABA/histamine −1; glutamate −1 in CNS and **+1 if `super_class == motor`** (NMJ); dopamine/serotonin/octopamine/tyramine 0; unknown 0.

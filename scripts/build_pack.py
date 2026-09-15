#!/usr/bin/env python3
"""Cut tractable BANC v888 circuits into a compact browser pack.

Never invent neuron IDs. If the compiled feathers are missing, write a
schema-compatible stub labelled NOT BANC.
"""
from __future__ import annotations

import gzip
import json
import math
import struct
import sys
import urllib.request
from collections import defaultdict, deque
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "cache"
PACK_DIR = ROOT / "data" / "packs"
PUBLIC = ROOT / "app" / "public" / "packs"
GCS_HTTP = (
    "https://storage.googleapis.com/lee-lab_brain-and-nerve-cord-fly-connectome"
    "/compiled_data/banc_888"
)
META_NAME = "banc_888_meta.feather"
EDGE_NAME = "banc_888_edgelist_simple_v3.feather"
MAGIC = b"BANCpack"
VERSION = 1
MV_PER_SYN = 0.275
CUTOFF = 5
HOPS = 2
MAX_NEURONS = 2800
MAX_EDGES = 28000

ROLE_SENSORY = 1
ROLE_DESCENDING = 2
ROLE_MOTOR = 4
ROLE_INTRINSIC = 8
ROLE_VISUAL = 16


def parse_xyz(val) -> tuple[float, float, float] | None:
    if val is None:
        return None
    if isinstance(val, (list, tuple)) and len(val) >= 3:
        return float(val[0]), float(val[1]), float(val[2])
    s = str(val).strip().replace("[", "").replace("]", "")
    parts = [p.strip() for p in s.split(",") if p.strip()]
    if len(parts) < 3:
        return None
    try:
        return float(parts[0]), float(parts[1]), float(parts[2])
    except ValueError:
        return None


def log(msg: str) -> None:
    print(msg, flush=True)


def download(name: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    url = f"{GCS_HTTP}/{name}"
    log(f"download {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "plebiscito-della-mosca/0.1"})
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
        while True:
            chunk = r.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)


def ensure_files() -> bool:
    CACHE.mkdir(parents=True, exist_ok=True)
    ok = True
    for name in (META_NAME, EDGE_NAME):
        path = CACHE / name
        if path.exists() and path.stat().st_size > 1000:
            log(f"cache hit {path} ({path.stat().st_size} bytes)")
            continue
        try:
            download(name, path)
        except Exception as e:
            log(f"FAILED to download {name}: {e}")
            ok = False
    return ok


def as_id_str(series: pd.Series) -> pd.Series:
    return series.astype(str).str.replace(r"\.0$", "", regex=True)


def nt_sign(nt: str, super_class: str) -> int:
    nt = (nt or "").lower()
    sc = (super_class or "").lower()
    if nt == "acetylcholine":
        return 1
    if nt in ("gaba", "histamine"):
        return -1
    if nt == "glutamate":
        return 1 if sc == "motor" else -1
    return 0


def pick(meta: pd.DataFrame, mask: pd.Series, cap: int | None = None, prefer_proofread: bool = True) -> list[str]:
    sub = meta.loc[mask].copy()
    if prefer_proofread and "proofread" in sub.columns:
        pr = sub["proofread"].fillna("").astype(str).str.lower().isin(("true", "t", "1", "yes"))
        if pr.any():
            sub = pd.concat([sub[pr], sub[~pr]])
    ids = list(dict.fromkeys(sub["banc_888_id"].tolist()))
    if cap is not None:
        ids = ids[:cap]
    return ids


def bucket_seeds(meta: pd.DataFrame) -> dict:
    ct = meta["cell_type"]
    fafb = meta["fafb_cell_type"]
    sub = meta["cell_sub_class"]
    fn = meta["cell_function"]
    det = meta["cell_function_detailed"]
    cls = meta["cell_class"]
    sc = meta["super_class"]

    lplc2 = pick(meta, ct.eq("LPLC2") | fafb.eq("LPLC2"), cap=32)
    lc4 = pick(meta, ct.eq("LC4") | fafb.eq("LC4"), cap=20)
    lplc1 = pick(meta, ct.eq("LPLC1") | fafb.eq("LPLC1"), cap=8)
    dns = pick(meta, ct.isin(["DNp01", "DNp02", "DNp04", "DNp06"]))
    jump = pick(meta, fn.eq("jump_escape") | ct.str.contains(r"tergotrochanter_extensor_TT", regex=True))
    dlm = pick(meta, ct.str.match(r"^DLM") | (fn.eq("wing_power") & cls.eq("wing_motor_neuron")), cap=12)

    sugar = pick(
        meta,
        det.str.contains(r"sugar", case=False, regex=True)
        & cls.str.contains("gustatory")
        & (sub.str.contains("labellum") | ct.str.match(r"^LB3")),
        cap=40,
    )
    bitter = pick(
        meta,
        det.str.contains(r"bitter", case=False, regex=True) & cls.str.contains("gustatory") & sub.str.contains("labellum"),
        cap=24,
    )
    feeding_mn = pick(meta, cls.eq("proboscis_motor_neuron") | ct.isin(["MN10", "MN1", "MN5", "MN8", "MN9"]))

    ferment_orn = pick(meta, ct.isin(["ORN_DM1", "ORN_VA2", "ORN_DM2", "ORN_VM2"]), cap=36)
    # Johnston's organ + front-leg club chordotonal: real mechanosensory, vibration / wind / substrate
    mechano = pick(
        meta,
        (cls.eq("chordotonal_organ_neuron") & sub.str.contains(r"front_leg_club|johnstons_organ_A", regex=True)),
        cap=28,
    )
    leg_mn = pick(meta, cls.eq("leg_motor_neuron") & fn.eq("leg_motor"), cap=16)

    buckets = {
        "escape": {
            "stim": lplc2 + lc4 + lplc1,
            "readout": dns + jump + dlm,
            "note": "Looming visual projection (LPLC2, LC4, LPLC1) onto giant-fibre / escape DNs and jump/wing-power motors. Motor firing is Δrate, not flight.",
        },
        "sugar": {
            "stim": sugar,
            "readout": feeding_mn,
            "note": "Labellum sugar GRNs (Gr5a/Gr64f annotations) onto proboscis/pharynx motor neurons.",
        },
        "bitter": {
            "stim": bitter,
            "readout": feeding_mn,
            "note": "Labellum bitter GRNs (Gr33a) onto the same feeding motors. Expected suppression, not invented IDs.",
        },
        "fermentation": {
            "stim": ferment_orn,
            "readout": feeding_mn,
            "note": "Antennal ORNs of food/fruit glomeruli DM1, VA2, DM2, VM2. Not a validated fermentation circuit.",
        },
        "mechano": {
            "stim": mechano,
            "readout": dns[:4] + jump + leg_mn,
            "note": "Johnston organ A and front-leg club chordotonal neurons. Used for ponte/cantieri/treni only as mechanosensory stand-in.",
        },
    }
    for b, spec in buckets.items():
        spec["stim"] = list(dict.fromkeys(spec["stim"]))
        spec["readout"] = list(dict.fromkeys(spec["readout"]))
        log(f"bucket {b}: stim={len(spec['stim'])} readout={len(spec['readout'])}")
        if not spec["stim"]:
            log(f"  ABSTAIN {b}: no BANC stim IDs")
        if not spec["readout"]:
            log(f"  ABSTAIN {b}: no BANC readout IDs")
    return buckets


def cut_graph(meta: pd.DataFrame, edges: pd.DataFrame, buckets: dict) -> tuple[list[str], pd.DataFrame]:
    keep: set[str] = set()
    for spec in buckets.values():
        keep.update(spec["stim"])
        keep.update(spec["readout"])
    seeds = set(keep)
    log(f"seed union {len(seeds)}")

    e = edges[edges["count"] >= CUTOFF].copy()
    e["pre"] = as_id_str(e["pre"])
    e["post"] = as_id_str(e["post"])
    log(f"edges count>={CUTOFF}: {len(e)}")

    down: dict[str, list[str]] = defaultdict(list)
    up: dict[str, list[str]] = defaultdict(list)
    for pre, post in zip(e["pre"].to_numpy(), e["post"].to_numpy()):
        down[pre].append(post)
        up[post].append(pre)

    frontier = deque(seeds)
    dist = {i: 0 for i in seeds}
    while frontier:
        u = frontier.popleft()
        if dist[u] >= HOPS:
            continue
        for v in down.get(u, ()):
            if v not in dist:
                dist[v] = dist[u] + 1
                frontier.append(v)
        # also one hop upstream of readouts already in keep
        if u in seeds:
            for v in up.get(u, ()):
                if v not in dist:
                    dist[v] = dist[u] + 1
                    frontier.append(v)

    keep = set(dist)
    # drop glia / not_a_neuron / trachea
    meta_idx = meta.set_index("banc_888_id")
    cleaned = set()
    for i in keep:
        if i not in meta_idx.index:
            continue
        sc = str(meta_idx.at[i, "super_class"]) if "super_class" in meta_idx.columns else ""
        if sc in ("glia", "not_a_neuron", "trachea"):
            continue
        cleaned.add(i)
    keep = cleaned | seeds
    log(f"after BFS hops={HOPS}: {len(keep)}")

    if len(keep) > MAX_NEURONS:
        # keep seeds + nearest by hop, then by degree
        deg = {i: len(down.get(i, ())) + len(up.get(i, ())) for i in keep}

        def rank(i: str) -> tuple:
            return (0 if i in seeds else 1, dist.get(i, 99), -deg.get(i, 0))

        ordered = sorted(keep, key=rank)
        keep = set(ordered[:MAX_NEURONS]) | seeds
        log(f"capped to {len(keep)} neurons")

    sub = e[e["pre"].isin(keep) & e["post"].isin(keep)]
    if len(sub) > MAX_EDGES:
        sub = sub.sort_values("count", ascending=False).head(MAX_EDGES)
        used = set(sub["pre"]) | set(sub["post"]) | seeds
        keep = keep & used | seeds
        sub = e[e["pre"].isin(keep) & e["post"].isin(keep)]
        log(f"capped edges to {len(sub)}")
    log(f"final neurons={len(keep)} edges={len(sub)}")
    return sorted(keep), sub


def role_of(row: pd.Series) -> int:
    sc = str(row.get("super_class") or "")
    bits = 0
    if sc == "sensory" or sc.startswith("sensory"):
        bits |= ROLE_SENSORY
    if sc == "descending" or sc == "sensory_descending":
        bits |= ROLE_DESCENDING
    if sc == "motor":
        bits |= ROLE_MOTOR
    if "intrinsic" in sc or sc in ("central_brain_intrinsic", "ventral_nerve_cord_intrinsic", "optic_lobe_intrinsic"):
        bits |= ROLE_INTRINSIC
    if sc in ("visual_projection", "optic_lobe_intrinsic", "visual_centrifugal"):
        bits |= ROLE_VISUAL
    return bits


def write_pack(ids: list[str], sub: pd.DataFrame, meta: pd.DataFrame, buckets: dict, out_bin: Path, out_man: Path) -> dict:
    meta_idx = meta.set_index("banc_888_id")
    local = {rid: i for i, rid in enumerate(ids)}
    n = len(ids)
    # CSR
    posts = [[] for _ in range(n)]
    weights = [[] for _ in range(n)]
    for pre, post, count in zip(sub["pre"].to_numpy(), sub["post"].to_numpy(), sub["count"].to_numpy()):
        if pre not in local or post not in local:
            continue
        i = local[pre]
        j = local[post]
        try:
            nt = str(meta_idx.at[pre, "neurotransmitter_predicted"] or "")
            sc = str(meta_idx.at[pre, "super_class"] or "")
        except Exception:
            nt, sc = "", ""
        sign = nt_sign(nt, sc)
        w = float(count) * MV_PER_SYN * sign
        posts[i].append(j)
        weights[i].append(w)

    indptr = [0]
    indices: list[int] = []
    wflat: list[float] = []
    for i in range(n):
        indices.extend(posts[i])
        wflat.extend(weights[i])
        indptr.append(len(indices))
    nnz = len(indices)

    roots = np.array([int(x) for x in ids], dtype=np.uint64)
    nt_s = np.zeros(n, dtype=np.int8)
    roles = np.zeros(n, dtype=np.uint8)
    labels_by_id: dict[str, dict] = {}
    wanted: set[str] = set()
    for spec in buckets.values():
        wanted.update(spec["stim"])
        wanted.update(spec["readout"])
    for i, rid in enumerate(ids):
        try:
            row = meta_idx.loc[rid]
            if isinstance(row, pd.DataFrame):
                row = row.iloc[0]
            nt_s[i] = nt_sign(str(row.get("neurotransmitter_predicted") or ""), str(row.get("super_class") or ""))
            roles[i] = role_of(row)
            rec = {
                "rootId": rid,
                "cellType": str(row.get("cell_type") or ""),
                "cellClass": str(row.get("cell_class") or ""),
                "superClass": str(row.get("super_class") or ""),
                "nt": str(row.get("neurotransmitter_predicted") or ""),
                "function": str(row.get("cell_function") or ""),
                "functionDetailed": str(row.get("cell_function_detailed") or ""),
            }
            if rid in wanted:
                labels_by_id[rid] = rec
        except Exception:
            pass
    labels = list(labels_by_id.values())

    xyz = np.zeros((n, 3), dtype=np.float32)
    for i, rid in enumerate(ids):
        try:
            row = meta_idx.loc[rid]
            if isinstance(row, pd.DataFrame):
                row = row.iloc[0]
            p = parse_xyz(row.get("root_position_nm") or row.get("position"))
            if p:
                xyz[i] = p
        except Exception:
            pass
    # center, uniform scale — keep BANC aspect (brain + cord)
    mask = np.any(xyz != 0, axis=1)
    if mask.any():
        mid = xyz[mask].mean(axis=0)
        xyz[mask] -= mid
        scale = float(np.percentile(np.abs(xyz[mask]), 98)) or 1.0
        xyz[mask] /= scale

    payload = bytearray()
    payload += MAGIC
    payload += struct.pack("<HHII", VERSION, 0, n, nnz)
    payload += np.asarray(indptr, dtype=np.uint32).tobytes()
    payload += np.asarray(indices, dtype=np.uint32).tobytes()
    payload += np.asarray(wflat, dtype=np.float32).tobytes()
    payload += roots.tobytes()
    payload += nt_s.tobytes()
    payload += roles.tobytes()
    payload += xyz.tobytes()

    raw_path = out_bin
    gz_path = out_bin.with_suffix(out_bin.suffix + ".gz")
    raw_path.write_bytes(payload)
    with gzip.open(gz_path, "wb", compresslevel=9) as f:
        f.write(payload)
    log(f"wrote {raw_path} {len(payload)} bytes; gzip {gz_path.stat().st_size} bytes")

    bman = {}
    for name, spec in buckets.items():
        stim = [i for i in spec["stim"] if i in local]
        readout = [i for i in spec["readout"] if i in local]
        bman[name] = {
            "stimRootIds": stim,
            "readoutRootIds": readout,
            "stimLocal": [local[i] for i in stim],
            "readoutLocal": [local[i] for i in readout],
            "note": spec["note"],
            "supported": bool(stim and readout),
        }

    manifest = {
        "dataset": "BANC",
        "notBanc": False,
        "materialization": 888,
        "edgelist": "banc_888_edgelist_simple_v3",
        "meta": "banc_888_meta.feather",
        "snapshot": "2026-04-16",
        "citation": "Bates, Phelps, Kim, Yang et al., Nature 2026",
        "cutoffSynapses": CUTOFF,
        "hops": HOPS,
        "n": n,
        "nnz": nnz,
        "mVPerSynapse": MV_PER_SYN,
        "transmitterRule": {
            "acetylcholine": +1,
            "gaba": -1,
            "histamine": -1,
            "glutamate": "−1 CNS, +1 if super_class==motor (NMJ)",
            "modulatory": 0,
            "unknown": 0,
        },
        "packFile": gz_path.name,
        "packBytesGzip": gz_path.stat().st_size,
        "buckets": bman,
        "neurons": labels,
        "limitations": [
            "Anatomical model, not physiology. Shiu 2024 LIF constants on a BANC edgelist are not a validated BANC simulation.",
            "Motor Δrate is not walking, flying, government, or endorsement.",
        ],
    }
    out_man.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def smoke_lif(ids: list[str], sub: pd.DataFrame, meta: pd.DataFrame, buckets: dict) -> dict:
    """Tiny closed-form LIF on the cut graph to catch silent/runaway nets."""
    local = {rid: i for i, rid in enumerate(ids)}
    n = len(ids)
    meta_idx = meta.set_index("banc_888_id")
    posts = [[] for _ in range(n)]
    wts = [[] for _ in range(n)]
    for pre, post, count in zip(sub["pre"].to_numpy(), sub["post"].to_numpy(), sub["count"].to_numpy()):
        if pre not in local or post not in local:
            continue
        i, j = local[pre], local[post]
        try:
            nt = str(meta_idx.at[pre, "neurotransmitter_predicted"] or "")
            sc = str(meta_idx.at[pre, "super_class"] or "")
        except Exception:
            nt, sc = "", ""
        posts[i].append(j)
        wts[i].append(float(count) * MV_PER_SYN * nt_sign(nt, sc))

    v_rest, v_th, tau_m, tau_s = -52.0, -45.0, 20.0, 5.0
    t_ref, t_dly, dt = 2.2, 1.8, 0.1
    f_poi, w_syn = 250.0, MV_PER_SYN
    delay_steps = max(1, int(round(t_dly / dt)))
    steps = int(400 / dt)
    rng = np.random.default_rng(1)
    report = {}
    k = tau_s / (tau_s - tau_m)

    for name, spec in buckets.items():
        stim = [local[i] for i in spec["stim"] if i in local]
        readout = [local[i] for i in spec["readout"] if i in local]
        if not stim or not readout:
            report[name] = {"status": "skipped", "reason": "missing stim or readout"}
            continue
        v = np.full(n, v_rest)
        g = np.zeros(n)
        ref = np.zeros(n)
        pending = [np.zeros(n) for _ in range(delay_steps)]
        spikes = np.zeros(n, dtype=np.int32)
        hz = 150.0
        p = 1.0 - math.exp(-hz * (dt / 1000.0))
        nan = False
        for t in range(steps):
            g += pending[t % delay_steps]
            pending[t % delay_steps][:] = 0
            g1 = g * math.exp(-dt / tau_s)
            v = v_rest + (v - v_rest - g * k) * math.exp(-dt / tau_m) + g * k * math.exp(-dt / tau_s)
            g = g1
            ref = np.maximum(0.0, ref - dt)
            # poisson kicks on stim
            kicks = rng.random(len(stim)) < p
            if kicks.any():
                v[np.array(stim)[kicks]] += w_syn * f_poi
            fire = (v > v_th) & (ref <= 0)
            if not np.isfinite(v).all():
                nan = True
                break
            idx = np.flatnonzero(fire)
            if idx.size:
                spikes[idx] += 1
                v[idx] = v_rest
                g[idx] = 0
                ref[idx] = t_ref
                for i in idx:
                    slot = pending[(t + delay_steps) % delay_steps]
                    for j, w in zip(posts[i], wts[i]):
                        slot[j] += w
        dur_s = steps * dt / 1000.0
        rates = spikes / dur_s
        mean_read = float(rates[readout].mean()) if readout else 0.0
        mean_all = float(rates.mean())
        status = "ok"
        if nan:
            status = "nan"
        elif mean_read < 0.5:
            status = "silent_readout"
        elif mean_all > 200:
            status = "runaway"
        report[name] = {
            "status": status,
            "stimN": len(stim),
            "readoutN": len(readout),
            "meanReadoutHz": round(mean_read, 3),
            "meanAllHz": round(mean_all, 3),
            "maxHz": round(float(rates.max()), 3),
        }
        log(f"smoke {name}: {report[name]}")
    return report


def write_stub() -> dict:
    """Schema-compatible synthetic graph, labelled NOT BANC."""
    log("WRITING NOT BANC STUB — real BANC files were not available")
    n = 24
    # tiny chain: 8 sensory → 8 inter → 8 motor
    ids = [str(10_000 + i) for i in range(n)]
    rows = []
    for i in range(8):
        rows.append((ids[i], ids[8 + i], 12))
        rows.append((ids[8 + i], ids[16 + i], 12))
        if i + 1 < 8:
            rows.append((ids[8 + i], ids[8 + ((i + 1) % 8)], 6))
    sub = pd.DataFrame(rows, columns=["pre", "post", "count"])
    meta = pd.DataFrame(
        {
            "banc_888_id": ids,
            "cell_type": ["STUB_SENS"] * 8 + ["STUB_INT"] * 8 + ["STUB_MN"] * 8,
            "cell_class": ["sensory"] * 8 + ["intrinsic"] * 8 + ["motor"] * 8,
            "super_class": ["sensory"] * 8 + ["central_brain_intrinsic"] * 8 + ["motor"] * 8,
            "neurotransmitter_predicted": ["acetylcholine"] * 16 + ["acetylcholine"] * 8,
            "cell_function": [""] * 16 + ["jump_escape"] * 8,
            "cell_function_detailed": [""] * 24,
        }
    )
    buckets = {
        "escape": {"stim": ids[:8], "readout": ids[16:], "note": "NOT BANC stub."},
        "sugar": {"stim": [], "readout": [], "note": "NOT BANC — abstain."},
        "bitter": {"stim": [], "readout": [], "note": "NOT BANC — abstain."},
        "fermentation": {"stim": [], "readout": [], "note": "NOT BANC — abstain."},
        "mechano": {"stim": [], "readout": [], "note": "NOT BANC — abstain."},
    }
    PACK_DIR.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    man = write_pack(ids, sub, meta, buckets, PACK_DIR / "circuit.pack.bin", PACK_DIR / "circuit.manifest.json")
    man["notBanc"] = True
    man["dataset"] = "NOT BANC"
    man["limitations"] = [
        "THIS PACK IS NOT BANC. Synthetic graph for UI development.",
        "Swap in real files: python scripts/build_pack.py after downloading banc_888_meta.feather and banc_888_edgelist_simple_v3.feather into data/cache/.",
    ]
    (PACK_DIR / "circuit.manifest.json").write_text(json.dumps(man, indent=2), encoding="utf-8")
    copy_public()
    return man


def copy_public() -> None:
    PUBLIC.mkdir(parents=True, exist_ok=True)
    for p in PACK_DIR.glob("circuit.*"):
        dest = PUBLIC / p.name
        dest.write_bytes(p.read_bytes())


def main() -> int:
    PACK_DIR.mkdir(parents=True, exist_ok=True)
    if not ensure_files():
        write_stub()
        return 2
    log("loading meta")
    meta = pd.read_feather(CACHE / META_NAME)
    meta["banc_888_id"] = as_id_str(meta["banc_888_id"])
    for c in (
        "cell_type",
        "fafb_cell_type",
        "cell_class",
        "cell_sub_class",
        "super_class",
        "cell_function",
        "cell_function_detailed",
        "neurotransmitter_predicted",
        "proofread",
    ):
        if c in meta.columns:
            meta[c] = meta[c].fillna("").astype(str)
    log(f"meta {meta.shape} id0={meta['banc_888_id'].iloc[0]}")
    buckets = bucket_seeds(meta)
    log("loading edgelist (this is the 336 MB file, once)")
    edges = pd.read_feather(CACHE / EDGE_NAME)
    ids, sub = cut_graph(meta, edges, buckets)
    # drop empty-bucket IDs that fell out of the cut — already handled
    smoke = smoke_lif(ids, sub, meta, buckets)
    man = write_pack(ids, sub, meta, buckets, PACK_DIR / "circuit.pack.bin", PACK_DIR / "circuit.manifest.json")
    man["smoke"] = smoke
    (PACK_DIR / "circuit.manifest.json").write_text(json.dumps(man, indent=2), encoding="utf-8")
    (PACK_DIR / "smoke.json").write_text(json.dumps(smoke, indent=2), encoding="utf-8")
    copy_public()
    log("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())

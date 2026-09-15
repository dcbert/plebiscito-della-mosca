#!/usr/bin/env python3
"""Append BANC soma xyz onto an existing pack without reloading the edgelist."""
from __future__ import annotations

import gzip
import struct
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "data" / "packs" / "circuit.pack.bin"
META = ROOT / "data" / "cache" / "banc_888_meta.feather"
PUBLIC = ROOT / "app" / "public" / "packs"


def parse_xyz(val):
    if val is None:
        return None
    s = str(val).strip().replace("[", "").replace("]", "")
    parts = [p.strip() for p in s.split(",") if p.strip()]
    if len(parts) < 3:
        return None
    try:
        return float(parts[0]), float(parts[1]), float(parts[2])
    except ValueError:
        return None


def main() -> int:
    raw = PACK.read_bytes()
    if raw[:8] != b"BANCpack":
        print("bad magic")
        return 1
    _ver, _flags, n, nnz = struct.unpack_from("<HHII", raw, 8)
    o = 20 + (n + 1) * 4 + nnz * 4 + nnz * 4
    roots = np.frombuffer(raw, dtype="<u8", count=n, offset=o)
    o += n * 8 + n + n  # skip nt + role
    head = raw[:o]
    print(f"n={n} nnz={nnz} head={len(head)}")

    meta = pd.read_feather(META)
    meta["banc_888_id"] = meta["banc_888_id"].astype(str)
    idx = meta.set_index("banc_888_id")
    xyz = np.zeros((n, 3), dtype=np.float32)
    hit = 0
    for i, rid in enumerate(roots.tolist()):
        key = str(int(rid))
        try:
            row = idx.loc[key]
            if isinstance(row, pd.DataFrame):
                row = row.iloc[0]
            p = parse_xyz(row.get("root_position_nm") if "root_position_nm" in row else None) or parse_xyz(
                row.get("position")
            )
            if p:
                xyz[i] = p
                hit += 1
        except Exception:
            pass
    print(f"coords {hit}/{n}")
    mask = np.any(xyz != 0, axis=1)
    if mask.any():
        mid = xyz[mask].mean(axis=0)
        xyz[mask] -= mid
        scale = float(np.percentile(np.abs(xyz[mask]), 98)) or 1.0
        xyz[mask] /= scale
    out = head + xyz.tobytes()
    PACK.write_bytes(out)
    gz = PACK.with_suffix(PACK.suffix + ".gz")
    with gzip.open(gz, "wb", compresslevel=9) as f:
        f.write(out)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    (PUBLIC / PACK.name).write_bytes(out)
    (PUBLIC / gz.name).write_bytes(gz.read_bytes())
    print(f"wrote {PACK} {len(out)} gzip {gz.stat().st_size}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

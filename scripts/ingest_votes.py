#!/usr/bin/env python3
"""Refresh sessions.json from Openpolis (Camera SPARQL fallback).

Never invent vote counts. Pin a starter deck + last 7 days of key/final/confidence.
"""
from __future__ import annotations

import json
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "sessions.json"
PUBLIC = ROOT / "app" / "public" / "sessions.json"
MANIFEST = ROOT / "data" / "packs" / "circuit.manifest.json"
OP = "https://service.opdm.openpolis.io/api-openparlamento/v1/19/votings/"
UA = {"User-Agent": "plebiscito-della-mosca/0.1 (satire; attribution to Openpolis)"}

# Hardcoded classifier lives in the app too. Ingest stores the official text;
# the app re-classifies. We still pin bucket for the starter deck after allow-list.
PINNED = [
    {
        "id": "strade-sicure-7-00342",
        "pin": True,
        "archivio": True,
        "domanda": "Più militari nelle strade?",
        "bucket": "escape",
        "title": "Risoluzione 7-00342 Zoffili: rafforzare l'operazione Strade Sicure fino a 10.000 militari",
        "description": "Risoluzione presentata alla Camera, illustrata in Commissione Difesa il 21 gennaio 2026. Non risulta una votazione elettronica d'Aula al momento del congelamento.",
        "date": "2026-01-21",
        "branch": "camera",
        "source": {
            "kind": "camera_risoluzione",
            "ids": ["7-00342"],
            "attribution": "Camera dei deputati (risoluzione); rassegna stampa 2026-09. Non è una votazione d'Aula.",
        },
        "official": {"fav": None, "contr": None, "ast": None, "esito": "non_votata_in_aula"},
        "flags": {"is_key_vote": False, "is_final": False, "is_confidence": False},
        "stimulusHz": 150,
    },
    {
        "id": "fiducia-dl-sicurezza-2026",
        "pin": True,
        "openpolis": "vs19_648_123",
        "domanda": "Fiducia sul decreto sicurezza?",
        "bucket": "escape",
        "stimulusHz": 150,
    },
    {
        "id": "ponte-stretto-2023",
        "pin": True,
        "openpolis": "19-71-141",
        "domanda": "Si costruisce il ponte sullo Stretto?",
        "bucket": "mechano",
        "stimulusHz": 150,
    },
    {
        "id": "decreto-irpef-2025",
        "pin": True,
        "openpolis": "vs19_495_008",
        "domanda": "Si converte il decreto Irpef?",
        "bucket": "none",
        "stimulusHz": 0,
    },
    {
        "id": "delega-nucleare-2026",
        "pin": True,
        "search": "Delega al Governo in materia di energia nucleare sostenibile",
        "prefer": {"is_final": True},
        "domanda": "Delega al governo sull'energia nucleare?",
        "bucket": "none",
        "stimulusHz": 0,
    },
    {
        "id": "fiducia-dl-infrastrutture-pnrr",
        "pin": True,
        "search": "Fiducia conversione decreto infrastrutture e Pnrr",
        "prefer": {"is_confidence": True},
        "domanda": "Fiducia sul decreto infrastrutture e Pnrr?",
        "bucket": "mechano",
        "stimulusHz": 150,
    },
    {
        "id": "procedurale-legge-elettorale-em",
        "pin": True,
        "openpolis": "19-453-2",
        "domanda": "Si approva l'emendamento 1.202 alla legge elettorale?",
        "bucket": "none",
        "stimulusHz": 0,
    },
]


def log(msg: str) -> None:
    print(msg, flush=True)


def get_json(url: str):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def fetch_voting(slug: str) -> dict:
    return get_json(OP + urllib.parse.quote(slug) + "/")


def search_votings(q: str, page_size: int = 8) -> list:
    url = OP + "?" + urllib.parse.urlencode({"search": q, "page_size": page_size, "ordering": "-date"})
    return get_json(url).get("results") or []


def list_filtered(main_vote_type: str, page_size: int = 20) -> list:
    url = OP + "?" + urllib.parse.urlencode(
        {"main_vote_type": main_vote_type, "page_size": page_size, "ordering": "-date"}
    )
    return get_json(url).get("results") or []


def branch_of(sitting: dict) -> str:
    b = (sitting or {}).get("branch")
    return "senato" if b == "S" else "camera"


def session_from_detail(d: dict, extra: dict) -> dict:
    sitting = d.get("sitting") or {}
    slug = d.get("slug") or d.get("identifier")
    return {
        "id": extra.get("id") or slug,
        "pin": extra.get("pin", False),
        "archivio": extra.get("archivio", False),
        "domanda": extra.get("domanda") or (d.get("description_title") or d.get("title") or "")[:80],
        "bucket": extra.get("bucket", "none"),
        "title": d.get("title") or "",
        "description": d.get("description_title") or d.get("original_title") or "",
        "date": sitting.get("date"),
        "branch": branch_of(sitting),
        "source": {
            "kind": "openpolis",
            "ids": [slug],
            "url": d.get("url"),
            "attribution": "Openpolis Openparlamento, XIX legislatura",
        },
        "official": {
            "fav": d.get("n_ayes"),
            "contr": d.get("n_nos"),
            "ast": d.get("n_abstained"),
            "esito": d.get("outcome"),
            "presenti": d.get("n_present"),
            "votanti": d.get("n_voting"),
        },
        "flags": {
            "is_key_vote": bool(d.get("is_key_vote")),
            "is_final": bool(d.get("is_final")),
            "is_confidence": bool(d.get("is_confidence")),
            "sub_vote_type": d.get("sub_vote_type"),
        },
        "stimulusHz": extra.get("stimulusHz", 150 if extra.get("bucket") not in (None, "none") else 0),
        "neuronIds": extra.get("neuronIds", []),
        "motorIds": extra.get("motorIds", []),
    }


def attach_banc(session: dict, manifest: dict | None) -> dict:
    session["banc"] = {
        "materialization": 888,
        "edgelist": "simple_v3",
        "pack": "circuit",
        "notBanc": bool(manifest and manifest.get("notBanc")),
    }
    if not manifest:
        return session
    b = (manifest.get("buckets") or {}).get(session.get("bucket") or "none") or {}
    if not b.get("supported"):
        # honest: if the pack cannot stimulate this bucket, force none
        if session.get("bucket") not in (None, "none"):
            session["bucketUnsupported"] = session["bucket"]
            session["bucket"] = "none"
            session["stimulusHz"] = 0
    else:
        session["neuronIds"] = b.get("stimRootIds") or []
        session["motorIds"] = b.get("readoutRootIds") or []
    session["thresholds"] = {
        "escape_no_hz": 8,
        "sugar_si_hz": 8,
        "bitter_no_hz": -5,
        "fermentation_si_hz": 8,
        "mechano_si_hz": 8,
        "note": "Arbitrary Δrate table. Shown in the UI. Not physiology.",
    }
    return session


def resolve_pin(pin: dict) -> dict | None:
    if pin.get("archivio") and not pin.get("openpolis"):
        return {
            **{k: pin[k] for k in pin if k not in ("openpolis", "search", "prefer")},
            "neuronIds": [],
            "motorIds": [],
        }
    try:
        if pin.get("openpolis"):
            d = fetch_voting(pin["openpolis"])
            return session_from_detail(d, pin)
        q = pin.get("search")
        if q:
            results = search_votings(q, 10)
            prefer = pin.get("prefer") or {}
            chosen = None
            for r in results:
                ok = True
                for k, v in prefer.items():
                    if r.get(k) != v:
                        ok = False
                        break
                if ok:
                    chosen = r
                    break
            if chosen is None and results:
                chosen = results[0]
            if not chosen:
                log(f"no search hit for {q}")
                return None
            d = fetch_voting(chosen["slug"])
            return session_from_detail(d, pin)
    except Exception as e:
        log(f"pin {pin.get('id')} failed: {e}")
        return None
    return None


def recent_key_votes(since: date) -> list[dict]:
    out = []
    seen = set()
    for kind in ("is_key_vote", "is_final", "is_confidence"):
        try:
            rows = list_filtered(kind, 25)
        except Exception as e:
            log(f"list {kind} failed: {e}")
            continue
        for r in rows:
            slug = r.get("slug")
            dt = (r.get("sitting") or {}).get("date")
            if not slug or slug in seen:
                continue
            if dt and dt < since.isoformat():
                continue
            seen.add(slug)
            try:
                d = fetch_voting(slug)
            except Exception:
                continue
            extra = {
                "id": f"live-{slug}",
                "pin": False,
                "domanda": (d.get("description_title") or d.get("title") or "")[:90],
                "bucket": "none",  # live rows classified in the app
                "stimulusHz": 0,
            }
            out.append(session_from_detail(d, extra))
    return out


def main() -> int:
    manifest = None
    if MANIFEST.exists():
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))

    sessions = []
    seen = set()
    for pin in PINNED:
        s = resolve_pin(pin)
        if not s:
            log(f"skip pin {pin.get('id')}")
            continue
        s = attach_banc(s, manifest)
        sessions.append(s)
        seen.add(s["id"])
        src = s.get("source", {})
        for i in src.get("ids") or []:
            seen.add(i)
        log(f"pinned {s['id']} official={s.get('official')}")

    since = date.today() - timedelta(days=7)
    try:
        live = recent_key_votes(since)
        log(f"live key/final/confidence since {since}: {len(live)}")
        for s in live:
            if s["id"] in seen or (s.get("source") or {}).get("ids", [None])[0] in seen:
                continue
            # do not dump every live row into the picker — keep ≤ ~6 extras
            if sum(1 for x in sessions if not x.get("pin")) >= 6:
                break
            s = attach_banc(s, manifest)
            sessions.append(s)
    except Exception as e:
        log(f"live ingest failed (frozen pins still ship): {e}")

    payload = {
        "legislature": "XIX",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "attribution": "Voti: Openpolis Openparlamento. Risoluzione Strade Sicure: Camera, non votata in Aula.",
        "sessions": sessions,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, indent=2, ensure_ascii=False)
    OUT.write_text(text, encoding="utf-8")
    PUBLIC.write_text(text, encoding="utf-8")
    log(f"wrote {OUT} n={len(sessions)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

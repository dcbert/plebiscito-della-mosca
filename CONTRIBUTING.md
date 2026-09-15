# Contributing

PRs are welcome. This is a joke with a real connectome inside it — keep both halves honest.

## Run it

```bash
npm install && npm run dev
```

Pack and votes are already in `app/public/`. You do **not** need the 400 MB BANC feathers unless you change the circuit cut.

```bash
make packs    # rebuild from data/cache/ (gitignored)
make votes    # refresh Openpolis
npx tsc --noEmit
```

## House rules

- **Do not invent BANC root IDs.** If the cut is silent, the fly abstains.
- **Do not invent vote counts.** Openpolis / Camera / Senato or `archivio`.
- **Pontida is not a vote.** Immigration-as-people is bucket `none` unless the text is *Drosophila suzukii*.
- **No party logos, no fake Gazzetta, no portraits, no walking/flying claims.**
- The decoder (sinistra / centro / destra, Δrate table, rebels) is arbitrary and must stay labelled as such.
- Classifier = hardcoded allow-list. No LLM on SI/NO.

Useful PRs: keyword misses, UI, pack cuts that still use identified neurons, vote ingest, tests.

## Tone

Italian in the UI. English in the lab notes is fine. Satire, not a campaign.

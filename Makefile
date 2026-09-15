.PHONY: help preview packs votes install typecheck

help:
	@echo "make preview    npm install + vite (rebuilds pack/votes if missing)"
	@echo "make packs      cut BANC feathers → app/public/packs/"
	@echo "make votes      refresh Openpolis → sessions.json"
	@echo "make typecheck  tsc --noEmit"

PYTHON := .venv/bin/python
NPM := npm

install:
	python3 -m venv .venv
	$(PYTHON) -m pip install -q pandas pyarrow numpy requests
	$(NPM) install

packs: $(PYTHON)
	$(PYTHON) scripts/build_pack.py

votes: $(PYTHON)
	$(PYTHON) scripts/ingest_votes.py

$(PYTHON):
	python3 -m venv .venv
	.venv/bin/pip install -q pandas pyarrow numpy requests

app/public/packs/circuit.pack.bin.gz:
	$(MAKE) packs

app/public/sessions.json:
	$(MAKE) votes

preview: app/public/packs/circuit.pack.bin.gz app/public/sessions.json
	$(NPM) install
	$(NPM) run dev

typecheck:
	$(NPM) run typecheck

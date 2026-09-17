#!/usr/bin/env bash
# Seed the knowledge bases and (re)ingest their corpora.
#   ./ingest.sh            everything
#   ./ingest.sh aiact      just the Act (and the naive re-chunk of it)
#   ./ingest.sh docs|video
set -euo pipefail
cd "$(dirname "$0")/api"
. .venv/bin/activate
exec python scripts/cli.py "${1:-all}"

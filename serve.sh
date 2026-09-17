#!/usr/bin/env bash
# Serve the mockups on every interface so they can be opened from another machine.
set -euo pipefail
cd "$(dirname "$0")/dist"
exec python3 -m http.server "${1:-8035}" --bind 0.0.0.0

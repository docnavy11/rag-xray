#!/usr/bin/env bash
# Start the demo: Postgres, then the API, which also serves the built frontend.
# One port, 0.0.0.0, so it can be opened from another machine.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8041}"

docker compose up -d
until docker exec ragdemo-db pg_isready -U ragdemo >/dev/null 2>&1; do sleep 1; done

if [ ! -d web/dist ]; then
  echo "building the frontend..."
  (cd web && npm install --silent && npm run build)
fi

pid=$(ss -ltnp 2>/dev/null | grep ":$PORT " | grep -oP 'pid=\K[0-9]+' | head -1 || true)
[ -n "$pid" ] && { echo "stopping the process already on $PORT ($pid)"; kill "$pid"; sleep 2; }

cd api
[ -d .venv ] || { uv venv .venv && .venv/bin/python -m ensurepip >/dev/null 2>&1 || true; }
. .venv/bin/activate
uv pip install -q -r requirements.txt

echo "  http://localhost:$PORT      (and every interface)"
exec uvicorn app.main:app --host 0.0.0.0 --port "$PORT" --log-level warning

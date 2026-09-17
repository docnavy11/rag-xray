"""Settings an operator can change while the thing is running.

The env vars in config.py stay the defaults and stay how a deployment is
configured. A row in `app_setting` overrides one of them, so the model or the
daily budget can be changed from the Settings screen without a redeploy, and
deleting the row puts the env default back.

Only the keys in EDITABLE can be set this way: everything else - the database
URL, the salt - is deployment wiring, not an operating decision, and a settings
screen that could change them would be a footgun with a nice font.
"""
import json
import logging

from .config import settings

log = logging.getLogger("ragdemo.runtime")

# key -> (type, group, label, help). `secret` keys are never returned in full.
EDITABLE: dict[str, dict] = {
    "answer_model": {
        "type": "str", "group": "Models", "label": "Answer model",
        "help": "The model the agent runs on. Answering is the only thing here that "
                "costs money, and this is what it costs money on.",
    },
    "expand_model": {
        "type": "str", "group": "Models", "label": "Query expansion model",
        "help": "A small, well-posed mapping task - the question said again in the "
                "corpus's vocabulary. Runs through the plain Messages API, not the "
                "agent harness.",
    },
    "max_agent_turns": {
        "type": "int", "group": "Models", "label": "Max agent turns", "min": 1, "max": 20,
        "help": "How many times the agent may go round its loop before it must answer "
                "with what it has.",
    },
    "ask_per_hour": {
        "type": "int", "group": "Limits", "label": "Questions per caller, per hour",
        "min": 0, "max": 10000,
        "help": "0 turns answering off entirely. Retrieval is never rate-limited.",
    },
    "ask_per_day": {
        "type": "int", "group": "Limits", "label": "Questions per caller, per day",
        "min": 0, "max": 100000,
    },
    "ask_daily_budget_usd": {
        "type": "float", "group": "Limits", "label": "Daily spend cap (USD)",
        "min": 0, "max": 1000,
        "help": "Across every caller, not per caller. A rate limit keyed on the caller "
                "cannot see a thousand callers; this can.",
    },
    "api_key": {
        "type": "str", "group": "Access", "label": "API key", "secret": True,
        "help": "Required as X-API-Key on POST /v1/ask and on the MCP server. Empty "
                "means no key is required - fine on localhost, not fine once this is "
                "reachable from anywhere else.",
    },
    "embed_enabled": {
        "type": "bool", "group": "Retrieval", "label": "Embeddings",
        "help": "Turns on the vector run for corpora configured hybrid or vector. The "
                "model has to be installed on the server for this to do anything; when "
                "it is not, the run simply does not appear in the trace.",
    },
}

_overrides: dict = {}


async def load() -> None:
    """Read every override into memory. Called at startup and after each write."""
    from .db import pool
    try:
        p = await pool()
        async with p.acquire() as con:
            rows = await con.fetch("SELECT key, value FROM app_setting")
    except Exception as exc:                      # a cold database is not fatal
        log.warning("could not load settings overrides: %s", exc)
        return
    _overrides.clear()
    for r in rows:
        v = r["value"]
        _overrides[r["key"]] = json.loads(v) if isinstance(v, str) else v


def get(key: str):
    """The live value: the override if there is one, else the env default."""
    if key in _overrides:
        return _overrides[key]
    return getattr(settings, key)


def coerce(key: str, value):
    spec = EDITABLE[key]
    t = spec["type"]
    if t == "int":
        value = int(value)
    elif t == "float":
        value = float(value)
    elif t == "bool":
        value = bool(value)
    else:
        value = str(value)
    if "min" in spec and value < spec["min"]:
        value = spec["min"]
    if "max" in spec and value > spec["max"]:
        value = spec["max"]
    return value


async def put(key: str, value) -> None:
    if key not in EDITABLE:
        raise KeyError(key)
    value = coerce(key, value)
    from .db import pool
    p = await pool()
    async with p.acquire() as con:
        await con.execute(
            """INSERT INTO app_setting (key, value, updated_at)
               VALUES ($1, $2::jsonb, now())
               ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()""",
            key, json.dumps(value))
    _overrides[key] = value


async def clear(key: str) -> None:
    from .db import pool
    p = await pool()
    async with p.acquire() as con:
        await con.execute("DELETE FROM app_setting WHERE key=$1", key)
    _overrides.pop(key, None)


def describe() -> list[dict]:
    """Every editable setting, its live value, and where that value came from."""
    out = []
    for key, spec in EDITABLE.items():
        value = get(key)
        overridden = key in _overrides
        if spec.get("secret"):
            shown = ("set · " + str(value)[:3] + "…") if value else ""
        else:
            shown = value
        out.append({
            "key": key, "value": shown, "set": bool(value) if spec.get("secret") else None,
            "secret": bool(spec.get("secret")), "type": spec["type"],
            "group": spec["group"], "label": spec["label"], "help": spec.get("help", ""),
            "min": spec.get("min"), "max": spec.get("max"),
            "source": "changed here" if overridden else "environment default",
            "default": None if spec.get("secret") else getattr(settings, key),
        })
    return out

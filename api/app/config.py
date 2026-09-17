from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # --- store -------------------------------------------------------------
    database_url: str = "postgresql://ragdemo:ragdemo@localhost:5444/ragdemo"

    # --- the two corpora built from somebody's own machine ------------------
    # These were paths hardcoded to one laptop. They are settings now, and both
    # ingests skip cleanly when they point at nothing, so a fresh clone builds
    # the two AI Act corpora and simply reports the other two as skipped.
    #
    #   VIDEO_DB=/path/to/scraper/data/app.db
    #   DOC_ROOTS=/path/to/handbook,/path/to/runbooks
    video_db: str = ""
    video_topics: str = "AI Automation & Agents,Voice Agents"
    video_cap: int = 300
    doc_roots: str = ""

    # --- the AI Act corpus (KB 1 and 2 are built from it) ------------------
    # Measured 2026-08-26 in aiact-kb: these are the CELEX ids that resolve.
    consolidated_celex: str = "02024R1689-20260727"
    base_celex: str = "32024R1689"
    amending_celex: str = "32026R1744"
    languages: str = "en,nl,fr,de"

    # --- models ------------------------------------------------------------
    # The chat runs on the Claude Agent SDK, which authenticates the same way
    # the Claude Code CLI does: an ANTHROPIC_API_KEY, or the CLI's own logged-in
    # credentials when no key is set. Retrieval, lookup and every counterfactual
    # need no credential at all and work without one.
    answer_model: str = "claude-opus-5"
    # Query expansion is a small, well-posed mapping task and runs on the cheap
    # model through the plain Messages API, not through the agent harness.
    expand_model: str = "claude-haiku-4-5"
    anthropic_api_key: str = ""
    max_agent_turns: int = 6

    # --- embeddings --------------------------------------------------------
    # bge-m3 is 1024-dim, which is what the chunk.embedding column already is,
    # and multilingual across the four languages the Act ships in. Loaded lazily:
    # a KB whose retrieval_config never asks for vectors never pays for it.
    embed_model: str = "BAAI/bge-m3"
    embed_enabled: bool = False

    # --- public limits -----------------------------------------------------
    # /v1/ask is billable and reachable. Counterfactuals are not limited: they
    # never reach a model, which is the whole reason they are free.
    ask_per_hour: int = 30
    ask_per_day: int = 120
    ask_daily_budget_usd: float = 5.0
    ask_ip_salt: str = "ragdemo"

    # --- automation / MCP integrations --------------------------------------
    # POST /v1/ask and the external MCP server (app/mcp/server.py) are meant
    # to be called by things other than the browser demo - n8n, Zapier, Make,
    # Claude Desktop, Cursor. Empty means no key required, which is the local/
    # dev default; set this before exposing either surface off localhost.
    api_key: str = ""
    mcp_http_host: str = "127.0.0.1"
    mcp_http_port: int = 8143

    # --- who may administer this --------------------------------------------
    # The reading surface is open; the administering surface is not. From
    # localhost you are trusted (turn that off for a shared machine); from
    # anywhere else you need API_KEY, and with no key set there is no remote
    # administration at all. See app/security.py.
    trust_localhost: bool = True

    # Sources that run a command (stdio MCP) or read the host filesystem are off
    # by default: with them on, admin access is command execution as this user.
    # Turn this on for a single-user local install, never on a shared host.
    allow_local_exec: bool = False

    # Outbound fetches to private and loopback addresses are refused by default,
    # so a source cannot be used to reach an internal network or a cloud
    # metadata endpoint. Turn this on to point at an MCP server on localhost.
    allow_private_network: bool = False

    log_level: str = "info"

    @property
    def doc_root_paths(self) -> list[str]:
        return [x.strip() for x in self.doc_roots.split(",") if x.strip()]

    @property
    def video_topic_list(self) -> list[str]:
        return [x.strip() for x in self.video_topics.split(",") if x.strip()]

    @property
    def langs(self) -> list[str]:
        return [x.strip() for x in self.languages.split(",") if x.strip()]

    class Config:
        env_file = ".env"
        env_prefix = ""


settings = Settings()

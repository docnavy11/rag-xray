"""Who is allowed to administer this.

The reading surface - ask a question, search a corpus, open a trace - is meant to
be reachable. The administering surface is not: it can delete a corpus, read the
API key, and (through sources) run a command on the host. Those are different
things and this is where the line is drawn.

The rule, in one sentence: from localhost you are trusted, from anywhere else you
need the API key, and if no key is set then there is no way in from anywhere
else. Nothing here is a login system - it is the smallest gate that makes a
careless deployment not be a free shell.
"""
import ipaddress
import logging

from fastapi import HTTPException, Request

from . import runtime
from .config import settings

log = logging.getLogger("ragdemo.security")

LOCAL = {"127.0.0.1", "::1", "localhost", "testclient"}


def is_local(request: Request) -> bool:
    """A direct connection from this machine.

    A forwarded header means a proxy is in front, and the peer address is then
    the proxy rather than the caller - so anything carrying one is treated as
    remote no matter what it claims. Trusting x-forwarded-for here would let a
    caller name themselves 127.0.0.1 and walk in.
    """
    if request.headers.get("x-forwarded-for") or request.headers.get("x-real-ip"):
        return False
    host = request.client.host if request.client else ""
    return host in LOCAL


def require_admin(request: Request) -> None:
    """Gate for everything that changes state or reveals configuration."""
    if is_local(request) and settings.trust_localhost:
        return
    key = runtime.get("api_key")
    if not key:
        raise HTTPException(
            403,
            "Administering this remotely needs an API key. Set API_KEY on the server "
            "(or administer it from localhost). Reading - questions, search, traces - "
            "is unaffected.")
    if request.headers.get("x-api-key") != key:
        raise HTTPException(401, "missing or invalid X-API-Key")


def require_local_exec(what: str) -> None:
    """Gate for connectors that run a command or read the filesystem.

    A stdio MCP source is a command line stored in a database and executed by
    this process. That is the single sharpest edge in this codebase: with it
    open, anyone who can reach the admin API can run anything the server user
    can. A filesystem source is the same shape one step down - it reads any path
    the process can read, which includes the .env next to it.

    So both are off unless somebody deliberately turns them on, and turning them
    on is a decision made in the environment rather than in the UI.
    """
    if not settings.allow_local_exec:
        raise HTTPException(
            403,
            f"{what} is disabled. It lets this server run commands and read files on "
            "the host, so it is off unless ALLOW_LOCAL_EXEC=true is set in the "
            "environment. MCP servers reachable over http or sse still work.")


def check_target(url: str) -> None:
    """Refuse private and loopback targets for outbound fetches.

    Without this, a source is a request forger: anyone who can add one can make
    the server fetch http://169.254.169.254/ and hand back the cloud credentials
    it finds there, or sweep an internal network from inside the perimeter.
    """
    if settings.allow_private_network:
        return
    from urllib.parse import urlparse
    host = (urlparse(url).hostname or "").strip("[]")
    if not host:
        raise HTTPException(422, f"no host in {url[:80]}")
    if host in LOCAL:
        raise HTTPException(403, _blocked(host))
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return          # a name: resolution happens in the client, not here
    if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
        raise HTTPException(403, _blocked(host))


def _blocked(host: str) -> str:
    return (f"{host} is a private or loopback address. Fetching those from here would "
            "turn this server into a way to reach things it can see and you cannot, "
            "so it is refused unless ALLOW_PRIVATE_NETWORK=true is set.")

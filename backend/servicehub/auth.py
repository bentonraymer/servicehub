"""Single-password auth with a signed cookie, plus a bearer token for API/CLI use."""

import hashlib
import hmac
import secrets
import time

from fastapi import Request

from . import config, db

COOKIE = "servicehub_session"
SESSION_SECONDS = 60 * 60 * 24 * 30

_secret: bytes | None = None


def secret() -> bytes:
    global _secret
    if _secret is None:
        if config.SECRET_PATH.exists():
            _secret = config.SECRET_PATH.read_bytes()
        else:
            _secret = secrets.token_bytes(32)
            config.SECRET_PATH.write_bytes(_secret)
            config.SECRET_PATH.chmod(0o600)
    return _secret


def enabled() -> bool:
    return bool(config.PASSWORD)


def _pw_fingerprint() -> str:
    # Changing the password invalidates every existing session.
    return hashlib.sha256(config.PASSWORD.encode()).hexdigest()[:16]


def _sign(payload: str) -> str:
    return hmac.new(secret(), payload.encode(), hashlib.sha256).hexdigest()


def make_session() -> str:
    exp = int(time.time()) + SESSION_SECONDS
    payload = f"{exp}:{_pw_fingerprint()}"
    return f"{exp}.{_sign(payload)}"


def check_session(value: str | None) -> bool:
    if not value or "." not in value:
        return False
    exp_s, sig = value.split(".", 1)
    try:
        exp = int(exp_s)
    except ValueError:
        return False
    if exp < time.time():
        return False
    return hmac.compare_digest(sig, _sign(f"{exp}:{_pw_fingerprint()}"))


def check_password(pw: str) -> bool:
    return enabled() and hmac.compare_digest(pw.encode(), config.PASSWORD.encode())


# ---- API token -------------------------------------------------------------

def _hash_token(tok: str) -> str:
    return hashlib.sha256(tok.encode()).hexdigest()


def new_api_token() -> str:
    tok = "sh_" + secrets.token_urlsafe(32)
    db.set_setting("api_token_hash", _hash_token(tok))
    db.set_setting("api_token_hint", tok[:7] + "…" + tok[-4:])
    db.set_setting("api_token_created", db.now_iso())
    return tok


def revoke_api_token() -> None:
    for k in ("api_token_hash", "api_token_hint", "api_token_created"):
        db.execute("DELETE FROM settings WHERE key=?", (k,))


def check_api_token(tok: str) -> bool:
    stored = db.get_setting("api_token_hash")
    return bool(stored) and hmac.compare_digest(stored, _hash_token(tok))


def is_authed(request_or_ws) -> bool:
    if not enabled():
        return True
    if check_session(request_or_ws.cookies.get(COOKIE)):
        return True
    authz = request_or_ws.headers.get("authorization", "")
    if authz.lower().startswith("bearer "):
        return check_api_token(authz[7:].strip())
    return False


def is_token_request(request: Request) -> bool:
    return request.headers.get("authorization", "").lower().startswith("bearer ")

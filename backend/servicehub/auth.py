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


# ---- per-service passwords ---------------------------------------------------------
#
# The admin password guards admin mode and the API. Each service can also have
# its own optional password, which guards its page (/s/<slug>/) and its controls
# on the launcher. Unlocking one sets a cookie that only works for that service.

SVC_COOKIE_PREFIX = "sh_svc_"
_PBKDF2_ROUNDS = 200_000


def hash_password(pw: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, _PBKDF2_ROUNDS)
    return f"pbkdf2${salt.hex()}${digest.hex()}"


def verify_password(pw: str, stored: str) -> bool:
    try:
        _, salt, digest = stored.split("$", 2)
        got = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), _PBKDF2_ROUNDS)
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(got.hex(), digest)


def service_hash(slug: str) -> str:
    row = db.one("SELECT access_hash FROM services WHERE slug=?", (slug,))
    return (row or {}).get("access_hash") or ""


def service_cookie(slug: str) -> str:
    return SVC_COOKIE_PREFIX + slug


def _svc_payload(slug: str, exp: int, stored: str) -> str:
    # Tied to the stored hash, so changing or removing the password logs everyone out.
    return f"svc:{slug}:{exp}:{hashlib.sha256(stored.encode()).hexdigest()[:16]}"


def make_service_session(slug: str) -> str:
    exp = int(time.time()) + SESSION_SECONDS
    return f"{exp}.{_sign(_svc_payload(slug, exp, service_hash(slug)))}"


def has_service_access(request_or_ws, slug: str) -> bool:
    stored = service_hash(slug)
    if not stored or is_authed(request_or_ws):
        return True
    value = request_or_ws.cookies.get(service_cookie(slug)) or ""
    if "." not in value:
        return False
    exp_s, sig = value.split(".", 1)
    try:
        exp = int(exp_s)
    except ValueError:
        return False
    return exp >= time.time() and hmac.compare_digest(sig, _sign(_svc_payload(slug, exp, stored)))


def is_servicehub_cookie(name: str) -> bool:
    return name == COOKIE or name.startswith(SVC_COOKIE_PREFIX)

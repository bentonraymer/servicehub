"""Pushover notifications."""

import logging
import os

import httpx

from . import db

log = logging.getLogger("servicehub.notify")

PUSHOVER_URL = "https://api.pushover.net/1/messages.json"


def pushover_creds() -> tuple[str, str]:
    user = db.get_setting("pushover_user") or os.environ.get("PUSHOVER_USER_KEY", "")
    token = db.get_setting("pushover_token") or os.environ.get("PUSHOVER_APP_TOKEN", "")
    return user, token


def configured() -> bool:
    user, token = pushover_creds()
    return bool(user and token)


async def send(title: str, message: str, priority: int = 0, url: str | None = None) -> tuple[bool, str]:
    user, token = pushover_creds()
    if not (user and token):
        return False, "Pushover isn't set up. Add your user key and app token in Settings."
    data = {"token": token, "user": user, "title": title[:250], "message": message[:1024] or "-", "priority": priority}
    base = db.get_setting("public_url").rstrip("/")
    if url and base:
        data["url"] = base + url
        data["url_title"] = "Open in ServiceHub"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(PUSHOVER_URL, data=data)
        if r.status_code == 200:
            return True, "Sent"
        try:
            errs = ", ".join(r.json().get("errors", [])) or r.text
        except Exception:
            errs = r.text
        return False, f"Pushover said: {errs}"
    except Exception as e:  # network errors
        log.warning("pushover failed: %s", e)
        return False, f"Couldn't reach Pushover: {e}"

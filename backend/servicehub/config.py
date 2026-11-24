import os
from pathlib import Path
from zoneinfo import ZoneInfo

VERSION = os.environ.get("SERVICEHUB_VERSION", "dev")

DATA_DIR = Path(os.environ.get("SERVICEHUB_DATA", "/data")).resolve()
SERVICES_DIR = DATA_DIR / "services"
VERSIONS_DIR = DATA_DIR / "versions"
VENVS_DIR = DATA_DIR / "venvs"
APPDATA_DIR = DATA_DIR / "appdata"
LOGS_DIR = DATA_DIR / "logs"
CACHE_DIR = DATA_DIR / "cache"
DB_PATH = DATA_DIR / "servicehub.db"
SECRET_PATH = DATA_DIR / "secret.key"

PASSWORD = os.environ.get("SERVICEHUB_PASSWORD", "")
PORT = int(os.environ.get("SERVICEHUB_PORT", "8080"))

# Web apps listen on 127.0.0.1:(APP_PORT_BASE + service id)
APP_PORT_BASE = int(os.environ.get("SERVICEHUB_APP_PORT_BASE", "20000"))

MAX_VERSIONS = int(os.environ.get("SERVICEHUB_MAX_VERSIONS", "30"))
MAX_RUNS_PER_SERVICE = int(os.environ.get("SERVICEHUB_MAX_RUNS", "200"))

try:
    TZ = ZoneInfo(os.environ.get("TZ", "UTC"))
except Exception:  # unknown zone name
    TZ = ZoneInfo("UTC")
TZ_NAME = str(TZ)

STATIC_DIR = Path(__file__).parent / "static"


def ensure_dirs() -> None:
    for d in (DATA_DIR, SERVICES_DIR, VERSIONS_DIR, VENVS_DIR, APPDATA_DIR, LOGS_DIR, CACHE_DIR):
        d.mkdir(parents=True, exist_ok=True)

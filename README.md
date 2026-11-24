# ServiceHub

A small self-hosted home for the little things you write: single-file web pages, Python scripts on a schedule, long-running Python workers and small Python web apps. You get a launcher to open them and an admin mode to edit, deploy, schedule and watch them.

- **Static pages**: HTML/JS/CSS served at `/s/<name>/`.
- **Scripts**: Python that runs on a cron schedule or when you press Run, with an optional input form, live logs and run history.
- **Workers**: Python that runs all the time. It restarts if it crashes and stops retrying after 5 crashes in 2 minutes.
- **Web apps**: Flask, FastAPI or anything else that listens on `$PORT`, proxied at `/s/<name>/` (WebSockets work too).

Each Python service gets its own virtualenv, built from `requirements.txt` with [uv](https://github.com/astral-sh/uv) whenever that file changes.

## Run it (Dockge / Docker Compose)

```yaml
services:
  servicehub:
    image: ghcr.io/bentonraymer/servicehub:latest
    container_name: servicehub
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      SERVICEHUB_PASSWORD: change-me
      TZ: America/Chicago
    volumes:
      - ./data:/data
```

Open `http://<host>:8080` and sign in with the password.

| Variable | Default | What it does |
|---|---|---|
| `SERVICEHUB_PASSWORD` | *(none)* | The single password for everything. If it's unset, ServiceHub is open to anyone who can reach it. |
| `TZ` | `America/Chicago` | Time zone for schedules. |
| `PUSHOVER_USER_KEY`, `PUSHOVER_APP_TOKEN` | | Optional; you can also set these in Settings. |
| `SERVICEHUB_PORT` | `8080` | Port inside the container. |

Everything lives in `/data`: code, versions, venvs, logs, and each service's persistent `DATA_DIR`. Back up that folder and you've backed up ServiceHub.

## Writing services

| You get | Where |
|---|---|
| `DATA_DIR` | A folder that survives deploys and rollbacks. Write state here. |
| `PORT` | (Web apps) Listen on `127.0.0.1:$PORT`. |
| `SERVICEHUB_BASE_PATH` / `X-Forwarded-Prefix` | (Web apps) `/s/<name>`. Use relative links, or `ProxyFix(x_prefix=1)` in Flask / `root_path` in FastAPI. |
| `INPUT_<NAME>`, `SERVICEHUB_INPUTS` | (Scripts) Values from the run form, as separate env vars and as one JSON object. |
| Your own env vars | Settings → Environment variables. |

A script run fails when it exits non-zero or hits its timeout. With Pushover set up, you get one alert on the first failure in a row and another when it recovers.

**Static pages:** use relative paths (`./app.js`, not `/app.js`) so files load under `/s/<name>/`.

## Deploying from the command line

Create an API token in **Settings → API access**, then:

```bash
# A folder as a scheduled script (creates it the first time)
cd my-script && zip -qr /tmp/my-script.zip . && \
curl -fsS -H "Authorization: Bearer $SERVICEHUB_TOKEN" \
  -F type=script -F entrypoint=main.py -F file=@/tmp/my-script.zip \
  http://servicehub:8080/api/deploy/my-script

# A single HTML file
curl -fsS -H "Authorization: Bearer $SERVICEHUB_TOKEN" \
  -F type=static -F file=@index.html http://servicehub:8080/api/deploy/tip-calc
```

Each deploy replaces the code, saves a version (the last 30 are kept), and restarts workers and web apps. Full API docs are at `/api/docs`.

## Development

```bash
# backend (http://127.0.0.1:8080)
cd backend && uv venv .venv && uv pip install -r requirements.txt
SERVICEHUB_DATA=../data SERVICEHUB_PASSWORD=dev .venv/bin/python -m servicehub.main

# frontend with hot reload (http://127.0.0.1:5173, proxies /api and /s to the backend)
cd web && npm install && npm run dev
```

`npm run build` writes the UI into `backend/servicehub/static`, which the backend serves. Pushing to `main` builds a multi-arch image (amd64 + arm64) and publishes it to `ghcr.io/bentonraymer/servicehub`. Tags like `v1.2.0` publish matching image tags.

**Security note:** services run as subprocesses inside the ServiceHub container, as the same user. That's fine for your own code, but don't run code you don't trust.

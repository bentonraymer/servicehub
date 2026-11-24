"""Starter files for each service type."""

STATIC_INDEX = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{name}</title>
  <style>
    :root {{ color-scheme: dark; }}
    body {{ margin: 0; min-height: 100vh; display: grid; place-items: center;
      font: 15px/1.5 Inter, system-ui, sans-serif; background: #0a0c11; color: #dfe4ee; }}
    .card {{ padding: 28px 32px; border: 1px solid #1f2533; border-radius: 12px; background: #10131a; }}
    button {{ background: #5b8cff; color: white; border: 0; border-radius: 6px; padding: 8px 14px; font: inherit; cursor: pointer; }}
  </style>
</head>
<body>
  <div class="card">
    <h1 style="margin:0 0 8px;font-size:18px">{name}</h1>
    <p style="margin:0 0 16px;color:#8b94a8">Edit index.html in ServiceHub to make this page yours.</p>
    <button id="btn">Clicked 0 times</button>
  </div>
  <script>
    // Use relative paths (./app.js, not /app.js) so files load under /s/{slug}/.
    let n = 0;
    document.getElementById("btn").onclick = (e) => (e.target.textContent = `Clicked ${{++n}} times`);
  </script>
</body>
</html>
"""

SCRIPT_MAIN = '''"""{name}

Runs on a schedule or when you press Run.
- Inputs from the run form arrive as environment variables: INPUT_<NAME>
  (all of them, as JSON, are in SERVICEHUB_INPUTS).
- Write anything you want to keep to DATA_DIR; it survives redeploys.
- A non-zero exit code marks the run as failed (and can notify you).
"""

import json
import os
from datetime import datetime
from pathlib import Path

inputs = json.loads(os.environ.get("SERVICEHUB_INPUTS", "{{}}"))
data_dir = Path(os.environ["DATA_DIR"])

name = inputs.get("name") or "world"
print(f"Hello, {{name}}! It's {{datetime.now():%Y-%m-%d %H:%M}}.")

counter = data_dir / "runs.txt"
count = int(counter.read_text()) + 1 if counter.exists() else 1
counter.write_text(str(count))
print(f"This script has run {{count}} time(s).")
'''

WORKER_MAIN = '''"""{name}

A long-running worker. ServiceHub restarts it if it exits or crashes.
Stop requests send SIGTERM, so clean up and exit when you get one.
"""

import os
import signal
import time
from datetime import datetime

running = True


def stop(*_):
    global running
    running = False


signal.signal(signal.SIGTERM, stop)

interval = int(os.environ.get("INTERVAL_SECONDS", "30"))
print(f"Worker started; ticking every {{interval}}s")

while running:
    print(f"tick {{datetime.now():%H:%M:%S}}")
    for _ in range(interval):
        if not running:
            break
        time.sleep(1)

print("Worker stopping")
'''

WEBAPP_MAIN = '''"""{name}

A small Flask app. ServiceHub runs it on 127.0.0.1:$PORT and serves it at /s/{slug}/.
Use relative links (or url_for, which ProxyFix makes prefix-aware) so pages work under that path.
"""

import os

from flask import Flask, render_template_string, request
from werkzeug.middleware.proxy_fix import ProxyFix

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)

PAGE = """<!doctype html>
<title>{name}</title>
<body style="font:15px system-ui;background:#0a0c11;color:#dfe4ee;padding:40px">
  <h1 style="font-size:18px">{name}</h1>
  <form method="get"><input name="q" placeholder="Say something" value="{{{{ q }}}}"> <button>Send</button></form>
  {{% if q %}}<p>You said: <b>{{{{ q }}}}</b></p>{{% endif %}}
  <p><a style="color:#7aa2ff" href="{{{{ url_for('health') }}}}">Health check</a></p>
</body>"""


@app.route("/")
def index():
    return render_template_string(PAGE, q=request.args.get("q", ""))


@app.route("/health")
def health():
    return {{"ok": True}}


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ["PORT"]), debug=False)
'''

DEFAULT_ENTRY = {"static": "index.html", "script": "main.py", "worker": "main.py", "webapp": "app.py"}


def starter_files(kind: str, name: str, slug: str) -> dict[str, str]:
    fmt = {"name": name, "slug": slug}
    if kind == "static":
        return {"index.html": STATIC_INDEX.format(**fmt)}
    if kind == "script":
        return {"main.py": SCRIPT_MAIN.format(**fmt), "requirements.txt": ""}
    if kind == "worker":
        return {"main.py": WORKER_MAIN.format(**fmt), "requirements.txt": ""}
    if kind == "webapp":
        return {"app.py": WEBAPP_MAIN.format(**fmt), "requirements.txt": "flask>=3\n"}
    raise ValueError(kind)


def starter_inputs(kind: str) -> list[dict]:
    if kind == "script":
        return [{"name": "name", "label": "Name", "type": "text", "default": "", "required": False,
                 "help": "Who to greet", "options": []}]
    return []

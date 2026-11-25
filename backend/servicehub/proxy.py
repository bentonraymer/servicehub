"""Serves /s/<slug>/...: static files directly, web apps through an HTTP + WebSocket proxy."""

import asyncio
import mimetypes
from urllib.parse import quote

import httpx
import websockets
from fastapi import Request, WebSocket
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response, StreamingResponse
from starlette.background import BackgroundTask

from . import auth, files, runner

HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailers",
    "transfer-encoding", "upgrade", "host", "content-length",
}

_client: httpx.AsyncClient | None = None


def client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=httpx.Timeout(300, connect=5), follow_redirects=False)
    return _client


def _page(title: str, body: str, status: int) -> HTMLResponse:
    html = f"""<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>{title}</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0c11;color:#dfe4ee;font:14px/1.6 Inter,system-ui,sans-serif">
<div style="max-width:440px;padding:28px 32px;border:1px solid #1f2533;border-radius:12px;background:#10131a">
<h1 style="margin:0 0 6px;font-size:16px">{title}</h1><p style="margin:0 0 16px;color:#8b94a8">{body}</p>
<a href="/" style="color:#7aa2ff">Back to ServiceHub</a></div></body>"""
    return HTMLResponse(html, status_code=status)


async def serve(request: Request, slug: str, path: str):
    service = runner.get_service(slug)
    if not service:
        return _page("Not found", f"There's no service called <code>{slug}</code>.", 404)
    if not service["enabled"]:
        return _page("Service disabled", f"{service['name']} is turned off. Enable it in admin mode.", 503)
    if service["type"] in ("static", "webapp") and not auth.has_service_access(request, slug):
        if request.method in ("GET", "HEAD"):
            target = f"/s/{slug}/{path}" + (f"?{request.url.query}" if request.url.query else "")
            return RedirectResponse(f"/unlock/{slug}?next={quote(target, safe='')}", status_code=302)
        return _page("Password needed", f"Open <a href=\"/s/{slug}/\">{service['name']}</a> and enter its password first.", 401)
    if service["type"] == "static":
        return _static(service, path)
    if service["type"] == "webapp":
        return await _proxy(request, service, path)
    return RedirectResponse(f"/?open={slug}", status_code=302)


def _static(service: dict, path: str):
    slug = service["slug"]
    try:
        target = files.safe_path(slug, path) if path else files.code_dir(slug)
    except files.FileError:
        return _page("Not found", "That path isn't valid.", 404)
    if target.is_dir():
        index = service["entrypoint"] if not path and service["entrypoint"] else "index.html"
        target = target / index
    if not target.is_file():
        return _page("Not found", f"<code>{path or service['entrypoint']}</code> doesn't exist in {service['name']}.", 404)
    mt, _ = mimetypes.guess_type(str(target))
    return FileResponse(target, media_type=mt or "application/octet-stream", headers={"Cache-Control": "no-cache"})


def _app_cookies(header: str) -> str:
    """The Cookie header minus ServiceHub's own sign-in cookies, which apps never need to see."""
    parts = [p.strip() for p in header.split(";") if p.strip()]
    return "; ".join(p for p in parts if not auth.is_servicehub_cookie(p.split("=", 1)[0].strip()))


async def _proxy(request: Request, service: dict, path: str):
    slug = service["slug"]
    sup = runner.supervisor(slug)
    if sup.state not in ("running",):
        detail = {
            "stopped": "It's stopped. Start it from admin mode.",
            "failed": sup.detail or "It crashed repeatedly and was stopped.",
            "installing": "It's installing packages; this page will work in a moment.",
            "starting": "It's starting up; refresh in a moment.",
            "backoff": "It crashed and is about to restart.",
        }.get(sup.state, "It isn't running.")
        return _page(f"{service['name']} isn't ready", detail, 503)
    port = runner.app_port(service)
    prefix = f"/s/{slug}"
    url = f"http://127.0.0.1:{port}/{path}"
    if request.url.query:
        url += "?" + request.url.query
    headers = [(k, v) for k, v in request.headers.items() if k.lower() not in HOP and k.lower() != "cookie"]
    cookie = _app_cookies(request.headers.get("cookie", ""))
    if cookie:
        headers.append(("cookie", cookie))
    host = request.headers.get("host", "")
    client_ip = request.client.host if request.client else ""
    headers += [
        ("x-forwarded-prefix", prefix),
        ("x-script-name", prefix),
        ("x-forwarded-host", host),
        ("x-forwarded-proto", request.url.scheme),
        ("x-forwarded-for", client_ip),
    ]
    req = client().build_request(request.method, url, headers=headers, content=await request.body())
    try:
        resp = await client().send(req, stream=True)
    except httpx.ConnectError:
        return _page(f"{service['name']} isn't answering", f"Nothing is listening on port {port}. Make sure the app binds to <code>$PORT</code> on 127.0.0.1.", 502)
    out_headers = []
    for k, v in resp.headers.multi_items():
        lk = k.lower()
        if lk in HOP:
            continue
        if lk == "location":
            for origin in (f"http://127.0.0.1:{port}", f"http://localhost:{port}"):
                if v.startswith(origin):
                    v = v[len(origin):] or "/"
            if v.startswith("/") and not v.startswith("//") and not (v == prefix or v.startswith(prefix + "/")):
                v = prefix + v
        out_headers.append((k, v))
    response = StreamingResponse(resp.aiter_raw(), status_code=resp.status_code, background=BackgroundTask(resp.aclose))
    response.raw_headers = [(k.lower().encode("latin-1"), v.encode("latin-1")) for k, v in out_headers]
    return response


async def websocket(ws: WebSocket, slug: str, path: str):
    service = runner.get_service(slug)
    if not service or service["type"] != "webapp" or runner.supervisor(slug).state != "running":
        await ws.close(code=1013)
        return
    port = runner.app_port(service)
    url = f"ws://127.0.0.1:{port}/{path}"
    if ws.url.query:
        url += "?" + ws.url.query
    subprotocols = [p.strip() for p in ws.headers.get("sec-websocket-protocol", "").split(",") if p.strip()]
    fwd = {"X-Forwarded-Prefix": f"/s/{slug}"}
    cookie = _app_cookies(ws.headers.get("cookie", ""))
    if cookie:
        fwd["Cookie"] = cookie
    try:
        upstream = await websockets.connect(url, additional_headers=fwd, subprotocols=subprotocols or None, max_size=None)
    except Exception:
        await ws.close(code=1011)
        return
    await ws.accept(subprotocol=upstream.subprotocol)

    async def to_upstream():
        try:
            while True:
                msg = await ws.receive()
                if msg["type"] == "websocket.disconnect":
                    break
                if msg.get("text") is not None:
                    await upstream.send(msg["text"])
                elif msg.get("bytes") is not None:
                    await upstream.send(msg["bytes"])
        finally:
            await upstream.close()

    async def to_client():
        try:
            async for m in upstream:
                if isinstance(m, bytes):
                    await ws.send_bytes(m)
                else:
                    await ws.send_text(m)
        finally:
            try:
                await ws.close()
            except Exception:
                pass

    await asyncio.gather(to_upstream(), to_client(), return_exceptions=True)


def mime_fix() -> None:
    mimetypes.add_type("text/javascript", ".js")
    mimetypes.add_type("text/javascript", ".mjs")
    mimetypes.add_type("text/css", ".css")
    mimetypes.add_type("image/svg+xml", ".svg")
    mimetypes.add_type("application/wasm", ".wasm")

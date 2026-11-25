import logging
import re
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, WebSocket
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from . import api, auth, config, db, proxy, runner

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("servicehub")


@asynccontextmanager
async def lifespan(app: FastAPI):
    config.ensure_dirs()
    db.connect()
    auth.secret()
    proxy.mime_fix()
    if not auth.enabled():
        log.warning("SERVICEHUB_PASSWORD is not set: ServiceHub is open to anyone who can reach it.")
    await runner.startup()
    log.info("ServiceHub %s ready on :%s (data in %s, TZ %s)", config.VERSION, config.PORT, config.DATA_DIR, config.TZ_NAME)
    yield
    await runner.shutdown()


app = FastAPI(title="ServiceHub", lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")

# Everything under /api needs the admin password, except these. The service-level
# ones check that service's own password (if it has one) in the endpoint itself.
PUBLIC_API = [re.compile(p) for p in (
    r"/api/auth/(status|login|logout)",
    r"/api/launcher",
    r"/api/events",
    r"/api/services/[a-z0-9-]+/(run|start|stop|restart|unlock|lock|logs/stream)",
    r"/api/runs(/\d+(/stream|/cancel)?)?",
)]


@app.middleware("http")
async def guard(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/") and not any(p.fullmatch(path) for p in PUBLIC_API) and not auth.is_authed(request):
        return JSONResponse({"detail": "Sign in first."}, status_code=401)
    return await call_next(request)


app.include_router(api.router)
app.include_router(api.hooks)


@app.get("/healthz", include_in_schema=False)
def healthz():
    return {"ok": True}


@app.api_route("/s/{slug}", methods=["GET", "HEAD"], include_in_schema=False)
async def service_root(slug: str, request: Request):
    q = ("?" + request.url.query) if request.url.query else ""
    return RedirectResponse(f"/s/{slug}/{q}", status_code=308)


@app.api_route("/s/{slug}/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
               include_in_schema=False)
async def service_path(slug: str, path: str, request: Request):
    return await proxy.serve(request, slug, path)


@app.websocket("/s/{slug}/{path:path}")
async def service_ws(ws: WebSocket, slug: str, path: str):
    if not auth.has_service_access(ws, slug):
        await ws.close(code=4401)
        return
    await proxy.websocket(ws, slug, path)


# ---- single-page app -----------------------------------------------------------

if (config.STATIC_DIR / "assets").exists():
    app.mount("/assets", StaticFiles(directory=config.STATIC_DIR / "assets"), name="assets")


@app.get("/{full_path:path}", include_in_schema=False)
def spa(full_path: str):
    candidate = (config.STATIC_DIR / full_path).resolve()
    if full_path and config.STATIC_DIR.resolve() in candidate.parents and candidate.is_file():
        return FileResponse(candidate)
    index = config.STATIC_DIR / "index.html"
    if index.exists():
        return FileResponse(index, headers={"Cache-Control": "no-cache"})
    return JSONResponse({"detail": "The web UI isn't built. Run `npm run build` in web/."}, status_code=404)


def run() -> None:
    import uvicorn

    uvicorn.run("servicehub.main:app", host="0.0.0.0", port=config.PORT, proxy_headers=True,
                forwarded_allow_ips="*", log_level="info")


if __name__ == "__main__":
    run()

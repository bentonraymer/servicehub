"""Service code on disk, uploads, and version snapshots."""

import hashlib
import io
import os
import shutil
import zipfile
from pathlib import Path, PurePosixPath

from . import config, db

IGNORED = {"__pycache__", ".git", ".DS_Store", "node_modules", ".venv", "venv"}
MAX_EDIT_BYTES = 2 * 1024 * 1024


class FileError(ValueError):
    pass


def code_dir(slug: str) -> Path:
    return config.SERVICES_DIR / slug


def appdata_dir(slug: str) -> Path:
    return config.APPDATA_DIR / slug


def logs_dir(slug: str) -> Path:
    return config.LOGS_DIR / slug


def venv_dir(slug: str) -> Path:
    return config.VENVS_DIR / slug


def versions_dir(slug: str) -> Path:
    return config.VERSIONS_DIR / slug


def clean_rel(path: str) -> str:
    p = PurePosixPath(path.replace("\\", "/").lstrip("/"))
    parts = [x for x in p.parts if x not in ("", ".")]
    if not parts or any(x == ".." for x in parts):
        raise FileError(f"Not a valid file path: {path!r}")
    return "/".join(parts)


def safe_path(slug: str, rel: str) -> Path:
    base = code_dir(slug).resolve()
    target = (base / clean_rel(rel)).resolve()
    if base != target and base not in target.parents:
        raise FileError("Path escapes the service folder")
    return target


def _skip(rel_parts: tuple[str, ...]) -> bool:
    return any(p in IGNORED for p in rel_parts)


def list_files(slug: str) -> list[dict]:
    base = code_dir(slug)
    out = []
    if not base.exists():
        return out
    for root, dirs, files in os.walk(base):
        dirs[:] = sorted(d for d in dirs if d not in IGNORED)
        for f in sorted(files):
            p = Path(root) / f
            rel = p.relative_to(base).as_posix()
            if _skip(tuple(rel.split("/"))):
                continue
            st = p.stat()
            out.append({"path": rel, "size": st.st_size, "modified": st.st_mtime})
    return out


def read_file(slug: str, rel: str) -> tuple[str | None, bool]:
    """Returns (text, is_binary)."""
    p = safe_path(slug, rel)
    if not p.is_file():
        raise FileNotFoundError(rel)
    if p.stat().st_size > MAX_EDIT_BYTES:
        return None, True
    data = p.read_bytes()
    try:
        return data.decode("utf-8"), False
    except UnicodeDecodeError:
        return None, True


def write_file(slug: str, rel: str, content: bytes) -> None:
    p = safe_path(slug, rel)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(content)


def delete_file(slug: str, rel: str) -> None:
    p = safe_path(slug, rel)
    if p.is_dir():
        shutil.rmtree(p)
    elif p.exists():
        p.unlink()
    # tidy empty parent folders
    base = code_dir(slug).resolve()
    parent = p.parent
    while parent != base and parent.exists() and not any(parent.iterdir()):
        parent.rmdir()
        parent = parent.parent


def rename_file(slug: str, src: str, dst: str) -> None:
    a, b = safe_path(slug, src), safe_path(slug, dst)
    if not a.exists():
        raise FileNotFoundError(src)
    if b.exists():
        raise FileError(f"{dst} already exists")
    b.parent.mkdir(parents=True, exist_ok=True)
    a.rename(b)


def tree_hash(slug: str) -> str:
    h = hashlib.sha256()
    base = code_dir(slug)
    for f in list_files(slug):
        h.update(f["path"].encode() + b"\0")
        h.update(hashlib.sha256((base / f["path"]).read_bytes()).digest())
    return h.hexdigest()


def clear_code(slug: str) -> None:
    base = code_dir(slug)
    if base.exists():
        shutil.rmtree(base)
    base.mkdir(parents=True, exist_ok=True)


def _zip_members(zf: zipfile.ZipFile) -> list[tuple[zipfile.ZipInfo, str]]:
    members = []
    for info in zf.infolist():
        if info.is_dir():
            continue
        name = info.filename.replace("\\", "/")
        if name.startswith("__MACOSX/") or name.split("/")[-1] == ".DS_Store":
            continue
        members.append((info, clean_rel(name)))
    # Strip a single shared top-level folder (e.g. "repo-main/...")
    tops = {m[1].split("/")[0] for m in members}
    if len(tops) == 1 and all("/" in m[1] for m in members):
        top = tops.pop() + "/"
        members = [(i, n[len(top):]) for i, n in members]
    return members


def extract_zip(slug: str, data: bytes, replace: bool) -> list[str]:
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as e:
        raise FileError("That file isn't a valid zip archive") from e
    members = _zip_members(zf)
    if replace:
        clear_code(slug)
    written = []
    for info, rel in members:
        if _skip(tuple(rel.split("/"))):
            continue
        write_file(slug, rel, zf.read(info))
        written.append(rel)
    return written


def is_zip(filename: str, data: bytes) -> bool:
    return filename.lower().endswith(".zip") or data[:4] == b"PK\x03\x04"


# ---- versions ---------------------------------------------------------------

def snapshot(service: dict, note: str, source: str) -> dict:
    slug = service["slug"]
    vdir = versions_dir(slug)
    vdir.mkdir(parents=True, exist_ok=True)
    last = db.one("SELECT MAX(number) AS n FROM versions WHERE service_id=?", (service["id"],))
    number = (last["n"] or 0) + 1
    buf = io.BytesIO()
    base = code_dir(slug)
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in list_files(slug):
            zf.write(base / f["path"], f["path"])
    data = buf.getvalue()
    (vdir / f"{number}.zip").write_bytes(data)
    h = tree_hash(slug)
    db.execute(
        "INSERT INTO versions(service_id, number, note, source, hash, size, created_at) VALUES(?,?,?,?,?,?,?)",
        (service["id"], number, note, source, h, len(data), db.now_iso()),
    )
    db.execute(
        "UPDATE services SET current_version=?, deployed_hash=?, updated_at=? WHERE id=?",
        (number, h, db.now_iso(), service["id"]),
    )
    prune_versions(service)
    return db.one("SELECT * FROM versions WHERE service_id=? AND number=?", (service["id"], number))


def prune_versions(service: dict) -> None:
    old = db.query(
        "SELECT id, number FROM versions WHERE service_id=? ORDER BY number DESC LIMIT -1 OFFSET ?",
        (service["id"], config.MAX_VERSIONS),
    )
    for v in old:
        (versions_dir(service["slug"]) / f"{v['number']}.zip").unlink(missing_ok=True)
        db.execute("DELETE FROM versions WHERE id=?", (v["id"],))


def version_zip_path(slug: str, number: int) -> Path:
    return versions_dir(slug) / f"{number}.zip"


def restore(service: dict, number: int) -> None:
    p = version_zip_path(service["slug"], number)
    if not p.exists():
        raise FileError(f"Version {number} is no longer stored")
    extract_zip(service["slug"], p.read_bytes(), replace=True)
    v = db.one("SELECT hash FROM versions WHERE service_id=? AND number=?", (service["id"], number))
    db.execute(
        "UPDATE services SET current_version=?, deployed_hash=?, updated_at=? WHERE id=?",
        (number, (v or {}).get("hash") or tree_hash(service["slug"]), db.now_iso(), service["id"]),
    )


def remove_all(slug: str) -> None:
    for d in (code_dir(slug), versions_dir(slug), venv_dir(slug), logs_dir(slug), appdata_dir(slug)):
        if d.exists():
            shutil.rmtree(d, ignore_errors=True)

"""Authenticated, profile-scoped gateway API for the Dive In desktop panel."""
from hashlib import sha256
from importlib import import_module
from importlib.util import module_from_spec, spec_from_file_location
import json
from pathlib import Path
import sqlite3
import sys

from fastapi import APIRouter, HTTPException, Request
from plugins.plugin_storage import plugin_data_dir
from starlette.concurrency import run_in_threadpool


PACKAGE_DIR = Path(__file__).resolve().parents[1]
# Hermes mounts dashboard routers as standalone modules. Give only our own
# package a path-specific module name so its relative imports work in that host.
PACKAGE_NAME = "_dive_in_" + sha256(str(PACKAGE_DIR).encode()).hexdigest()[:16]
if PACKAGE_NAME not in sys.modules:
    spec = spec_from_file_location(
        PACKAGE_NAME, PACKAGE_DIR / "__init__.py", submodule_search_locations=[str(PACKAGE_DIR)])
    if spec is None or spec.loader is None:
        raise ImportError("Dive In package is missing")
    package = module_from_spec(spec)
    sys.modules[PACKAGE_NAME] = package
    try:
        spec.loader.exec_module(package)
    except Exception:
        sys.modules.pop(PACKAGE_NAME, None)
        raise

studio_action = import_module(f"{PACKAGE_NAME}.studio_actions").studio_action
render_studio = import_module(f"{PACKAGE_NAME}.studio_assets").render_studio
router = APIRouter()


@router.get("/studio")
def studio():
    html = render_studio("hermes_bridge.js", "Hermes")
    policy = (
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; '
        'script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; '
        'img-src data:; font-src data:; base-uri \'none\'; form-action \'none\'">'
    )
    return {"html": html.replace("<title>", policy + "\n<title>", 1)}


@router.post("/action")
async def action(request: Request):
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > 820_000:
            raise HTTPException(413, "Dive In request is too large")
        data.extend(chunk)
    try:
        arguments = json.loads(data)
        if not isinstance(arguments, dict):
            raise ValueError("Expected a JSON object")
        path = plugin_data_dir("signal-atlas") / "evidence.sqlite3"
        return await run_in_threadpool(studio_action, path, arguments)
    except (KeyError, TypeError, ValueError, OSError, sqlite3.Error) as error:
        raise HTTPException(400, str(error)) from error

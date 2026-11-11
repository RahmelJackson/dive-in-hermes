"""Bundle the studio into a single offline HTML resource."""
from base64 import b64encode
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def render_studio(bridge, host_name):
    page = (ROOT / "studio.html").read_text(encoding="utf-8").replace("Codex", host_name)
    start = page.index("async function api(")
    end = page.index("function status(", start)
    page = page[:start] + (ROOT / bridge).read_text(encoding="utf-8") + page[end:]
    return bundle_studio(page)


def bundle_studio(page):
    css = (ROOT / "studio.css").read_text(encoding="utf-8")
    for name in ("Geist-Variable", "GeistMono-Variable"):
        font = (ROOT / "fonts" / f"{name}.woff2").read_bytes()
        css = css.replace(f"__{name}__", b64encode(font).decode("ascii"))
    page = page.replace("/* STUDIO_CSS */", css)
    for script in ("glass-optics", "glass-scene", "dive-map", "data-cloud", "story-lens", "argument-map"):
        marker = script.replace("-", "_").upper()
        page = page.replace(f"/* {marker} */", (ROOT / f"{script}.js").read_text(encoding="utf-8"))
    return page

"""Serve the local Signal Atlas workspace."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import secrets
import sqlite3
import webbrowser

from .studio_actions import studio_action
from .studio_assets import bundle_studio


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True)
    parser.add_argument("--open", action="store_true")
    args = parser.parse_args()
    data_path = Path(args.db)
    token = secrets.token_urlsafe(24)
    page = (Path(__file__).with_name("studio.html").read_text(encoding="utf-8")
            .replace("__TOKEN__", token).replace("Codex", "Hermes"))
    page = bundle_studio(page)

    class Handler(BaseHTTPRequestHandler):
        def reply(self, status, body, mime="application/json"):
            payload = (json.dumps(body) if mime == "application/json" else body).encode()
            self.send_response(status)
            self.send_header("Content-Type", mime + "; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self):
            if self.headers.get("Host") != f"127.0.0.1:{self.server.server_port}":
                self.reply(403, {"error": "Invalid host"})
            elif self.path == "/":
                self.reply(200, page, "text/html")
            else:
                self.reply(404, {"error": "Unknown route"})

        def do_POST(self):
            if (self.path != "/api" or self.headers.get("X-Atlas-Token") != token
                    or self.headers.get("Host") != f"127.0.0.1:{self.server.server_port}"):
                self.reply(403, {"error": "Request denied"})
                return
            try:
                length = int(self.headers.get("Content-Length", 0))
                if not 0 < length <= 820_000:
                    raise ValueError("Request is too large or empty")
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict):
                    raise ValueError("Expected a JSON object")
                self.reply(200, studio_action(data_path, body))
            except (TypeError, ValueError, KeyError, OSError, sqlite3.Error) as error:
                self.reply(400, {"error": str(error)})

    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        address = f"http://127.0.0.1:{server.server_port}"
        print(address, flush=True)
        if args.open:
            webbrowser.open(address)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()


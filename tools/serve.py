#!/usr/bin/env python3
"""Serve web/ on 127.0.0.1:8787 and let the page save its state into web/data/.

  python3 tools/serve.py          # then open http://127.0.0.1:8787/

GET  anything        -> static file from web/ (no caching)
POST /data/<name>.json -> writes web/data/<name>.json (name in: layout, presets, midimap)
"""
import functools
import http.server
import json
import os
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web"))
ALLOWED = {"layout", "presets", "midimap"}


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        name = self.path[len("/data/"):-len(".json")] if self.path.startswith("/data/") and self.path.endswith(".json") else None
        if name not in ALLOWED:
            self.send_error(404, "unknown data file")
            return
        try:
            obj = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
        except (ValueError, TypeError):
            self.send_error(400, "bad json")
            return
        os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
        with open(os.path.join(ROOT, "data", name + ".json"), "w") as f:
            json.dump(obj, f, indent=1, sort_keys=True)
        self.send_response(204)
        self.end_headers()

    def log_message(self, fmt, *args):
        if self.command == "POST":
            sys.stderr.write("%s %s\n" % (self.command, self.path))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
    print(f"arclight: serving {ROOT} on http://127.0.0.1:{port}/ (saves go to web/data/)", flush=True)
    http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(Handler, directory=ROOT)).serve_forever()


if __name__ == "__main__":
    main()

#!/usr/bin/env -S uv run --quiet
# /// script
# requires-python = ">=3.10"
# dependencies = ["websockets>=12"]
# ///
"""Print the arclamp live output stream (the composited result of every layer).

  uv run tools/stream.py                 fps + bulb 1 / 4x1 56 / relay 64, once a second
  uv run tools/stream.py 1 30 64         watch these ids instead
  uv run tools/stream.py --seconds 5     stop after 5 s (default: until Ctrl-C)
"""
import argparse
import asyncio
import json
import os
import sys
import time

import websockets

SERVER = os.environ.get("ARCLAMP_SERVER", "http://arclight.local:8080").rstrip("/")
def load_token():
    tok = os.environ.get("ARCLAMP_TOKEN")
    if tok:
        return tok
    env = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
    try:
        with open(env) as f:
            for line in f:
                line = line.strip()
                if line.startswith("ARCLAMP_TOKEN="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    sys.exit("no token: set ARCLAMP_TOKEN, or put ARCLAMP_TOKEN=<token> in .env at the repo root "
             "(copy it from the Token field on http://arclight.local:8081/debug.html)")


async def run(ids, seconds):
    url = SERVER.replace("http", "ws", 1) + f"/v1/scene/ws?access_token={load_token()}&full=json"
    async with websockets.connect(url, max_size=None) as ws:
        t0 = time.time(); last = t0; n = 0
        while seconds is None or time.time() - t0 < seconds:
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=5)
            except asyncio.TimeoutError:
                print("no frames for 5 s"); continue
            n += 1
            now = time.time()
            if now - last >= 1.0:
                by = {l["id"]: l["channels"] for l in json.loads(msg)["lights"]}
                cells = "  ".join(f"#{i} " + " ".join(f"{k[0]}{v:3d}" for k, v in sorted(by[i].items())) for i in ids if i in by)
                print(f"{n / (now - last):5.1f} fps   {cells}")
                last = now; n = 0


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("ids", nargs="*", type=int, default=[1, 56, 64])
    p.add_argument("--seconds", type=float)
    a = p.parse_args()
    try:
        asyncio.run(run(a.ids, a.seconds))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

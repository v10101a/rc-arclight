# arclight

Workspace for building my own interface to the **arclamp** lighting server that runs on
`arclight.local` (a Raspberry Pi on the studio LAN). The server itself is not in this repo and
I'm not changing it; everything here talks to its HTTP API on port 8080.

- `docs/arclamp-api.md` — how the server works, every endpoint, measured speeds, open questions.
- `docs/controller-design.md` — what's wrong with the current system and the design for the new controller.
- `docs/lights.json` — snapshot of the fixture inventory (`GET /v1/lights`), 2026-10-15.
- `tools/arclamp.py` — stdlib-only CLI: inspect the scene, reset it, set the roomtone, mute layers.
- `tools/stream.py` — print the live output stream (needs `uv`).
- `web/` — (next) the interface itself, p5 + plain `fetch`.

## Quick start

```sh
python3 tools/arclamp.py lights            # what fixtures exist
python3 tools/arclamp.py scene             # what layers are stacked right now
python3 tools/arclamp.py reset --dry-run   # what reset would delete
python3 tools/arclamp.py reset             # delete every JS layer, leave the roomtone
python3 tools/arclamp.py roomtone          # current base look
python3 tools/arclamp.py roomtone set 1-55 red=0 green=0 blue=0 cold=120 warm=200
uv run tools/stream.py 1 30 64            # watch three lights live
```

The tools need the API token: copy it from the Token field on the debug page into `.env` at the
repo root as `ARCLAMP_TOKEN=...` (gitignored), or export `ARCLAMP_TOKEN`. `ARCLAMP_SERVER`
overrides the default `http://arclight.local:8080`.

## The one-paragraph model

Output = a stack of layers. Layer 0 is the **roomtone**, a static colour per light. Every layer
above it is a JavaScript function the Pi runs ~100 times a second that returns colours for
some lights. Higher position is applied later and wins, and a layer that doesn't mention a
light leaves it alone. The debug page's "Send demo" button adds a new layer every press and
never removes one, which is how the scene ends up with a dozen demos stacked and only the top
one visible. `reset` clears them.

## Related

- `~/arclamp-td/` — OSC bridge so TouchDesigner can drive the lamp with a stock OSC Out CHOP.
  Lives outside this repo for now; `git mv` it in when it settles.
- Debug page: http://arclight.local:8081/debug.html (static, a dev console, not the product).

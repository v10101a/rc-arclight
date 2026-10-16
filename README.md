# arclight

Workspace for building my own interface to the **arclamp** lighting server that runs on
`arclight.local` (a Raspberry Pi on the studio LAN). The server itself is not in this repo and
I'm not changing it; everything here talks to its HTTP API on port 8080.

- `docs/arclamp-api.md` — how the server works, every endpoint, measured speeds, open questions.
- `docs/controller-design.md` — what's wrong with the current system and the design for the new controller.
- `docs/lights.json` — snapshot of the fixture inventory (`GET /v1/lights`), 2026-10-15.
- `web/floorplan.js` — the Recurse floor plan, geometry by Aaron (see below).
- `web/data/` — the light positions (`layout.json`, floor-plan units), the rows as groups (`map.json`),
  Aaron's original `recurse-mapping.json`, presets and the MIDI map. The page saves here as you edit.
- `tools/arclamp.py` — stdlib-only CLI: inspect the scene, reset it, set the roomtone, mute layers.
- `tools/stream.py` — print the live output stream (needs `uv`).
- `tools/serve.py` — serves `web/` and saves the page's layout/presets/MIDI map into `web/data/`.
- `tools/recurse_map.py` — import Aaron's `mapping.json` into `web/data/`, or export ours back in his format.
- `web/index.html` — the controller: floor plan, colour targets, looks with knobs, presets, Web MIDI. No build step, no dependencies.

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

## The controller

```sh
python3 tools/serve.py
open http://127.0.0.1:8787/
```

Paste the token once (it's remembered in the browser). `tools/serve.py` is a static server plus
one POST route the page uses to save the light layout, presets and MIDI map into `web/data/`
(automatically, after every change), so that work lives in the repo and not only in the browser.
Serve from `localhost` rather than from the Pi: Chrome only gives a page Web MIDI in a secure
context, and `localhost` counts.

How it drives the lights, in one breath: colour controls write **targets** into the roomtone
(fast, ~85 ms); one generated **engine layer** on the Pi eases every light toward its target and
multiplies in a **look** (breathe, chase, wave, sparkle, strobe) with a crossfade when the look
changes; "Solo" mutes everyone else's layers so the targets are what you see, and clicking it
again gives the room back.

## The one-paragraph model

Output = a stack of layers. Layer 0 is the **roomtone**, a static colour per light. Every layer
above it is a JavaScript function the Pi runs ~100 times a second that returns colours for
some lights. Higher position is applied later and wins, and a layer that doesn't mention a
light leaves it alone. The debug page's "Send demo" button adds a new layer every press and
never removes one, which is how the scene ends up with a dozen demos stacked and only the top
one visible. `reset` clears them.

## The map

The floor plan and the light rows come from Aaron's
[recurseLightMap](https://github.com/aaronw122/recurseLightMap): a phone-first editor he used on
site to trace the space from the egress sign and assign numbers 1–55 to bulbs grouped into rows
(Kitchen 1, Couches 2, Row 14C…). This page uses that frame and those rows directly:

- positions and the plan are in his units (building 1000 × 520); scroll pans, pinch or ctrl+scroll
  zooms, "fit" resets;
- each row is a **group**: click its chip to select it, shift+click to add, and the row's order is
  the "row by row" order for chase and wave;
- dots are the live colour of each light with the row colour as a ring and the number inside.

To take a newer map from Aaron: `python3 tools/recurse_map.py import path/to/mapping.json`. To hand
him positions edited here: `python3 tools/recurse_map.py export mapping.json`. Bulb 55 is not in
his file; it is placed from Viola's own mapping near the top wall by the WCs in a group called
"Hall (check)" until someone confirms it with identify.

## Related

- `~/arclamp-td/` — OSC bridge so TouchDesigner can drive the lamp with a stock OSC Out CHOP.
  Lives outside this repo for now; `git mv` it in when it settles.
- Debug page: http://arclight.local:8081/debug.html (static, a dev console, not the product).

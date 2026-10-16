# arclamp: how the server works

Everything below was learned from `debug.html` (its JavaScript is the only client the
server ships with) and from poking the API on 2026-10-15. The server source is not on my Mac.
Where two sessions measured different numbers both are listed.

## Hosts and ports

| what | where | notes |
|---|---|---|
| the Pi | `arclight.local`, was 10.100.9.127, MAC `b8:27:eb:18:6a:bc` | Raspberry Pi, Debian 13, sshd open (key or password) |
| debug page | `http://arclight.local:8081/debug.html` | plain Python `http.server` with no-cache headers; also serves `debug.html.bak`, `.pre-dither`, `.pre-fix`, `serve.py` |
| API | `http://arclight.local:8080/v1/...` | the real server, probably Go with an embedded V8 |
| stream | `ws://arclight.local:8080/v1/scene/ws` | live output frames |

If `arclight.local` stops resolving: `dns-sd -G v4 arclight.local`, or `arp -a | grep b8:27:eb`
to find the Pi's current IP. The first lookup after the Pi boots or the Mac joins the network can
time out once.

## Auth and CORS

Every request: `Authorization: Bearer <token>`. The websocket takes `?access_token=<token>`.
The debug page pre-fills a demo token (its Token field; starts with `arclamp-demo-`). Keep it in
`.env` at the repo root as `ARCLAMP_TOKEN=...` (gitignored); the tools read it from there. Layers it creates get `created_by: "demo"`, so the token name is an identity and other tokens
probably exist with more rights.

CORS is wide open: `Access-Control-Allow-Origin: *`, methods GET/POST/PUT/DELETE/OPTIONS,
headers Authorization + Content-Type, preflight returns 204. Verified from a foreign origin and
from `Origin: null` (a page opened from a local file). So an interface can be a static HTML file
anywhere; no proxy needed.

## Fixtures

`GET /v1/lights` → `{"id_width": 1, "lights": [...]}`. 115 lights, no tags, no coords on any of
them (the server knows nothing about physical layout). Snapshot in `lights.json`.

| ids | type | count | channels (all 8-bit, 0–255) | notes |
|---|---|---|---|---|
| 1–55 | `br30` | 55 | red, green, blue, cold, warm | the bulbs; every demo targets exactly these |
| 56–63 | `4x1` | 8 | red, green, blue, cold, warm | untouched by any demo |
| 64–115 | `relay` | 52 | brightness | **on/off hardware**. The API exposes 0–255 but the driver thresholds it; they do not dim. Threshold value untested |

cold = cool white emitter, warm = warm white emitter, separate from RGB. The debug page's
preview sums them additively (cold ≈ (1, .94, .86), warm ≈ (1, .72, .36)).

## The scene: a layer stack

`GET /v1/scene` returns an ordered list of layers (the server calls them shaders):

```json
{ "id": 0, "type": "roomtone", "position": 0, "template": { "lights": { "1": {"red": 176, ...}, "100": {"brightness": 255} } },
  "state": "running", "muted": false, "respawns": -1, "created_by": "system", ... }
{ "id": 10, "type": "js", "position": 7, "script": "function update(prev, curr, init){ ... }",
  "state": "running", "muted": false, "respawns": 25, "created_by": "demo", "created_at": "...", "modified_at": "...", ... }
```

Rules:

- **Position 0 is always the roomtone.** Not a script: a static per-light template of channel
  values, the base look of the room. It has an entry for all 115 lights. It persists until
  someone writes it; `reset` does not touch it.
- **Positions 1..N are JS layers.** Each tick the server evaluates every unmuted layer from
  position 1 upward. A layer overwrites the channels of the lights it returns. A light it does
  not return falls through to the layer below ("blank means merge"). No blend modes, only replace.
- **Highest position wins.** Confirmed by watching the stream: with 14 layers stacked, bulb 1
  tracks the top one. `position: "bottom"` on create means "append" = highest position = top of
  the stack, which the debug page confusingly calls the bottom of its table.
- **Mute** keeps the layer but skips it. **state** is `running`, `error` or `restarting`;
  `respawns` counts restarts. The counts on healthy demo layers climb over an hour (13–25), so
  the server restarts scripts periodically or on scene changes; cause unknown.
- A demo that returns all 55 bulbs hides every layer below it for those bulbs. The "all off
  (reset)" demo is just another such layer, not a reset.

### What "stacked" looked like on 2026-10-15

Fourteen layers, ids 4–16, every one a demo someone pressed "Send demo now" on. Positions 1–8
were full-room sweeps and waves that could never be seen because position 13 (another rainbow
sweep) covered all 55 bulbs. Relays only showed the roomtone (brightness 209). The 4x1s only
showed the roomtone (red 255). `python3 tools/arclamp.py scene` prints this list;
`python3 tools/arclamp.py reset` deletes every JS layer.

## Shader format

Not GLSL. A layer is JavaScript, compiled in a sandboxed V8 on the Pi and called about every
10 ms:

```js
function update(prev, curr, init) {
  // curr: wall-clock ms since the Unix epoch (so curr % 8000 is a global clock shared by all layers)
  // init: epoch ms when this layer started
  // prev: the composited frame BELOW this layer (roomtone + every layer under it), NOT including
  //       this layer's own last output. Shape: { lights: [ { id, channels: {...} }, ... ] }
  return { lights: [
    { id: 1, channels: { red: 0, green: 0, blue: 0, cold: 255, warm: 100 } },
  ] };
}
```

- Only `"type": "js"` is accepted (`{"code":"bad_type","error":"only \"js\" shaders can be created"}`).
- The script must compile; otherwise 400 `{"code":"js_compile","error":"script failed to compile: SyntaxError: ..."}`.
- Values are integers 0–255. A channel name the light doesn't have, or a value out of range, is a 400.
- `return { lights: [] }` is a legal no-op layer (handy as an invisible probe).
- `Math.random()` works but is unseeded and re-rolls every tick; the demos hash `curr` instead.
- Because `curr` is wall-clock, two layers with the same period are phase-locked, and a layer
  re-uploaded with the same code resumes in phase.

### Verified with an invisible probe layer (2026-10-15)

A throwaway top layer wrote blue 0–3 (below visible) on four 4x1 fixtures to encode answers,
then deleted itself:

- **`prev` is the frame below you**: it carries channels you never wrote (roomtone values and
  whatever layers underneath produced) and does *not* contain your own previous output. So a
  layer at the top of the stack can read the roomtone as a set of targets and ease toward them.
- **Scripts keep state between ticks.** A module-level `var n` incremented on every call cycled
  0,1,2,3 across frames. A layer can hold its own eased values, phases, counters.
- **`init` is the layer's start** (`curr - init` grew past 1 s as expected).
- **The stream reports exact values.** The probe's 0–3 came back as exactly 0–3. Earlier sightings
  of `warm: 9–12` on bulbs were a layer's output (the lightning demo keeps a dim base), not
  dithering.
- **Load kills the tick rate.** With 18 demo layers running the probe measured under 25 ticks/s
  (the demos' comments assume ~100), the stream sat at ~10 fps, and a roomtone write took
  **1.4 s** to appear on the stream even though the PUT returned in 69 ms. Keep the scene small.

The 16 demo scripts live in `debug.html` (`const DEMOS = [...]`) and are the best examples.

## Endpoints

All JSON. Successful writes return the updated object or 204.

| method & path | body | what it does |
|---|---|---|
| `GET /v1/lights` | | fixture inventory |
| `GET /v1/scene` | | every layer, position order |
| `GET /v1/shader/:id` | | one layer (`0` = roomtone) |
| `PUT /v1/shader/0` | `{"lights": {"12": {"red": 255}}}` | merge into the roomtone; only listed lights/channels change |
| `POST /v1/scene/shader` | `{"type": "js", "script": "...", "position": "bottom" \| "top" \| N}` | create a layer |
| `PUT /v1/shader/:id` | `{"script": "..."}` | replace a layer's code (recompiles) |
| `POST /v1/shader/:id/muted` | `{"muted": true}` | mute / unmute |
| `POST /v1/shader/:id/position` | `{"position": "top" \| "bottom" \| N}` | reorder; N ≥ 1, roomtone can't move |
| `DELETE /v1/shader/:id` | | remove a layer |
| `WS /v1/scene/ws?access_token=T[&full=json]` | | live output |

Nothing else answers: `/`, `/v1`, `/v1/shaders`, `/v1/status`, `/docs`, `/openapi.json` are 404.

## Stream

`ws://arclight.local:8080/v1/scene/ws?access_token=<token>` pushes the final composited frame
(after all layers) continuously. Default is a binary frame of about 609 bytes; `&full=json`
gives `{"initial_time": <epoch ms>, "lights": [{"id", "type", "tags", "coords", "channels": {...}}]}`
at about 9 KB.

Binary layout (the page's comment cites "§7.3" of a spec I haven't found):

```
i64 LE  initial_time (epoch ms)
u16 LE  light_count
u16 LE  format_rev
then per light:
  u8  id
  u8  channel_mask      bit i = channel i of that light's channel order (from /v1/lights) is present
  u8  value, one per set bit, in channel order
```

Frame rate depends on load: 37 fps with 7 layers, ~17 Hz in another measurement, visibly lower
with 14 layers. Coalesce to the latest frame on the client (the debug page does) or the browser
will queue frames without bound.

## Measured speeds (2026-10-15)

| operation | this session | other session |
|---|---|---|
| roomtone `PUT /v1/shader/0` | 85 ms median, 11/s sequential, 22/s aggregate with 4 writers | 30–170 ms, 7–10 Hz sustained |
| script `PUT /v1/shader/:id` | 600 ms median, 2 s max (14 layers running) | 150–430 ms, ~3/s |
| `POST .../muted` | | 25–90 ms |
| stream read | 37 fps (7 layers) | ~17 Hz |

Concurrent heavy requests can stall the server for seconds (one write took 5 s while two layers
were being created). Send writes from one place, in order.

Consequences:

- You cannot stream animation frames from a client at display rate. Full-room updates through
  the roomtone top out around 10 per second: fine for fades, steppy for motion.
- Animation belongs in JS layers on the Pi. A client steers them by re-uploading the script
  (slow, debounce it) or by writing the roomtone underneath (fast enough for sliders).
- Keep one layer per look and edit it in place with `PUT`; don't create a new one per change.

## Resetting

"Stacked" means many layers in the scene at once, each hiding the ones below. To get back to a
clean room:

1. `python3 tools/arclamp.py reset` deletes every JS layer (ids ≠ 0). Equivalent to pressing
   Delete on each row of the debug page's Scene table, or `DELETE /v1/shader/:id` per layer.
2. The roomtone survives. To black it out: `python3 tools/arclamp.py roomtone set all red=0 green=0 blue=0 cold=0 warm=0 brightness=0`
   (channels a light doesn't have are skipped per light).
3. Mute instead of delete if you want to keep a layer around: `python3 tools/arclamp.py mute 12`.

## Open questions

- Relay threshold: which brightness value first turns a relay on (1? 128?).
- Where the spec with "§7.3" lives, and the server source. The Pi's sshd accepts passwords, so
  whoever set it up has the login.
- Why `respawns` climbs on healthy layers.
- Whether the server has any notion of a "snapshot" or preset. Nothing in the API suggests it,
  so presets will be a client-side concern.

## Interface design notes

Plan for `web/`, all one static page using p5 and `fetch`, no server of its own:

1. **Floor plan, not a table.** Subscribe to the stream, draw the 115 lights where they are in
   the room. The layout map (id → x, y) lives in the page and localStorage, since the server
   has no coords. Make it editable by dragging.
2. **Static looks through the roomtone.** Colour pickers and relay toggles write
   `PUT /v1/shader/0`. 85 ms feels live. Batch many lights into one request.
3. **Animated looks as parameterised layers.** A few script templates with named constants at
   the top (speed, hue, which ids). Knobs change the constants; the page debounces and re-uploads
   with `PUT /v1/shader/:id`. One layer per look, edited in place.
4. **Selection on the floor plan becomes the id list baked into the script.** That gives "this
   wall only" without the server knowing the layout.
5. **Presets** are client-side JSON: roomtone + the layer scripts, restorable in a couple of
   requests.

TouchDesigner can do the same through its Web Client and WebSocket DATs, with the same rate
limits; `~/arclamp-td/arclamp_bridge.py` already does it over OSC.

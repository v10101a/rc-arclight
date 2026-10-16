// arclight: live looks. A live look is a field: level = fn(light, t, IN, params), with light = {id, x, y, u, k, n}
// in floor units and IN the input bus. It runs here at frame rate, scales each light's base colour by the level
// and streams the result to the Pi as targets (the write scheduler coalesces that to <= 10 Hz); the Pi's engine
// only smooths. Baked looks (LOOK_SRC in core.js) run on the Pi and keep going when this page closes; live looks stop.
// To add one: a params table like LOOK_PARAMS plus fn, below. It appears in the Look menu under "live".
"use strict";
LIVE.spot = {
  params: { radius: [20, 400, 110, ""], soft: [0.3, 4, 1.5, ""], floor: [0, 1, 0.04, ""] },
  // a pool of light around the input point: a tracked person, or the mouse over the plan until there is one
  fn(l, t, IN, p) {
    const q = inputPoint(); if (!q) return p.floor;
    const d = Math.hypot(l.x - q.x, l.y - q.y) / p.radius;
    return p.floor + (1 - p.floor) * Math.pow(Math.max(0, 1 - d), p.soft);
  },
};
for (const n in LIVE) LOOK_PARAMS[n] = LIVE[n].params;

function liveStep(now) {
  const L = LIVE[S.look.name] || null;
  const want = new Set(L ? S.look.ids.filter((id) => S.lights[id] && S.lights[id].type !== "relay") : []);
  const back = {};                                                   // lights we stop driving go back to their base colour
  for (const id of S.liveIds) if (!want.has(id) && S.base[id]) back[id] = Object.assign({}, S.base[id]);
  S.liveIds = want;
  if (Object.keys(back).length) queueTargets(back);
  if (!L) return;
  const p = S.look.params, n = S.look.ids.length, out = {};
  S.look.ids.forEach((id, k) => {
    if (!want.has(id)) return;
    const b = S.base[id], q = S.layout[id]; if (!b || !q) return;
    let e = L.fn({ id, x: q.x, y: q.y, u: (S.look.u && S.look.u[id]) || 0, k, n }, now, IN, p);
    e = e > 1 ? 1 : e > 0 ? e : 0;
    const cur = S.targets[id] || {}, ch = {}; let diff = false;
    for (const c in b) { const v = Math.round(b[c] * e); ch[c] = v; if (cur[c] !== v) diff = true; }
    if (diff) out[id] = ch;
  });
  if (Object.keys(out).length) queueTargets(out);
}
// one call per animation frame, from the draw loop in plot.js: inputs, then live looks, then the simulator
function tick(now) { IN.t = now; liveStep(now); simStep(now); }

// arclight: the simulator. Runs the same engine script the Pi runs, here in the page, against the local roomtone
// mirror (S.room), whenever there is no live stream: the Pi unreachable, or the stream dropped. The plot shows
// its output exactly as it shows the stream, so looks can be built and tuned away from the room.
"use strict";
const SIM = { update: null, src: "", frame: {}, calls: 0 };
function simCompile(src) {
  if (src === SIM.src && SIM.update) return;
  try { SIM.update = new Function(src + "\nreturn update;")(); SIM.src = src; SIM.calls = 0; }
  catch (e) { SIM.update = null; console.warn("simulator: the engine script did not compile", e); }
}
function simStep(now) {
  const on = S.ids.length > 0 && !(S.ws && S.ws.readyState === 1);
  if (on !== S.sim) { S.sim = on; SIM.frame = {}; updateHealth(); needDraw = true; }
  if (!on) return;
  if (!SIM.update) simCompile(engineScript());
  if (!SIM.update) return;
  const prev = { lights: [] };
  for (const id in S.room) prev.lights.push({ id: +id, channels: S.room[id] });
  let out;
  try { out = SIM.update(prev, now, SIM.calls++ === 0); }
  catch (e) { console.warn("simulator: the engine threw", e); SIM.update = null; return; }
  let changed = false;
  for (const l of (out && out.lights) || []) {
    const o = SIM.frame[l.id], c = l.channels; let same = !!o;
    if (same) for (const k in c) if (o[k] !== c[k]) { same = false; break; }
    if (!same) { SIM.frame[l.id] = c; changed = true; }
  }
  if (changed) needDraw = true;
}

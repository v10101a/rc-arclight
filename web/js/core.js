// arclight: shared state, the arclamp API, the write scheduler, the engine layer, connect/stream, scene and layers.
// Loaded first; plot.js and controls.js build on the globals defined here.
"use strict";
const $ = (id) => document.getElementById(id);
const LS = {
  get(k, d) { try { const v = localStorage.getItem("arclight." + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("arclight." + k, JSON.stringify(v)); } catch (e) { } },
};
const COLOUR_CHANS = ["red", "green", "blue", "cold", "warm"];
const ENGINE_TAG = "// arclight-engine v1";

// ---------- looks: envelope functions that run on the Pi, and their knobs ----------
const LOOK_SRC = `
function hash(n) { var x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); }
var LOOKS = {
  none:    function () { return 1; },
  breathe: function (id, k, n, t, p) { return 1 - p.depth * (0.5 + 0.5 * Math.sin(2 * Math.PI * t / p.speed)); },
  chase:   function (id, k, n, t, p, u) { var pos = ((t % p.speed) / p.speed) * n; var d = Math.abs(k - pos); d = Math.min(d, n - d); return p.floor + (1 - p.floor) * Math.max(0, 1 - d / p.width); },
  wave:    function (id, k, n, t, p, u) { var ph = u - (t % p.speed) / p.speed; ph -= Math.floor(ph); return p.floor + (1 - p.floor) * Math.pow(Math.sin(ph * Math.PI), p.sharp); },
  sparkle: function (id, k, n, t, p) { var h = hash(id * 7.13 + Math.floor(t / p.rate) * 3.7); return h < p.density ? 1 : p.floor; },
  strobe:  function (id, k, n, t, p) { return Math.floor(t / p.period) % 2 === 0 ? 1 : 0; }
};`;
// name: [min, max, default, unit]
const LOOK_PARAMS = {
  none: {},
  breathe: { speed: [500, 20000, 4000, "ms"], depth: [0, 1, 0.7, ""] },
  chase: { speed: [300, 20000, 3000, "ms"], width: [0.5, 20, 2, "lights"], floor: [0, 1, 0.1, ""] },
  wave: { speed: [500, 20000, 6000, "ms"], sharp: [1, 12, 4, ""], floor: [0, 1, 0.05, ""] },
  sparkle: { rate: [20, 2000, 150, "ms"], density: [0, 1, 0.3, ""], floor: [0, 1, 0.2, ""] },
  strobe: { period: [30, 1000, 90, "ms"] },
};
function defaultParams(name) { const o = {}; for (const k in LOOK_PARAMS[name]) o[k] = LOOK_PARAMS[name][k][2]; return o; }
// spatial orders for chase / wave, computed from the mapped positions: ids sorted, plus u = 0..1 position along the order
const ORDERS = { "rows": "row by row", "→": "left → right", "←": "right → left", "↓": "top → bottom", "↑": "bottom → top", "↻": "around ↻", "↺": "around ↺", "path": "snake path", "id": "by id" };
function orderIds(ids, order) {
  const P = (id) => S.layout[id] || { x: 0.5, y: 0.5 }, u = {};
  if (!ids.length) return { ids: [], u };
  if (order === "id" || order === "rows") {
    const rank = {}; let k = 0; if (order === "rows") for (const g of S.map.groups) for (const id of g.ids) rank[id] = k++;
    const s = [...ids].sort((a, b) => ((rank[a] ?? 1e9) - (rank[b] ?? 1e9)) || (a - b));
    s.forEach((id, i) => { u[id] = s.length > 1 ? i / (s.length - 1) : 0; }); return { ids: s, u };
  }
  if (order === "path") {
    const rest = new Set(ids); let cur = [...ids].sort((a, b) => P(a).x - P(b).x)[0]; rest.delete(cur);
    const path = [cur], dist = { [cur]: 0 }; let total = 0;
    while (rest.size) { let best = null, bd = 1e9; for (const id of rest) { const d = Math.hypot(P(id).x - P(cur).x, P(id).y - P(cur).y); if (d < bd) { bd = d; best = id; } } rest.delete(best); total += bd; dist[best] = total; path.push(best); cur = best; }
    path.forEach((id) => { u[id] = total ? dist[id] / total : 0; }); return { ids: path, u };
  }
  let val;
  if (order === "↻" || order === "↺") {
    const cx = ids.reduce((a, id) => a + P(id).x, 0) / ids.length, cy = ids.reduce((a, id) => a + P(id).y, 0) / ids.length;
    val = (id) => { const a = (Math.atan2(P(id).y - cy, P(id).x - cx) + Math.PI) / (2 * Math.PI); return order === "↻" ? a : 1 - a; };
  } else { const th = { "→": 0, "↓": Math.PI / 2, "←": Math.PI, "↑": -Math.PI / 2 }[order] || 0; val = (id) => P(id).x * Math.cos(th) + P(id).y * Math.sin(th); }
  const vs = ids.map(val), mn = Math.min(...vs), mx = Math.max(...vs);
  ids.forEach((id, i) => { u[id] = mx > mn ? (vs[i] - mn) / (mx - mn) : 0; });
  return { ids: [...ids].sort((a, b) => u[a] - u[b]), u };
}
function setLookIds(ids) { const o = orderIds(ids, S.look.order || "rows"); S.look.ids = o.ids; S.look.u = o.u; }

// ---------- state ----------
const S = {
  lights: {}, ids: [], frame: {}, fpsCount: 0, fps: 0, ws: null,
  scene: [], engine: null, selection: new Set(), layout: {}, editLayout: false,
  targets: {},                                   // id -> channels we believe the roomtone holds
  look: LS.get("look", null) || { name: "none", params: {}, ids: [], order: "rows" },
  prevLook: null, tau: LS.get("tau", 150), fade: LS.get("fade", 800),
  presets: LS.get("presets", null) || new Array(8).fill(null),
  midimap: LS.get("midimap", {}), learn: null, mutedByUs: LS.get("mutedByUs", []),
  intensity: 1, showOthers: LS.get("showOthers", false),
  map: { groups: [], unnumbered: [] }, groupOf: {},
  midiAccess: null, mapping: false,
};
function plotted() { return S.showOthers ? S.ids : S.ids.filter((id) => S.lights[id].type === "br30"); }

// ---------- api ----------
function setStatus(msg, cls) { const el = $("status"); el.textContent = msg; el.className = "hint " + (cls || ""); }
function base() { return (S.base || $("srv").value).replace(/\/+$/, ""); }
// arclight.local often stops resolving on this network; tools/serve.py can find the Pi by MAC instead
async function resolveServer() {
  const typed = $("srv").value.replace(/\/+$/, "");
  if (!/arclight\.local/i.test(typed)) { S.base = typed; return; }
  try { const j = await (await fetch("api/resolve", { cache: "no-store" })).json(); if (j.ip) { S.base = typed.replace(/arclight\.local/i, j.ip); S.via = j.via; return; } } catch (e) { }
  S.base = typed; S.via = null;
}
async function api(method, path, body) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
  let r;
  try {
    r = await fetch(base() + path, {
      method, headers: { Authorization: "Bearer " + $("tok").value, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal,
    });
  } catch (e) { throw new Error(e.name === "AbortError" ? "no answer in 8 s" : e.message); }
  finally { clearTimeout(timer); }
  if (r.status >= 400) { let m = "HTTP " + r.status; try { m = (await r.json()).error || m; } catch (e) { } throw new Error(m); }
  return r.status === 204 ? null : r.json();
}

// ---------- write scheduler: one request in flight, targets coalesced at <= 10 Hz ----------
const Q = { pending: {}, inflight: false, timer: null, lastLat: 0, engineDirty: false, engineTimer: null };
function queueTargets(map) {
  for (const id in map) {
    Q.pending[id] = Object.assign(Q.pending[id] || {}, map[id]);
    S.targets[id] = Object.assign(S.targets[id] || {}, map[id]);
  }
  scheduleFlush();
}
function scheduleFlush() { if (Q.timer || Q.inflight) return; Q.timer = setTimeout(flush, 100); }
async function flush() {
  Q.timer = null;
  if (Q.inflight) return;
  const body = Q.pending; Q.pending = {};
  if (!Object.keys(body).length) { if (Q.engineDirty) uploadEngine(); updateHealth(); return; }
  Q.inflight = true; const t = performance.now();
  try { await api("PUT", "/v1/shader/0", { lights: body }); Q.lastLat = performance.now() - t; }
  catch (e) { setStatus("write failed: " + e.message, "bad"); }
  Q.inflight = false; updateHealth();
  if (Object.keys(Q.pending).length) scheduleFlush();
  else if (Q.engineDirty) uploadEngine();
}
function requestEngine() {
  LS.set("look", S.look); LS.set("tau", S.tau); LS.set("fade", S.fade);
  clearTimeout(Q.engineTimer);
  Q.engineTimer = setTimeout(() => { Q.engineDirty = true; if (!Q.inflight && !Q.timer) flush(); }, 300);
}

// ---------- engine layer (generated JS that runs on the Pi) ----------
function engineScript() {
  const smoothIds = S.ids.filter((id) => S.lights[id].type !== "relay");
  const old = S.prevLook || { name: "none", params: {}, ids: [] };
  return `${ENGINE_TAG}
// generated by arclight web/index.html -- edit the page, not this
var TAU = ${S.tau}, FADE = ${S.fade};
var SMOOTH_IDS = ${JSON.stringify(smoothIds)};
var OLD = ${JSON.stringify(old)};
var NEW = ${JSON.stringify(S.look)};
${LOOK_SRC}
var state = {}, lastT = 0, started = 0;
function idx(look) { var m = {}; for (var i = 0; i < look.ids.length; i++) m[look.ids[i]] = i; return m; }
var OLD_IDX = idx(OLD), NEW_IDX = idx(NEW);
function env(look, map, id, t) { var k = map[id]; if (k === undefined) return 1; var u = look.u && look.u[id] !== undefined ? look.u[id] : k / Math.max(1, look.ids.length - 1); return LOOKS[look.name](id, k, look.ids.length, t, look.params, u); }
function update(prev, curr, init) {
  if (!started) started = curr;
  var dt = lastT ? Math.min(200, curr - lastT) : 10; lastT = curr;
  var a = TAU > 0 ? 1 - Math.exp(-dt / TAU) : 1;
  var mix = FADE > 0 ? Math.min(1, (curr - started) / FADE) : 1;
  var byId = {};
  for (var i = 0; i < prev.lights.length; i++) byId[prev.lights[i].id] = prev.lights[i].channels;
  var out = [];
  for (var j = 0; j < SMOOTH_IDS.length; j++) {
var id = SMOOTH_IDS[j], tgt = byId[id]; if (!tgt) continue;
var st = state[id]; if (!st) { st = state[id] = {}; for (var c in tgt) st[c] = tgt[c]; }
var e = mix >= 1 ? env(NEW, NEW_IDX, id, curr) : env(OLD, OLD_IDX, id, curr) * (1 - mix) + env(NEW, NEW_IDX, id, curr) * mix;
var ch = {};
for (var c2 in tgt) { st[c2] += (tgt[c2] - st[c2]) * a; var v = Math.round(st[c2] * e); ch[c2] = v < 0 ? 0 : (v > 255 ? 255 : v); }
out.push({ id: id, channels: ch });
  }
  return { lights: out };
}`;
}
function findEngine(scene) { return scene.find((d) => d.id !== 0 && (d.script || "").startsWith(ENGINE_TAG)) || null; }
async function uploadEngine() {
  if (Q.inflight) { Q.engineDirty = true; return; }
  Q.engineDirty = false; Q.inflight = true; const t = performance.now();
  try {
    const script = engineScript();
    if (S.engine) await api("PUT", "/v1/shader/" + S.engine.id, { script });
    else S.engine = await api("POST", "/v1/scene/shader", { type: "js", script, position: "bottom" });
    S.prevLook = JSON.parse(JSON.stringify(S.look));
    Q.lastLat = performance.now() - t;
  } catch (e) { setStatus("engine upload failed: " + e.message, "bad"); }
  Q.inflight = false; updateHealth(); refreshScene();
  if (Object.keys(Q.pending).length) scheduleFlush();
}

// ---------- connect ----------
async function connect() {
  LS.set("srv", $("srv").value); LS.set("tok", $("tok").value);
  setStatus("Connecting…");
  // local first: the plan, the map and the last known fixture list, so the plot works with the Pi down
  S.layout = cleanLayout((await loadData("layout")) || LS.get("layout2", null) || {});
  await loadMap();
  const setLights = (inv) => { S.lights = {}; (inv.lights || []).forEach((l) => { S.lights[l.id] = l; }); S.ids = Object.keys(S.lights).map(Number).sort((a, b) => a - b); };
  const showPlan = () => { if (!Object.keys(S.layout).length) S.layout = defaultLayout(); if (fillMissing()) saveLayout(); fitView(); updateSelInfo(); draw(); };
  const cached = await loadData("lights");            // last known fixture list: draw the plan right away
  if (cached) { setLights(cached); showPlan(); }
  await resolveServer();
  let lights, scene, room, offline = null;
  try { [lights, scene, room] = await Promise.all([api("GET", "/v1/lights"), api("GET", "/v1/scene"), api("GET", "/v1/shader/0")]); }
  catch (e) { offline = e; }
  if (lights) { setLights(lights); showPlan(); }
  if (offline) { setStatus("Pi unreachable (" + offline.message + "): layout only, no live colours. Is arclight.local on this network?", "bad"); return; }
  try {
    S.targets = {}; const tl = (room.template && room.template.lights) || {};
    for (const k in tl) S.targets[+k] = Object.assign({}, tl[k]);
    if (S.presets.every((p) => !p)) { const f = await loadData("presets"); if (Array.isArray(f)) { S.presets = f; LS.set("presets", f); renderPads(); } }
    if (!Object.keys(S.midimap).length) { const f = await loadData("midimap"); if (f && typeof f === "object") { S.midimap = f; LS.set("midimap", f); } }
    autosave();
    S.scene = scene; S.engine = findEngine(scene);
    if (S.engine) {
      const m = (S.engine.script || "").match(/^var NEW = (.*);$/m);
      if (m) { try { S.look = JSON.parse(m[1]); LS.set("look", S.look); } catch (e) { } }
      S.prevLook = JSON.parse(JSON.stringify(S.look));
      renderLook();
    } else { S.prevLook = null; await uploadEngine(); }
    openStream(); renderScene(); renderColour(); updateSelInfo(); draw();
    setStatus("Connected" + (S.via ? " via " + S.base.replace(/^https?:\/\//, "") : "") + " at " + new Date().toLocaleTimeString(), "ok");
  } catch (e) { setStatus(e.message + (S.via ? "" : " (is arclight.local resolving? try its IP in the server box)"), "bad"); }
}
function openStream() {
  if (S.ws) { S.ws.onclose = null; S.ws.close(); }
  const ws = new WebSocket(base().replace(/^http/, "ws") + "/v1/scene/ws?access_token=" + encodeURIComponent($("tok").value) + "&full=json");
  S.ws = ws;
  ws.onopen = () => { S.wsRetry = 0; if (/^stream/.test($("status").textContent)) setStatus("stream back", "ok"); };
  ws.onmessage = (ev) => {
    let o; try { o = JSON.parse(ev.data); } catch (e) { return; }
    (o.lights || []).forEach((l) => { S.frame[l.id] = l.channels; });
    S.fpsCount++; needDraw = true;
  };
  ws.onclose = () => {
    $("hFps").textContent = "–"; S.wsRetry = Math.min(5000, (S.wsRetry || 250) * 2);
    setStatus("stream closed; reconnecting in " + S.wsRetry / 1000 + " s", "warn");
    setTimeout(async () => { if (S.ws !== ws) return; await resolveServer(); openStream(); }, S.wsRetry);
  };
  ws.onerror = () => { };
}
setInterval(() => { S.fps = S.fpsCount; S.fpsCount = 0; updateHealth(); }, 1000);
setInterval(() => { if (S.ids.length && !Q.inflight) refreshScene(); }, 4000);
function updateHealth() {
  $("hFps").textContent = S.ws && S.ws.readyState === 1 ? S.fps : "–";
  $("hFps").className = S.fps < 15 && S.ws ? "warn" : "";
  $("hLat").textContent = Q.lastLat ? Math.round(Q.lastLat) : "–";
  $("hLat").className = Q.lastLat > 300 ? "warn" : "";
  $("hLayers").textContent = S.scene.length ? S.scene.length - 1 : "–";
  const e = S.engine && S.scene.find((d) => d.id === S.engine.id);
  $("hEngine").textContent = e ? e.state + (e.muted ? " (muted)" : "") : "none";
  $("hEngine").className = e && e.state === "running" && !e.muted ? "ok" : "bad";
}

// ---------- scene / layers ----------
async function refreshScene() {
  let sc; try { sc = await api("GET", "/v1/scene"); } catch (e) { return; }
  if (!Array.isArray(sc)) return;
  S.scene = sc;
  const eng = findEngine(S.scene);
  if (eng) S.engine = eng; else if (S.engine) { S.engine = null; }
  renderScene(); updateHealth();
}
function note(d) { const s = (d.script || "").split("\n"); for (let i = 0; i < Math.min(4, s.length); i++) { const t = s[i].trim(); if (t.startsWith("//")) return t.slice(2).trim(); } return s[0] ? s[0].slice(0, 60) : ""; }
function renderScene() {
  const box = $("layers"); box.innerHTML = "";
  const top = S.scene.length ? S.scene[S.scene.length - 1] : null;
  [...S.scene].reverse().forEach((d) => {
    const row = document.createElement("div"); if (d.muted) row.className = "muted";
    const isEngine = S.engine && d.id === S.engine.id;
    const label = d.id === 0 ? "roomtone (targets)" : isEngine ? "engine (ours)" : note(d);
    row.innerHTML = `<span style="width:22px;color:var(--mut)">${d.position}</span><span class="n" title="${esc(d.script || "")}">#${d.id} ${esc(label)}</span>`;
    if (d.id !== 0) {
      row.appendChild(btn(d.muted ? "unmute" : "mute", async () => { await api("POST", `/v1/shader/${d.id}/muted`, { muted: !d.muted }); refreshScene(); }));
      if (isEngine) { if (top && top.id !== d.id) row.appendChild(btn("to top", async () => { await api("POST", `/v1/shader/${d.id}/position`, { position: "bottom" }); refreshScene(); })); }
      else row.appendChild(btn("delete", async () => { await api("DELETE", `/v1/shader/${d.id}`); refreshScene(); }));
      if (d.state !== "running") { const s = document.createElement("span"); s.className = "bad"; s.textContent = d.state; row.appendChild(s); }
    }
    box.appendChild(row);
  });
  renderSolo();
  const e = S.engine && S.scene.find((d) => d.id === S.engine.id);
  $("engineInfo").textContent = !e ? "" : top && top.id !== e.id ? "engine is not on top: another layer is covering it (open layers)" : e.state !== "running" ? "engine " + e.state : "";
  $("layerCount").textContent = S.scene.length ? "(" + (S.scene.length - 1) + ")" : "";
}
function foreignLayers() { return S.scene.filter((d) => d.id !== 0 && !(S.engine && d.id === S.engine.id)); }
async function ownRoom() {
  const victims = foreignLayers().filter((d) => !d.muted);
  for (const d of victims) { try { await api("POST", `/v1/shader/${d.id}/muted`, { muted: true }); S.mutedByUs.push(d.id); } catch (e) { } }
  LS.set("mutedByUs", S.mutedByUs); refreshScene(); setStatus(`muted ${victims.length} layer(s)`, "ok");
}
async function releaseRoom() {
  const ids = [...new Set(S.mutedByUs)]; S.mutedByUs = []; LS.set("mutedByUs", []);
  for (const id of ids) { try { await api("POST", `/v1/shader/${id}/muted`, { muted: false }); } catch (e) { } }
  refreshScene(); setStatus(`unmuted ${ids.length} layer(s)`, "ok");
}
async function resetScene() {
  const victims = foreignLayers();
  for (const d of victims) { try { await api("DELETE", `/v1/shader/${d.id}`); } catch (e) { } }
  S.mutedByUs = []; LS.set("mutedByUs", []); refreshScene(); setStatus(`deleted ${victims.length} layer(s)`, "ok");
}
function blackout() {
  const map = {};
  S.ids.forEach((id) => { map[id] = {}; S.lights[id].channels.forEach((c) => { map[id][c.name] = 0; }); });
  queueTargets(map); ownRoom(); renderColour();
}

// ---------- saving into the repo (web/data/*.json via tools/serve.py) ----------
async function saveData(name, obj) { try { const r = await fetch("data/" + name + ".json", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) }); return r.ok; } catch (e) { return false; } }
async function loadData(name) { try { const r = await fetch("data/" + name + ".json", { cache: "no-store" }); return r.ok ? await r.json() : null; } catch (e) { return null; } }
let saveTimer = null;
function autosave() { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveAll(false), 800); }
async function saveAll(loud) {
  const ok = (await saveData("layout", Object.assign({ _frame: FP.ID }, S.layout))) && (await saveData("presets", S.presets)) && (await saveData("midimap", S.midimap));
  if (loud || !ok) setStatus(ok ? "saved to web/data/" : "not saved: run tools/serve.py (or use ⋯ export)", ok ? "ok" : "warn");
}
$("saveAll").onclick = () => saveAll(true);

// ---------- misc ----------
function btn(label, fn) { const b = document.createElement("button"); b.textContent = label; b.onclick = (ev) => { ev.stopPropagation(); fn().catch((e) => setStatus(e.message, "bad")); }; return b; }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); }
function download(name, obj) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" })); a.download = name; a.click(); }
function pickFile(cb) { const f = $("filePick"); f.onchange = () => { const r = new FileReader(); r.onload = () => { try { cb(JSON.parse(r.result)); } catch (e) { setStatus("bad json", "bad"); } }; r.readAsText(f.files[0]); f.value = ""; }; f.click(); }

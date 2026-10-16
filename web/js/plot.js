// arclight: the floor plan canvas (view, drawing, pointer handling), layout editing tools, selection and groups.
"use strict";

// ---------- floor plan (plain canvas), in the floor plan's units with a pan/zoom view ----------
const cv = $("cv"), ctx = cv.getContext("2d");
let needDraw = true, drag = null;
const FP = window.FLOORPLAN || { ID: "none", WIDTH: 1000, HEIGHT: 520, VIEW: { x: -20, y: -30, w: 1090, h: 700 }, ROOMS: [], COLUMNS: [], COLUMN_SIZE: 19, AREAS: [] };
let view = Object.assign({}, FP.VIEW);
const sx = () => cv.width / view.w;                                  // device px per floor unit
function toPx(p) { return [(p.x - view.x) * sx(), (p.y - view.y) * sx()]; }
function toUnits(px, py) { return { x: view.x + px / sx(), y: view.y + py / sx() }; }
function fitView() { const r = cv.width / Math.max(1, cv.height); let w = FP.VIEW.w, h = w / r; if (h < FP.VIEW.h) { h = FP.VIEW.h; w = h * r; } view = { x: FP.VIEW.x + (FP.VIEW.w - w) / 2, y: FP.VIEW.y + (FP.VIEW.h - h) / 2, w, h }; needDraw = true; }
function cleanLayout(L) { const out = {}; for (const k in L) if (!k.startsWith("_")) out[k] = L[k]; return out; }
function saveLayout() { LS.set("layout2", S.layout); }
async function loadMap() {
  const m = await loadData("map");
  S.map = m && Array.isArray(m.groups) ? m : { groups: [], unnumbered: [] };
  S.groupOf = {}; S.map.groups.forEach((g) => { g.ids.forEach((id) => { S.groupOf[id] = g; }); });
  renderGroups();
}
// "Kitchen 2" -> area Kitchen, sub 2; "Row 14C" -> area Row 14, sub C; anything else is its own area
function areaOf(name) { let m = name.match(/^(.*?\d+)([A-Z])$/); if (m) return [m[1], m[2]]; m = name.match(/^(.*\S)\s+(\d+)$/); if (m) return [m[1], m[2]]; return [name, ""]; }
function groupSelected(g) { return g.ids.length > 0 && g.ids.every((id) => S.selection.has(id)); }
function toggleGroups(groups) {
  const allOn = groups.every(groupSelected);
  groups.forEach((g) => g.ids.forEach((id) => { if (allOn) S.selection.delete(id); else S.selection.add(id); }));
  updateSelInfo(); needDraw = true;
}
function renderGroups() {
  const box = $("groupChips"); box.innerHTML = "";
  const groups = S.map.groups.filter((g) => g.ids.length), cand = groups.map((g) => areaOf(g.name));
  const count = {}; cand.forEach(([a]) => { count[a] = (count[a] || 0) + 1; });
  const areas = new Map();
  groups.forEach((g, i) => { const [area, sub] = count[cand[i][0]] > 1 ? cand[i] : [g.name, ""]; if (!areas.has(area)) areas.set(area, []); areas.get(area).push({ g, sub }); });
  for (const [area, items] of areas) {
    const row = document.createElement("div"); row.className = "area";
    const name = document.createElement("button"); name.className = "name"; name.textContent = area; name.title = "Toggle the whole area";
    name.onclick = () => toggleGroups(items.map((it) => it.g)); row.appendChild(name);
    items.forEach(({ g, sub }) => {
      const b = document.createElement("button"); b.className = "g" + (groupSelected(g) ? " on" : "");
      const boundKey = Object.keys(S.midimap).find((k) => S.midimap[k] === "group:" + g.name);
      if (boundKey) b.classList.add("bound");
      b.textContent = sub || "all"; b.title = g.name + ": " + g.ids.join(", ") + (boundKey ? "\nPlays from " + boundKey : "");
      b.onclick = () => { if (S.mapping) { mapClick("group:" + g.name, b); return; } toggleGroups([g]); }; row.appendChild(b);
    });
    box.appendChild(row);
  }
}
$("fitView").onclick = fitView;
function resize() {
  const w = cv.clientWidth || 800, h = cv.clientHeight || 520, W = Math.round(w * devicePixelRatio), H = Math.round(h * devicePixelRatio);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; view.h = view.w / (W / Math.max(1, H)); }
  needDraw = true;
}
window.addEventListener("resize", resize);
new ResizeObserver(resize).observe(cv);
function defaultLayout() {
  const L = {}, by = (t) => S.ids.filter((id) => S.lights[id].type === t);
  const bulbs = by("br30"), fours = by("4x1"), relays = by("relay");
  bulbs.forEach((id, i) => { L[id] = { x: 30 + 940 * i / Math.max(1, bulbs.length - 1), y: 570 }; });
  fours.forEach((id, i) => { L[id] = { x: 200 + 600 * i / Math.max(1, fours.length - 1), y: 620 }; });
  relays.forEach((id, i) => { L[id] = { x: 60 + 880 * (i % 13) / 12, y: 670 + 45 * Math.floor(i / 13) }; });
  let k = 0; S.ids.forEach((id) => { if (!L[id]) L[id] = { x: 50 + 40 * k++, y: 870 }; });
  return L;
}
// lights the mapping doesn't place (e.g. 56-115 before they're mapped) get a slot in the strip below the building
function fillMissing() { const d = defaultLayout(); let added = false; for (const id of S.ids) if (!S.layout[id]) { S.layout[id] = d[id]; added = true; } return added; }
function lightRGB(ch) {
  const g = (n) => ch[n] || 0;
  let R = g("red"), G = g("green"), B = g("blue");
  const cold = g("cold"), warm = g("warm"), br = g("brightness");
  R += br; G += br; B += br;
  if (cold) { R += cold; G += cold * 0.94; B += cold * 0.86; }
  if (warm) { R += warm; G += warm * 0.72; B += warm * 0.36; }
  return [Math.min(255, R | 0), Math.min(255, G | 0), Math.min(255, B | 0)];
}
function lightColor(ch) { const [r, g, b] = lightRGB(ch); return `rgb(${r},${g},${b})`; }
function pos(id) { return toPx(S.layout[id] || { x: 500, y: 870 }); }
function radius(id) { const dpr = devicePixelRatio, base = S.lights[id] && S.lights[id].type === "relay" ? 8 : 13; return Math.max(5 * dpr, Math.min(18 * dpr, base * sx())); }
function drawFloor() {
  const s = sx(), dpr = devicePixelRatio;
  ctx.fillStyle = "#191722"; ctx.fillRect(0, 0, cv.width, cv.height);
  for (const r of FP.ROOMS) { const [x, y] = toPx(r); ctx.fillStyle = r.kind === "core" ? "#242131" : "#1F1C2A"; ctx.fillRect(x, y, r.w * s, r.h * s); ctx.strokeStyle = "#39354A"; ctx.lineWidth = dpr; ctx.strokeRect(x, y, r.w * s, r.h * s); }
  const [ox, oy] = toPx({ x: 0, y: 0 }), W = FP.WIDTH * s, H = FP.HEIGHT * s;
  ctx.strokeStyle = "#7d8396"; ctx.lineWidth = Math.max(1.5 * dpr, 3 * s); ctx.strokeRect(ox, oy, W, H);
  ctx.strokeStyle = "#3f7fc2"; ctx.setLineDash([10 * s, 6 * s]); ctx.beginPath(); ctx.moveTo(ox, oy + H); ctx.lineTo(ox + W, oy + H); ctx.moveTo(ox, oy); ctx.lineTo(ox, oy + H); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = "#4f5569"; for (const c of FP.COLUMNS) { const [x, y] = toPx(c); const h = FP.COLUMN_SIZE * s / 2; ctx.fillRect(x - h, y - h, 2 * h, 2 * h); }
  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  ctx.font = `700 ${11 * dpr}px ui-rounded, system-ui, sans-serif`; ctx.fillStyle = "#6E6885";
  for (const r of FP.ROOMS) { if (!r.name) continue; const [x, y] = toPx({ x: r.x + r.w / 2, y: r.y + 16 }); ctx.fillText(r.name, x, y); }
  ctx.font = `italic 700 ${12 * dpr}px ui-rounded, system-ui, sans-serif`; ctx.fillStyle = "#4F4A63";
  for (const a of FP.AREAS) { const [x, y] = toPx(a); ctx.fillText(a.name, x, y); }
  ctx.setLineDash([4 * dpr, 3 * dpr]); ctx.lineWidth = 1.5 * dpr;
  for (const u of S.map.unnumbered || []) { const g = S.map.groups.find((gg) => gg.name === u.group); const [x, y] = toPx(u); ctx.beginPath(); ctx.arc(x, y, Math.max(4 * dpr, 10 * s), 0, Math.PI * 2); ctx.strokeStyle = g ? g.color : "#555"; ctx.stroke(); }
  ctx.setLineDash([]);
  for (const g of S.map.groups) {
    if (g.ids.length < 2 || !groupSelected(g)) continue;
    ctx.strokeStyle = g.color; ctx.globalAlpha = 0.45; ctx.lineWidth = Math.max(1.5 * dpr, 3 * s); ctx.lineJoin = "round"; ctx.beginPath();
    g.ids.forEach((id, i) => { const [x, y] = pos(id); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke(); ctx.globalAlpha = 1;
  }
}
// what colour a dot shows: the live frame if the stream is up, else the last known target, dimmed, else off
function dotRGB(id) {
  if (S.ws && S.ws.readyState === 1 && S.frame[id]) return [lightRGB(S.frame[id]), true];
  if (S.targets[id]) { const c = lightRGB(S.targets[id]); return [[c[0] * 0.45 | 0, c[1] * 0.45 | 0, c[2] * 0.45 | 0], false]; }
  return [[42, 39, 51], false];
}
function draw() {
  needDraw = false;
  const dpr = devicePixelRatio;
  drawFloor();
  ctx.textAlign = "center";
  for (const id of plotted()) {
    const [x, y] = pos(id), r = radius(id), g = S.groupOf[id];
    const [rgb, live] = dotRGB(id), lum = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
    const fill = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    if (live && lum > 40) { ctx.shadowColor = fill; ctx.shadowBlur = r * 1.3; }
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
    ctx.shadowBlur = 0; ctx.shadowColor = "transparent";
    const gOn = g && groupSelected(g);
    ctx.lineWidth = (gOn ? 2.5 : 1.5) * dpr; ctx.strokeStyle = gOn ? g.color : "rgba(255,255,255,.14)"; ctx.stroke();
    if (S.selection.has(id)) { ctx.beginPath(); ctx.arc(x, y, r + 3.5 * dpr, 0, Math.PI * 2); ctx.lineWidth = 2.5 * dpr; ctx.strokeStyle = "#ffffff"; ctx.stroke(); }
    if (r >= 8 * dpr) {
      ctx.font = `800 ${Math.round(r * 0.95)}px ${"ui-rounded, system-ui, sans-serif"}`; ctx.textBaseline = "middle";
      ctx.fillStyle = lum > 120 ? "rgba(20,18,26,.9)" : "rgba(240,238,245,.9)"; ctx.fillText(id, x, y + 0.5 * dpr); ctx.textBaseline = "alphabetic";
    } else if (S.editLayout || S.selection.has(id)) { ctx.font = `${9 * dpr}px ui-rounded, system-ui, sans-serif`; ctx.fillStyle = "#8a93a3"; ctx.fillText(id, x, y + r + 10 * dpr); }
  }
  if (drag && drag.box) {
    const bx = Math.min(drag.x0, drag.x1), by = Math.min(drag.y0, drag.y1), bw = Math.abs(drag.x1 - drag.x0), bh = Math.abs(drag.y1 - drag.y0);
    ctx.fillStyle = "rgba(255,255,255,.08)"; ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 1.5 * dpr; ctx.setLineDash([6 * dpr, 4 * dpr]); ctx.strokeRect(bx, by, bw, bh); ctx.setLineDash([]);
  }
}
(function loop() { if (needDraw && S.ids.length) draw(); requestAnimationFrame(loop); })();
function canvasXY(ev) { const r = cv.getBoundingClientRect(); return [(ev.clientX - r.left) * cv.width / r.width, (ev.clientY - r.top) * cv.height / r.height]; }
function hit(x, y) { let best = null, bd = 1e9; for (const id of plotted()) { const [px, py] = pos(id); const d = Math.hypot(px - x, py - y); if (d < radius(id) + 4 * devicePixelRatio && d < bd) { best = id; bd = d; } } return best; }
cv.addEventListener("wheel", (ev) => {
  ev.preventDefault();
  const [px, py] = canvasXY(ev);
  if (ev.ctrlKey || ev.metaKey) {
    const a = toUnits(px, py), w = Math.min(Math.max(view.w * Math.exp(ev.deltaY * 0.004), 120), FP.VIEW.w * 4), h = w * cv.height / cv.width;
    view = { x: a.x - px / cv.width * w, y: a.y - py / cv.height * h, w, h };
  } else { const s = view.w / cv.width; view.x += ev.deltaX * devicePixelRatio * s; view.y += ev.deltaY * devicePixelRatio * s; }
  needDraw = true;
}, { passive: false });
cv.addEventListener("pointerdown", (ev) => {
  if (!S.ids.length) return; cv.setPointerCapture(ev.pointerId);
  const [x, y] = canvasXY(ev), id = hit(x, y);
  if (ev.button === 1) { drag = { pan: true, x, y, view0: Object.assign({}, view) }; ev.preventDefault(); return; }
  if (S.editLayout && id !== null) {
    if (!S.selection.has(id)) { if (!ev.shiftKey) S.selection.clear(); S.selection.add(id); updateSelInfo(); }
    drag = { move: id, ids: [...S.selection], lastX: x, lastY: y, moved: false, snap: JSON.stringify(S.layout) }; needDraw = true; return;
  }
  if (id !== null) { if (!ev.shiftKey) S.selection.clear(); if (S.selection.has(id) && ev.shiftKey) S.selection.delete(id); else S.selection.add(id); drag = { clickOnly: true }; }
  else drag = { box: true, x0: x, y0: y, x1: x, y1: y, add: ev.shiftKey };
  updateSelInfo(); needDraw = true;
});
cv.addEventListener("pointermove", (ev) => {
  if (!drag) return; const [x, y] = canvasXY(ev);
  if (drag.pan) { const s = drag.view0.w / cv.width; view = Object.assign({}, drag.view0, { x: drag.view0.x - (x - drag.x) * s, y: drag.view0.y - (y - drag.y) * s }); needDraw = true; return; }
  if (drag.move) {
    const dx = (x - drag.lastX) / sx(), dy = (y - drag.lastY) / sx(); drag.lastX = x; drag.lastY = y;
    if (dx || dy) drag.moved = true;
    for (const id of drag.ids) { const q = S.layout[id] || toUnits(x, y); S.layout[id] = { x: Math.round((q.x + dx) * 10) / 10, y: Math.round((q.y + dy) * 10) / 10 }; }
    needDraw = true;
  }
  else if (drag.box) { drag.x1 = x; drag.y1 = y; needDraw = true; }
});
cv.addEventListener("pointerup", () => {
  if (!drag) return;
  if (drag.pan) { drag = null; return; }
  if (drag.move && drag.moved) { layoutUndo = drag.snap; saveLayout(); autosave(); reflowLook(); }
  else if (drag.box) {
    const x0 = Math.min(drag.x0, drag.x1), x1 = Math.max(drag.x0, drag.x1), y0 = Math.min(drag.y0, drag.y1), y1 = Math.max(drag.y0, drag.y1);
    if (!drag.add) S.selection.clear();
    if (x1 - x0 > 3 || y1 - y0 > 3) for (const id of plotted()) { const [px, py] = pos(id); if (px >= x0 && px <= x1 && py >= y0 && py <= y1) S.selection.add(id); }
  }
  drag = null; updateSelInfo(); needDraw = true;
});

// ---------- layout operations (pure: take a layout, return a new one) ----------
function alignLayout(L, ids, axis) { const m = ids.reduce((a, id) => a + L[id][axis], 0) / ids.length; const out = Object.assign({}, L); ids.forEach((id) => { out[id] = Object.assign({}, L[id], { [axis]: m }); }); return out; }
function spreadLayout(L, ids, axis) { const s = [...ids].sort((a, b) => L[a][axis] - L[b][axis]); const lo = L[s[0]][axis], hi = L[s[s.length - 1]][axis]; const out = Object.assign({}, L); s.forEach((id, i) => { out[id] = Object.assign({}, L[id], { [axis]: s.length > 1 ? lo + (hi - lo) * i / (s.length - 1) : lo }); }); return out; }
function tidyLayout(L, ids, tolX, tolY) {
  const out = Object.assign({}, L); ids.forEach((id) => { out[id] = Object.assign({}, L[id]); });
  for (const [axis, tol] of [["x", tolX], ["y", tolY]]) {
    const s = [...ids].sort((a, b) => out[a][axis] - out[b][axis]);
    let cluster = [];
    const flush = () => { if (cluster.length) { const m = cluster.reduce((a, id) => a + out[id][axis], 0) / cluster.length; cluster.forEach((id) => { out[id][axis] = m; }); } cluster = []; };
    s.forEach((id) => { if (cluster.length && out[id][axis] - out[cluster[cluster.length - 1]][axis] > tol) flush(); cluster.push(id); });
    flush();
  }
  return out;
}
let layoutUndo = null;
function layoutOp(fn) {
  const snap = JSON.stringify(S.layout); const next = fn(); if (!next) return;
  layoutUndo = snap; S.layout = next; saveLayout(); autosave(); reflowLook(); needDraw = true;
}
function reflowLook() { if (S.look.ids.length && (S.look.name === "chase" || S.look.name === "wave")) { setLookIds(S.look.ids); requestEngine(); } }
function editSel(min) { const p = new Set(plotted()); const sel = [...S.selection].filter((id) => p.has(id)); if (sel.length < min) { setStatus(`select at least ${min} dots first`, "warn"); return null; } return sel; }
$("alignY").onclick = () => layoutOp(() => { const ids = editSel(2); return ids && alignLayout(S.layout, ids, "y"); });
$("alignX").onclick = () => layoutOp(() => { const ids = editSel(2); return ids && alignLayout(S.layout, ids, "x"); });
$("spreadX").onclick = () => layoutOp(() => { const ids = editSel(3); return ids && spreadLayout(S.layout, ids, "x"); });
$("spreadY").onclick = () => layoutOp(() => { const ids = editSel(3); return ids && spreadLayout(S.layout, ids, "y"); });
$("tidy").onclick = () => layoutOp(() => { const p = new Set(plotted()); const sel = [...S.selection].filter((id) => p.has(id)); const ids = sel.length >= 2 ? sel : plotted(); const tol = 14 * devicePixelRatio / sx(); return tidyLayout(S.layout, ids, tol, tol); });
$("layoutUndoBtn").onclick = () => { if (!layoutUndo) { setStatus("nothing to undo", "warn"); return; } const cur = JSON.stringify(S.layout); S.layout = JSON.parse(layoutUndo); layoutUndo = cur; saveLayout(); autosave(); reflowLook(); needDraw = true; };

function select(pred) { S.selection = new Set(S.ids.filter(pred)); updateSelInfo(); needDraw = true; }
$("selAll").onclick = () => { const p = new Set(plotted()); select((id) => p.has(id)); };
$("sel4x1").onclick = () => select((id) => S.lights[id].type === "4x1");
$("selRelays").onclick = () => select((id) => S.lights[id].type === "relay");
$("selNone").onclick = () => select(() => false);
$("selInv").onclick = () => { const old = S.selection, p = new Set(plotted()); select((id) => p.has(id) && !old.has(id)); };
$("showOthers").onclick = () => { S.showOthers = !S.showOthers; LS.set("showOthers", S.showOthers); $("showOthers").classList.toggle("on", S.showOthers); document.body.classList.toggle("show-others", S.showOthers); needDraw = true; };
$("layoutMore").onclick = () => { $("layoutMenu").hidden = !$("layoutMenu").hidden; };
$("editLayout").onclick = () => { S.editLayout = !S.editLayout; $("editLayout").classList.toggle("on", S.editLayout); cv.classList.toggle("edit", S.editLayout); document.body.classList.toggle("editing", S.editLayout); needDraw = true; };
$("exportLayout").onclick = () => download("arclight-layout.json", Object.assign({ _frame: FP.ID }, S.layout));
$("importLayout").onclick = () => pickFile((o) => { S.layout = cleanLayout(o); fillMissing(); saveLayout(); autosave(); fitView(); });
function updateSelInfo() {
  const sel = [...S.selection];
  $("selInfo").textContent = sel.length ? sel.length + " selected" : "";
  document.body.classList.toggle("relays-selected", sel.some((id) => S.lights[id] && S.lights[id].type === "relay"));
  renderGroups(); renderColour();
}

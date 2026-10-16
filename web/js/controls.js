// arclight: the side panel controls (colour, looks, presets, MIDI) and page init. Loaded last.
"use strict";

// ---------- colour of selection -> targets (roomtone) ----------
const colourSliders = {};
function renderColour() {
  const box = $("colour");
  const sel = [...S.selection].filter((id) => S.lights[id] && S.lights[id].type !== "relay");
  $("colInfo").textContent = sel.length ? `${sel.length} colour light(s)` : "select some bulbs";
  if (!box.children.length) {
    COLOUR_CHANS.concat(["intensity"]).forEach((c) => {
      const row = document.createElement("div"); row.className = "slider";
      const isI = c === "intensity";
      row.innerHTML = `<label>${c}</label><input type="range" min="0" max="${isI ? 100 : 255}" value="${isI ? 100 : 0}"><span class="v">${isI ? 100 : 0}</span><button class="learn" data-learn="col:${c}">midi</button>`;
      const inp = row.querySelector("input"), v = row.querySelector(".v");
      colourSliders[c] = inp;
      inp.addEventListener("input", () => { v.textContent = inp.value; if (isI) S.intensity = inp.value / 100; writeColour(); });
      box.appendChild(row);
    });
    bindLearnButtons(box);
  }
  if (sel.length) { // seed sliders from the first selected light's target (not an input event)
    const t = S.base[sel[0]] || S.targets[sel[0]] || {};
    COLOUR_CHANS.forEach((c) => { if (t[c] !== undefined) { colourSliders[c].value = Math.round(t[c] / (S.intensity || 1)); colourSliders[c].nextElementSibling.textContent = colourSliders[c].value; } });
  }
}
function writeColour() {
  const map = {};
  for (const id of S.selection) {
    const l = S.lights[id]; if (!l || l.type === "relay") continue;
    const have = new Set(l.channels.map((c) => c.name)); map[id] = {};
    COLOUR_CHANS.forEach((c) => { if (have.has(c)) map[id][c] = Math.round(colourSliders[c].value * S.intensity); });
  }
  if (Object.keys(map).length) setBase(map);
}
function writeRelays(on) {
  const map = {};
  for (const id of S.selection) if (S.lights[id] && S.lights[id].type === "relay") map[id] = { brightness: on ? 255 : 0 };
  if (!Object.keys(map).length) { setStatus("no relays selected", "warn"); return; }
  setBase(map);
}
$("relayOn").onclick = () => writeRelays(true);
$("relayOff").onclick = () => writeRelays(false);

// ---------- look UI ----------
function renderLook() {
  const sel = $("look");
  if (!sel.children.length) {
    const add = (label, names) => { if (!names.length) return; const og = document.createElement("optgroup"); og.label = label; names.forEach((n) => { const o = document.createElement("option"); o.value = n; o.textContent = n; og.appendChild(o); }); sel.appendChild(og); };
    add("on the Pi", Object.keys(LOOK_PARAMS).filter((n) => !LIVE[n])); add("live, from this page", Object.keys(LIVE));
  }
  sel.value = S.look.name;
  $("lookInfo").textContent = LIVE[S.look.name] ? "live: keep this page open" : "";
  const os = $("order");
  if (!os.children.length) Object.keys(ORDERS).forEach((k) => { const o = document.createElement("option"); o.value = k; o.textContent = ORDERS[k]; os.appendChild(o); });
  os.value = S.look.order || "rows"; os.hidden = !(S.look.name === "chase" || S.look.name === "wave");
  const box = $("params"); box.innerHTML = "";
  for (const k in LOOK_PARAMS[S.look.name]) {
    const [mn, mx, df, unit] = LOOK_PARAMS[S.look.name][k];
    if (S.look.params[k] === undefined) S.look.params[k] = df;
    const row = document.createElement("div"); row.className = "slider";
    const step = mx - mn <= 1 ? 0.01 : (mx - mn <= 30 ? 0.1 : 1);
    row.innerHTML = `<label>${k}</label><input type="range" min="${mn}" max="${mx}" step="${step}" value="${S.look.params[k]}"><span class="v">${S.look.params[k]}${unit}</span><button class="learn" data-learn="param:${k}">midi</button>`;
    const inp = row.querySelector("input"), v = row.querySelector(".v");
    inp.addEventListener("input", () => { S.look.params[k] = +inp.value; v.textContent = inp.value + unit; requestEngine(); });
    box.appendChild(row);
  }
  bindLearnButtons(box);
  $("fade").value = S.fade; $("fadeV").textContent = S.fade; $("tau").value = S.tau; $("tauV").textContent = S.tau;
}
$("look").onchange = () => { S.look.name = $("look").value; S.look.params = defaultParams(S.look.name); setLookIds(S.look.ids.length ? S.look.ids : S.ids.filter((id) => S.lights[id].type === "br30")); renderLook(); requestEngine(); };
$("order").onchange = () => { S.look.order = $("order").value; setLookIds(S.look.ids); requestEngine(); };
$("applyLook").onclick = () => { const ids = [...S.selection].filter((id) => S.lights[id].type !== "relay"); if (!ids.length) { setStatus("select some bulbs first", "warn"); return; } setLookIds(ids); requestEngine(); setStatus(`look ${S.look.name} on ${ids.length} light(s)`, "ok"); };
$("lookAll").onclick = () => { setLookIds(S.ids.filter((id) => S.lights[id].type === "br30")); requestEngine(); };
$("fade").addEventListener("input", () => { S.fade = +$("fade").value; $("fadeV").textContent = S.fade; requestEngine(); });
$("tau").addEventListener("input", () => { S.tau = +$("tau").value; $("tauV").textContent = S.tau; requestEngine(); });

// ---------- presets ----------
function renderPads() {
  const box = $("pads"); box.innerHTML = "";
  S.presets.forEach((p, i) => {
    const b = document.createElement("button"); b.textContent = (i + 1) + (p ? " " + (p.look.name) : " –"); if (p) b.className = "full";
    const key = keysFor("preset:" + i)[0]; if (key) b.classList.add("bound");
    b.title = (p ? `look ${p.look.name}, saved ${p.at}` : "empty") + (key ? "\nRecalled by " + key : "");
    b.onclick = (ev) => { if (S.mapping) { mapClick("preset:" + i, b); return; } if (ev.shiftKey) savePreset(i); else recallPreset(i); LS.set("presets", S.presets); renderPads(); };
    b.oncontextmenu = (ev) => { ev.preventDefault(); S.presets[i] = null; if (keysFor("preset:" + i).length) unbind("preset:" + i); LS.set("presets", S.presets); autosave(); renderPads(); };
    box.appendChild(b);
  });
}
function savePreset(i) {
  S.presets[i] = { at: new Date().toLocaleString(), targets: copyCh(S.base), look: JSON.parse(JSON.stringify(S.look)), tau: S.tau, fade: S.fade };
  LS.set("presets", S.presets); autosave(); renderPads(); setStatus("saved preset " + (i + 1), "ok");
}
function recallPreset(i) {
  const p = S.presets[i]; if (!p) return;
  const map = {}; for (const k in p.targets) map[+k] = p.targets[k];
  setBase(map);
  S.look = JSON.parse(JSON.stringify(p.look)); S.tau = p.tau; S.fade = p.fade; renderLook(); requestEngine(); renderColour();
  setStatus("recalled preset " + (i + 1), "ok");
}

// ---------- MIDI ----------
function arm(target, btnEl) {
  document.querySelectorAll(".armed").forEach((b) => b.classList.remove("armed"));
  if (S.learn === target) { S.learn = null; setStatus("", ""); return; }
  S.learn = target; if (btnEl) btnEl.classList.add("armed");
  setStatus("Move a knob or hit a pad to bind " + target, "warn");
}
function keysFor(target) { return Object.keys(S.midimap).filter((k) => S.midimap[k] === target); }
function unbind(target) {
  keysFor(target).forEach((k) => { delete S.midimap[k]; });
  LS.set("midimap", S.midimap); autosave(); if (S.learn === target) S.learn = null;
  document.querySelectorAll(".learn").forEach(markBound); renderGroups(); renderPads(); setStatus("Unbound " + target, "ok");
}
function bindLearnButtons(root) {
  root.querySelectorAll(".learn").forEach((b) => {
    b.onclick = (ev) => { ev.stopPropagation(); ev.preventDefault(); mapClick(b.dataset.learn, b); };
    markBound(b);
  });
}
function markBound(b) {
  const key = keysFor(b.dataset.learn)[0];
  b.classList.toggle("bound", !!key); b.title = key ? "Bound to " + key + ". Click to unbind." : "Click, then move a knob or hit a pad";
  b.textContent = key ? key.split(":").slice(0, 1) + key.split(":")[2] : "midi";
}
async function toggleMidi() {
  if (S.midiAccess) {                                   // disable: stop listening, leave map mode
    S.midiAccess.inputs.forEach((inp) => { inp.onmidimessage = null; }); S.midiAccess.onstatechange = null; S.midiAccess = null;
    setMapping(false); document.body.classList.remove("midi-on"); $("midiEnable").textContent = "Enable"; $("midiEnable").classList.remove("on"); $("midiInfo").textContent = "";
    return;
  }
  if (!navigator.requestMIDIAccess) { $("midiInfo").textContent = "No Web MIDI here: use Chrome, served from localhost"; return; }
  try {
    const acc = await navigator.requestMIDIAccess(); S.midiAccess = acc;
    const hook = () => { let n = 0; acc.inputs.forEach((inp) => { inp.onmidimessage = onMidi; n++; }); $("midiInfo").textContent = n + " input" + (n === 1 ? "" : "s"); };
    hook(); acc.onstatechange = hook; $("midiEnable").textContent = "Disable"; $("midiEnable").classList.add("on"); document.body.classList.add("midi-on");
  } catch (e) { $("midiInfo").textContent = "Denied: " + e.message; }
}
function setMapping(on) {
  S.mapping = on; document.body.classList.toggle("mapping", on);
  $("midiMap").classList.toggle("on", on); $("midiMap").textContent = on ? "Done" : "Map";
  if (!on) { S.learn = null; document.querySelectorAll(".armed").forEach((b) => b.classList.remove("armed")); }
  renderGroups(); renderPads();
}
// in map mode a click arms an unbound control and unbinds a bound one
function mapClick(target, el) { if (keysFor(target).length) unbind(target); else arm(target, el); }
$("midiMap").onclick = () => setMapping(!S.mapping);
const noteState = {};
function onMidi(ev) {
  const [st, d1, d2] = ev.data, type = st & 0xf0, ch = st & 0x0f;
  let key, val, isTrigger = false, isNote = false, release = false;
  if (type === 0xB0) { key = `cc:${ch}:${d1}`; val = d2 / 127; }
  else if (type === 0x90 && d2 > 0) { key = `note:${ch}:${d1}`; val = d2 / 127; isTrigger = true; isNote = true; }   // note on: level = velocity
  else if (type === 0x80 || (type === 0x90 && d2 === 0)) { key = `note:${ch}:${d1}`; val = 0; isNote = true; release = true; }  // note off: level 0
  else return;
  IN.midi[isNote ? "note" : "cc"][ch + ":" + d1] = val;                 // the input bus sees every cc and note, bound or not
  if (!release) $("midiLast").textContent = key + " " + d2;
  if (S.learn) { if (release) return; keysFor(S.learn).forEach((k) => { delete S.midimap[k]; }); S.midimap[key] = S.learn; LS.set("midimap", S.midimap); autosave(); S.learn = null; document.querySelectorAll(".learn").forEach(markBound); renderPads(); renderGroups(); setStatus("bound " + key, "ok"); return; }
  const target = S.midimap[key]; if (!target) return;
  if (!isNote) { const was = noteState[key] || 0; noteState[key] = val; isTrigger = val > 0.5 && was <= 0.5; }
  applyControl(target, val, isTrigger, release);
}
function applyControl(target, val, trig, release) {
  const [kind, name] = target.split(":");
  const continuous = kind === "col" || kind === "param" || kind === "fade" || kind === "tau" || kind === "group";
  if (release && !continuous) return;   // letting go of a pad never fires an action
  const setRange = (inp, v) => { inp.value = +inp.min + (+inp.max - +inp.min) * v; inp.dispatchEvent(new Event("input")); };
  if (kind === "group") { playGroup(name, val); }
  else if (kind === "col") { if (colourSliders[name]) setRange(colourSliders[name], val); }
  else if (kind === "param") { const inp = [...$("params").querySelectorAll("input")].find((i) => i.parentNode.querySelector("label").textContent === name); if (inp) setRange(inp, val); }
  else if (kind === "fade") setRange($("fade"), val);
  else if (kind === "tau") setRange($("tau"), val);
  else if (kind === "look") { const names = Object.keys(LOOK_PARAMS); const n = trig ? names[(names.indexOf(S.look.name) + 1) % names.length] : names[Math.min(names.length - 1, Math.floor(val * names.length))]; if (n !== S.look.name) { $("look").value = n; $("look").onchange(); } }
  else if (kind === "preset") { if (trig) recallPreset(+name); }
  else if (kind === "own" || kind === "solo") { if (trig) toggleSolo(); }
  else if (kind === "blackout") { if (trig) blackout(); }
}
function playGroup(name, level) {
  const g = S.map.groups.find((x) => x.name === name); if (!g) return;
  const base = {}; COLOUR_CHANS.forEach((c) => { base[c] = colourSliders[c] ? +colourSliders[c].value : 0; });
  if (!Object.values(base).some((v) => v > 0)) { base.cold = 255; base.warm = 255; }
  const map = {};
  g.ids.forEach((id) => {
    const l = S.lights[id]; if (!l) return; const v = {};
    l.channels.forEach((c) => { v[c.name] = c.name === "brightness" ? (level > 0 ? 255 : 0) : Math.round((base[c.name] || 0) * level); });
    map[id] = v;
  });
  setBase(map);
}
$("midiEnable").onclick = toggleMidi;
$("clearMidi").onclick = () => { S.midimap = {}; LS.set("midimap", {}); autosave(); document.querySelectorAll(".learn").forEach(markBound); };

// ---------- room buttons (two-click confirm for destructive ones) ----------
function twoClick(el, fn) { let armed = null; el.onclick = () => { if (armed) { clearTimeout(armed); armed = null; el.classList.remove("confirm"); fn(); } else { el.classList.add("confirm"); armed = setTimeout(() => { armed = null; el.classList.remove("confirm"); }, 3000); } }; }
async function toggleSolo() {
  if (S.soloBusy) return; S.soloBusy = true; renderSolo();
  try { if (S.mutedByUs.length) await releaseRoom(); else await ownRoom(); }
  finally { S.soloBusy = false; renderSolo(); }
}
function renderSolo() {
  const others = foreignLayers().length, held = S.mutedByUs.length > 0;
  $("solo").classList.toggle("on", held); $("solo").disabled = S.soloBusy || (!others && !held);
  $("solo").title = held ? "Click to unmute the other layers" : others ? `Mute the ${others} other layer(s) so only yours show` : "No other layers are running";
}
$("solo").onclick = toggleSolo;
twoClick($("blackout"), blackout);
twoClick($("resetScene"), resetScene);

// ---------- init ----------
(function init() {
  const q = new URLSearchParams(location.search);
  $("srv").value = q.get("server") || LS.get("srv", null) || "http://arclight.local:8080";
  $("tok").value = q.get("token") || LS.get("tok", "");
  $("connect").onclick = connect;
  resize(); renderLook(); renderPads(); renderColour(); renderSolo(); $("showOthers").classList.toggle("on", S.showOthers); document.body.classList.toggle("show-others", S.showOthers);
  bindLearnButtons(document.querySelector("aside"));
  if ($("tok").value) connect();
})();

// Every source writes normalised values into IN and live looks (js/live.js) read them,
//   IN.pointer   the mouse over the plan, in floor units               written here
//   IN.midi      cc and note levels 0..1 by "channel:number"           written by onMidi in controls.js
//   IN.people    tracked people [{x, y}] in floor units                 for a camera provider (not written yet)
//   IN.audio     level, bass, mid, high, onset 0..1                     for a microphone provider (not written yet)
"use strict";
const IN = {
  t: 0,
  pointer: { x: 0, y: 0, over: false, down: false },
  midi: { cc: {}, note: {} },
  people: [],
  audio: { level: 0, bass: 0, mid: 0, high: 0, onset: 0 },
};
// the point a look should follow: a tracked person if there is one, else the mouse while it is over the plan
function inputPoint() { return IN.people[0] || (IN.pointer.over ? IN.pointer : null); }
cv.addEventListener("pointermove", (ev) => {
  const [x, y] = canvasXY(ev), u = toUnits(x, y);
  IN.pointer.x = u.x; IN.pointer.y = u.y; IN.pointer.over = true; IN.pointer.down = ev.buttons > 0;
});
cv.addEventListener("pointerleave", () => { IN.pointer.over = false; });

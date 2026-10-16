// Floor plan of the Recurse space. Geometry by Aaron, from recurseLightMap/src/floorplan.js
// (https://github.com/aaronw122/recurseLightMap), hand-traced from the Exit Stair A egress sign
// and stretched taller so the lights have room. Units: the building is 1000 x 520, x along the
// long axis; Exit Stair A on the top wall, windows along the bottom and left walls, fire escape
// outside the bottom-right corner. All light positions in web/data/ use these units.
window.FLOORPLAN = {
  ID: "recurse-floor-v1",
  WIDTH: 1000,
  HEIGHT: 520,
  VIEW: { x: -20, y: -30, w: 1090, h: 580 },
  // kind: "room" = named space with lights, "core" = stairs / elevators / services.
  ROOMS: [
    { name: "Turing", kind: "room", x: 0, y: 0, w: 120, h: 266 },
    { name: "Hopper", kind: "room", x: 0, y: 266, w: 140, h: 254 },
    { name: "Sammet", kind: "room", x: 141, y: 386, w: 151, h: 134 },
    { name: "", kind: "room", x: 253, y: 208, w: 87, h: 172 },
    { name: "Elevators", kind: "core", x: 122, y: 8, w: 150, h: 65 },
    { name: "Stair A", kind: "core", x: 311, y: 7, w: 123, h: 65 },
    { name: "Janitor", kind: "core", x: 400, y: 78, w: 110, h: 112 },
    { name: "WC", kind: "core", x: 517, y: 7, w: 100, h: 183 },
    { name: "WC", kind: "core", x: 617, y: 7, w: 100, h: 183 },
    { name: "", kind: "core", x: 717, y: 7, w: 28, h: 183 },
    { name: "Couches", kind: "room", x: 790, y: 266, w: 195, h: 241 },
    { name: "Fire esc.", kind: "core", x: 985, y: 393, w: 57, h: 127 },
  ],
  // Structural columns (centres), on the Row 14 line between its light groups.
  COLUMNS: [{ x: 480, y: 227.5 }, { x: 655, y: 227.5 }, { x: 820, y: 227.5 }],
  COLUMN_SIZE: 19,
  AREAS: [{ name: "Elevator lobby", x: 283, y: 146 }, { name: "Main area", x: 600, y: 312 }],
};

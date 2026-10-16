#!/usr/bin/env python3
"""Bridge between Aaron's recurseLightMap `mapping.json` and this repo's web/data files.

  python3 tools/recurse_map.py import path/to/mapping.json [--place 55 618 55 "Hall"]...
      -> web/data/layout.json  (light id -> x, y in floor-plan units)
      -> web/data/map.json     (rows as groups: name, colour, ordered ids; plus unnumbered fixtures)
  python3 tools/recurse_map.py export out/mapping.json
      <- the same two files, written back in recurseLightMap's format (hand it to Aaron)

Positions are in the floor plan's units (building 1000 x 520, see web/floorplan.js). Import keeps
lights already in layout.json that the mapping doesn't mention (e.g. 56-115) as long as that file
is already in floor units; --place adds or moves one light and puts it in a group.
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.normpath(os.path.join(HERE, "..", "web", "data"))
FRAME = "recurse-floor-v1"
KIND = "recurse-arclight-light-map"
# recurseLightMap/src/render-map.js PALETTE, so colours match Aaron's map
PALETTE = ["#ff6b6b", "#ffd43b", "#69db7c", "#4dabf7", "#da77f2", "#ff922b",
           "#38d9a9", "#f783ac", "#a9e34b", "#748ffc", "#e599f7", "#66d9e8"]


def load(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def dump(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(obj, f, indent=1, sort_keys=True)
        f.write("\n")


def cmd_import(args):
    m = json.load(open(args.mapping))
    if m.get("kind") != KIND:
        sys.exit(f"{args.mapping}: not a {KIND} file")
    old = load(os.path.join(DATA, "layout.json"), {})
    layout = {k: v for k, v in old.items() if not k.startswith("_")} if old.get("_frame") == FRAME else {}
    groups, unnumbered, seen = [], [], set()
    for i, row in enumerate(m["rows"]):
        ids = []
        for b in row["bulbs"]:
            if b.get("num") is None:
                unnumbered.append({"x": b["x"], "y": b["y"], "group": row["label"]})
                continue
            n = int(b["num"])
            if n in seen:
                sys.exit(f"number {n} appears twice in {args.mapping}")
            seen.add(n)
            ids.append(n)
            layout[str(n)] = {"x": b["x"], "y": b["y"]}
        groups.append({"name": row["label"], "color": PALETTE[i % len(PALETTE)], "ids": ids})
    for num, x, y, gname in args.place or []:
        n = int(num)
        layout[str(n)] = {"x": float(x), "y": float(y)}
        for g in groups:
            if n in g["ids"]:
                g["ids"].remove(n)
        g = next((g for g in groups if g["name"] == gname), None)
        if not g:
            g = {"name": gname, "color": PALETTE[len(groups) % len(PALETTE)], "ids": []}
            groups.append(g)
        g["ids"].append(n)
        seen.add(n)
    layout["_frame"] = FRAME
    dump(os.path.join(DATA, "layout.json"), layout)
    dump(os.path.join(DATA, "map.json"), {
        "frame": FRAME, "source": os.path.basename(args.mapping), "groups": groups, "unnumbered": unnumbered})
    missing = [n for n in range(1, 56) if n not in seen]
    print(f"imported {len(seen)} numbered bulbs into {len(groups)} groups, {len(unnumbered)} unnumbered fixtures")
    print("missing numbers:", missing or "none")


def cmd_export(args):
    layout = load(os.path.join(DATA, "layout.json"), {})
    mp = load(os.path.join(DATA, "map.json"), None)
    if not mp or layout.get("_frame") != FRAME:
        sys.exit("web/data/layout.json and map.json must come from an import first")
    rows, assigned = [], set()
    for i, g in enumerate(mp["groups"]):
        bulbs = []
        for n in g["ids"]:
            p = layout.get(str(n))
            if not p:
                continue
            bulbs.append({"num": n, "x": round(p["x"], 1), "y": round(p["y"], 1)})
            assigned.add(n)
        for u in mp.get("unnumbered", []):
            if u["group"] == g["name"]:
                bulbs.append({"num": None, "x": round(u["x"], 1), "y": round(u["y"], 1)})
        rows.append({"row": i + 1, "label": g["name"], "bulbs": bulbs})
    out = {"schemaVersion": 1, "kind": KIND, "floorplan": FRAME, "rows": rows,
           "unassigned": [n for n in range(1, 56) if n not in assigned]}
    os.makedirs(os.path.dirname(os.path.abspath(args.out)) or ".", exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(out, f, indent=2)
        f.write("\n")
    print(f"wrote {args.out}: {len(rows)} rows, {len(assigned)} numbered, unassigned {out['unassigned'] or 'none'}")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    i = sub.add_parser("import"); i.add_argument("mapping")
    i.add_argument("--place", nargs=4, action="append", metavar=("NUM", "X", "Y", "GROUP"), help="add/move one light and put it in GROUP")
    i.set_defaults(fn=cmd_import)
    e = sub.add_parser("export"); e.add_argument("out"); e.set_defaults(fn=cmd_export)
    a = p.parse_args(); a.fn(a)


if __name__ == "__main__":
    main()

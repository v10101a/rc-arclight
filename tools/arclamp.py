#!/usr/bin/env python3
"""Inspect and clean up the arclamp scene on arclight.local. Standard library only.

  python3 tools/arclamp.py lights                  fixture inventory
  python3 tools/arclamp.py scene                   layers, bottom (roomtone) to top
  python3 tools/arclamp.py roomtone                current roomtone, grouped by identical values
  python3 tools/arclamp.py roomtone set 1-55 red=0 green=0 blue=0 cold=120 warm=200
  python3 tools/arclamp.py roomtone set all brightness=0
  python3 tools/arclamp.py reset [--dry-run] [--keep 12,13] [--yes]
  python3 tools/arclamp.py mute 12 | unmute 12 | mute all | unmute all
  python3 tools/arclamp.py delete 12

ARCLAMP_SERVER / ARCLAMP_TOKEN override the defaults.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

SERVER = os.environ.get("ARCLAMP_SERVER", "http://arclight.local:8080").rstrip("/")
def load_token():
    tok = os.environ.get("ARCLAMP_TOKEN")
    if tok:
        return tok
    env = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
    try:
        with open(env) as f:
            for line in f:
                line = line.strip()
                if line.startswith("ARCLAMP_TOKEN="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    sys.exit("no token: set ARCLAMP_TOKEN, or put ARCLAMP_TOKEN=<token> in .env at the repo root "
             "(copy it from the Token field on http://arclight.local:8081/debug.html)")


def api(method, path, body=None):
    global SERVER
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        SERVER + path, data=data, method=method,
        headers={"Authorization": "Bearer " + load_token(), "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        sys.exit(f"{method} {path} -> HTTP {e.code}: {e.read().decode(errors='replace').strip()}")
    except urllib.error.URLError as e:
        ip = arp_ip() if "arclight.local" in SERVER else None
        if ip:
            print(f"(arclight.local not resolving; using {ip} from the ARP cache)", file=sys.stderr)
            SERVER = SERVER.replace("arclight.local", ip)
            return api(method, path, body)
        sys.exit(f"{method} {path} -> {e.reason} (is the Pi up? try: arp -a | grep b8:27:eb)")


def arp_ip(mac="b8:27:eb:18:6a:bc"):
    """The Pi's IP from the ARP cache, for when mDNS is flaky."""
    import subprocess
    try:
        for line in subprocess.run(["arp", "-an"], capture_output=True, text=True, timeout=5).stdout.splitlines():
            if mac in line.lower() and "(" in line:
                return line.split("(")[1].split(")")[0]
    except Exception:
        pass
    return None


def lights_by_id():
    return {l["id"]: l for l in api("GET", "/v1/lights")["lights"]}


def parse_ids(spec, known):
    if spec == "all":
        return sorted(known)
    out = []
    for part in spec.split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-", 1)
            out.extend(range(int(a), int(b) + 1))
        elif part:
            out.append(int(part))
    bad = [i for i in out if i not in known]
    if bad:
        sys.exit(f"unknown light ids: {bad}")
    return out


def first_comment(script):
    for line in script.splitlines()[1:4]:
        s = line.strip()
        if s.startswith("//"):
            return s[2:].strip()
    return script.splitlines()[0][:60] if script else ""


def cmd_lights(_):
    lights = lights_by_id()
    rows = {}
    for l in lights.values():
        key = (l["type"], tuple(c["name"] for c in l["channels"]))
        rows.setdefault(key, []).append(l["id"])
    print(f"{len(lights)} lights")
    for (typ, chans), ids in rows.items():
        print(f"  {typ:<6} ids {ids[0]}-{ids[-1]} ({len(ids)})  channels: {', '.join(chans)}")


def cmd_scene(_):
    scene = api("GET", "/v1/scene")
    print(f"{'pos':>3} {'id':>3} {'type':<8} {'state':<10} {'muted':<5} {'by':<7} note")
    for d in scene:
        note = "<roomtone template>" if d["id"] == 0 else first_comment(d.get("script", ""))
        print(f"{d['position']:>3} {d['id']:>3} {d['type']:<8} {d['state']:<10} "
              f"{str(d['muted']).lower():<5} {(d.get('created_by') or ''):<7} {note}")
    js = [d for d in scene if d["id"] != 0]
    print(f"\n{len(js)} JS layer(s) above the roomtone; highest position wins.")


def show_roomtone(lights):
    tpl = api("GET", "/v1/shader/0")["template"]["lights"]
    groups = {}
    for i in sorted(lights):
        groups.setdefault(json.dumps(tpl.get(str(i), {}), sort_keys=True), []).append(i)
    for vals, ids in groups.items():
        rng = f"{ids[0]}-{ids[-1]}" if len(ids) > 1 else str(ids[0])
        print(f"  ids {rng:<9} ({len(ids):>3}): {vals}")


def cmd_roomtone(args):
    lights = lights_by_id()
    if args.action != "set":
        show_roomtone(lights)
        return
    if not args.ids:
        sys.exit("usage: roomtone set <ids|all> chan=val ...")
    ids = parse_ids(args.ids, lights)
    wanted = {}
    for kv in args.values:
        k, v = kv.split("=", 1)
        v = int(v)
        if not 0 <= v <= 255:
            sys.exit(f"{k}={v}: values are 0-255")
        wanted[k] = v
    body = {}
    for i in ids:
        have = {c["name"] for c in lights[i]["channels"]}
        vals = {k: v for k, v in wanted.items() if k in have}
        if vals:
            body[str(i)] = vals
    if not body:
        sys.exit("none of those lights have those channels")
    api("PUT", "/v1/shader/0", {"lights": body})
    print(f"wrote {len(body)} light(s). roomtone now:")
    show_roomtone(lights)


def cmd_reset(args):
    scene = api("GET", "/v1/scene")
    keep = set(int(x) for x in args.keep.split(",")) if args.keep else set()
    victims = [d for d in scene if d["id"] != 0 and d["id"] not in keep]
    if not victims:
        print("nothing to delete; only the roomtone is in the scene")
        return
    for d in victims:
        print(f"  delete id {d['id']:>3} pos {d['position']:>2}  {first_comment(d.get('script', ''))}")
    if args.dry_run:
        print(f"dry run: {len(victims)} layer(s) would be deleted")
        return
    if not args.yes and sys.stdin.isatty():
        if input(f"delete {len(victims)} layer(s)? [y/N] ").strip().lower() != "y":
            print("aborted")
            return
    for d in victims:
        api("DELETE", f"/v1/shader/{d['id']}")
        print(f"  deleted {d['id']}")
    print("done. roomtone untouched; `roomtone set all ...` to change the base look.")


def cmd_mute(args, muted=True):
    scene = api("GET", "/v1/scene")
    if args.id == "all":
        ids = [d["id"] for d in scene if d["id"] != 0]
    else:
        ids = [int(args.id)]
    for i in ids:
        api("POST", f"/v1/shader/{i}/muted", {"muted": muted})
        print(f"  {'muted' if muted else 'unmuted'} {i}")


def cmd_delete(args):
    api("DELETE", f"/v1/shader/{int(args.id)}")
    print(f"deleted {args.id}")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("lights").set_defaults(fn=cmd_lights)
    sub.add_parser("scene").set_defaults(fn=cmd_scene)
    rt = sub.add_parser("roomtone")
    rt.add_argument("action", nargs="?", default="show", choices=["show", "set"])
    rt.add_argument("ids", nargs="?", help="e.g. 1-55, 1,2,3, 64-115, or all")
    rt.add_argument("values", nargs="*", help="chan=val, e.g. red=255 warm=0")
    rt.set_defaults(fn=cmd_roomtone)
    rs = sub.add_parser("reset", help="delete every JS layer; keeps the roomtone")
    rs.add_argument("--dry-run", action="store_true")
    rs.add_argument("--keep", help="comma-separated ids to keep")
    rs.add_argument("--yes", "-y", action="store_true", help="don't ask")
    rs.set_defaults(fn=cmd_reset)
    m = sub.add_parser("mute"); m.add_argument("id", help="layer id or all"); m.set_defaults(fn=lambda a: cmd_mute(a, True))
    u = sub.add_parser("unmute"); u.add_argument("id", help="layer id or all"); u.set_defaults(fn=lambda a: cmd_mute(a, False))
    d = sub.add_parser("delete"); d.add_argument("id"); d.set_defaults(fn=cmd_delete)
    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()

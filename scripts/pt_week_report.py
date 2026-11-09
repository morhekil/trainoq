"""Build the PT week report page from read-only D1 dumps of `days` and `exercise_log`.

    npx wrangler d1 execute trainoq --remote --json --command "SELECT date, doc FROM days ORDER BY date" > days.json
    npx wrangler d1 execute trainoq --remote --json --command "SELECT * FROM exercise_log ORDER BY date" > log.json
    npm run report:pt -- days.json log.json report.html --from 2026-11-02 --to 2026-11-09 --pt 2026-11-05

The data does not mark PT sessions, so each --pt names one. The page in scripts/pt_week_report.html does the rendering.
"""
import argparse, collections, html, json
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

parser = argparse.ArgumentParser(description="Build the PT week report page.")
parser.add_argument("days")
parser.add_argument("log")
parser.add_argument("out")
parser.add_argument("--from", dest="start", type=datetime.fromisoformat, required=True)
parser.add_argument("--to", dest="end", type=datetime.fromisoformat, required=True)
parser.add_argument("--pt", type=datetime.fromisoformat, action="append", default=[], help="a PT session date; repeatable")
parser.add_argument("--note", default="our last PT session and everything I've logged since.", help="the sentence after the dates")
args = parser.parse_args()

HERE = Path(__file__).parent
SYD = ZoneInfo("Australia/Sydney")
WEEK = [(args.start + timedelta(days=i)).strftime("%Y-%m-%d") for i in range((args.end - args.start).days + 1)]
if not WEEK: parser.error("--to is before --from")
PT_DAYS = {d.strftime("%Y-%m-%d") for d in args.pt}
TYPES = {"warmup": 0, "working": 1, "backoff": 2}

days = {r["date"]: json.loads(r["doc"]) for r in json.load(open(args.days))[0]["results"] if r["date"] <= WEEK[-1]}
names = {r["exercise_id"]: r["name"] for r in json.load(open(args.log))[0]["results"]}
long_day = lambda d: f"{d:%A} {d.day} {d:%B}"
name = lambda i: names.get(i) or i.removeprefix("legacy:").capitalize()


def num(v):
    return str(int(v)) if float(v).is_integer() else f"{v:g}"


def label(s):
    parts = []
    if s.get("weight") is not None: parts.append("BW" if s["weight"] == 0 else f"{num(s['weight'])} kg")
    if s.get("band") is not None: parts.append("no band" if s["band"] == 0 else f"band {s['band']}")
    if s.get("height") is not None: parts.append(f"{num(s['height'])} in")
    if s.get("distance") is not None: parts.append(f"{num(s['distance'])} m")
    if s.get("time") is not None: parts.append(f"{num(s['time'])} s")
    if s.get("reps") is not None: return f"{' · '.join(parts)} × {s['reps']}" if parts else f"{s['reps']} reps"
    return " · ".join(parts) or "–"


def performances(doc):
    """Yield (event, entry, section, item-ish dict) for every exercise performance in a day."""
    for event in doc.get("events", []):
        for entry in event["entries"]:
            if entry["kind"] == "activity":
                for seg in segments(entry["activity"]): yield event, entry, "activity", {**seg, "comment": entry["activity"].get("comment", "")}
                continue
            for section in ("warmup", "main", "cooldown"):
                for item in entry["session"][section]:
                    if item["kind"] == "exercise":
                        yield event, entry, section, item
                    else:
                        for m in members(item): yield event, entry, section, m


def members(superset):
    res = {(r["memberId"], r["roundId"]): r for r in superset["results"]}
    return [{**m, "sets": [{**res.get((m["id"], r["id"]), {}), "type": r["type"]} for r in superset["rounds"]]}
            for m in superset["members"]]


def segments(activity):
    """v9 activities hold segments; older days still store one exercise per activity."""
    return activity.get("segments") or [activity]


def local(iso, offset=None):
    t = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return (t + timedelta(minutes=offset)).replace(tzinfo=None) if offset is not None else t.astimezone(SYD)


# ---- history per exercise, from every saved day ----
hist = collections.defaultdict(lambda: collections.defaultdict(lambda: {"sets": [], "comments": [], "min": 0, "kcal": 0, "act": False}))
for date, doc in sorted(days.items()):
    for _, _, section, p in performances(doc):
        h = hist[p["exerciseId"]][date]
        if section == "activity":
            h["act"] = True; h["min"] += p["result"].get("minutes") or 0; h["kcal"] += p["result"].get("calories") or 0
        else:
            h["sets"] += [s for s in p.get("sets", []) if any(s.get(k) is not None for k in ("weight", "band", "height", "distance", "time", "reps"))]
        if p.get("comment", "").strip(): h["comments"].append(p["comment"].strip())

METRICS = ["weight", "band", "height", "distance", "time", "reps"]
UNITS = {"weight": "kg", "band": "band", "height": "in", "distance": "m", "time": "s", "reps": "reps", "minutes": "min"}


def metric_of(sessions):
    if all(h["act"] and not h["sets"] for h in sessions.values()): return "minutes"
    sets = [s for h in sessions.values() for s in h["sets"]]
    if any((s.get("weight") or 0) > 0 for s in sets): return "weight"
    return next((m for m in METRICS[1:] if any(s.get(m) is not None for s in sets)), None)


def top(sets, m):
    have = [s for s in sets if s.get(m) is not None]
    hard = [s for s in have if s["type"] != "warmup"] or have
    if not hard: return None, None
    # Band is assistance, so the hardest set is the lowest band.
    best = min(hard, key=lambda s: (s[m], -(s.get("reps") or 0))) if m == "band" else max(hard, key=lambda s: (s[m], s.get("reps") or 0))
    return best[m], label(best)


exercises = {}
for eid, sessions in hist.items():
    m = metric_of(sessions)
    rows = []
    for date, h in sorted(sessions.items()):
        if m == "minutes":
            v, lab = h["min"], f"{h['min']} min" + (f" · {h['kcal']} kcal" if h["kcal"] else "")
        else:
            v, lab = top(h["sets"], m) if m else (None, None)
        rows.append([date, v, lab, [[TYPES[s["type"]], label(s)] for s in h["sets"]], " · ".join(dict.fromkeys(h["comments"]))])
    exercises[eid] = {"n": name(eid), "m": m, "u": UNITS.get(m), "h": rows}


# ---- the week ----
def grouped(sets):
    """Consecutive identical sets collapse into [type, label, count]."""
    out = []
    for x in sets:
        key = [TYPES[x["type"]], label(x)]
        if out and out[-1][:2] == key: out[-1][2] += 1
        else: out.append([*key, 1])
    return out


def session_out(s):
    """Summary rows: one per exercise, working sets only; light warm-up and mobility work is listed by name."""
    start = local(s["startedAt"])
    end = local(s["endedAt"]) if s.get("endedAt") else None
    rows, light = {}, []
    for section in ("warmup", "main", "cooldown"):
        for it in s[section]:
            for p in [it] if it["kind"] == "exercise" else members(it):
                valued = [x for x in p["sets"] if any(x.get(k) is not None for k in METRICS)]
                hard = [x for x in valued if x["type"] != "warmup"]
                if section == "main" or hard or any(x.get("weight") for x in valued):
                    rows.setdefault(p["exerciseId"], []).extend(hard or valued)
                else:
                    light.append(name(p["exerciseId"]))
    weighted = any(x.get("weight") for sets in rows.values() for x in sets)
    return {"kind": "Strength" if weighted or s["main"] else "Mobility",
            "t": start.strftime("%H:%M"), "dur": round((end - start).total_seconds() / 60) if end else None,
            "rows": [{"id": i, "n": name(i), "s": grouped(sets)} for i, sets in rows.items()],
            "light": list(dict.fromkeys(n for n in light if n not in {name(i) for i in rows}))}


KINDS = {"Walk": "Walk", "Run": "Run", "Bouldering": "Climbing", "Yoga": "Yoga", "Cardio": "Cardio"}
week = []
for date in WEEK:
    doc = days.get(date, {"events": [], "comments": []})
    timed_pain = [(c["time"], c["score"]["value"]) for c in doc.get("comments", []) if (c.get("score") or {}).get("metric") == "Back"]
    sessions, acts = [], []
    for ev in doc["events"]:
        for e in ev["entries"]:
            if e["kind"] == "session":
                sessions.append(session_out(e["session"]))
        parts = [seg for e in ev["entries"] if e["kind"] == "activity" for seg in segments(e["activity"])]
        if not parts: continue
        t = min(local(a["startedAt"], a.get("sourceOffsetMinutes")) for a in parts).strftime("%H:%M")
        totals = {}
        for a in parts: totals[name(a["exerciseId"])] = totals.get(name(a["exerciseId"]), 0) + (a["result"].get("minutes") or 0)
        acts.append({"t": t, "title": ev.get("title") or "/".join(totals), "min": sum(totals.values()),
                     "split": totals if len(parts) > 1 else None, "kinds": [KINDS.get(n, n) for n in totals]})
    sessions.sort(key=lambda x: x["t"]); acts.sort(key=lambda x: x["t"])
    d = datetime.fromisoformat(date)
    week.append({"date": date, "dow": d.strftime("%a"), "dm": f"{d.day} {d.strftime('%b')}",
                 "long": long_day(d), "pt": date in PT_DAYS,
                 "kinds": list(dict.fromkeys([x["kind"] for x in sessions] + [k for a in acts for k in a["kinds"]])),
                 "min": sum(x["dur"] or 0 for x in sessions) + sum(a["min"] for a in acts), "kcal": doc.get("totalCalories"),
                 "pain": [v for _, v in sorted(timed_pain)], "sessions": sessions, "acts": acts})

a, b = args.start, args.end
page = (HERE / "pt_week_report.html").read_text()
for key, value in {
    "__RANGE__": f"{a.day}–{b.day} {b:%b}" if (a.year, a.month) == (b.year, b.month) else f"{a.day} {a:%b}–{b.day} {b:%b}",
    "__DEK__": html.escape(f"{long_day(a)} to {long_day(b)} {b.year}: {args.note}", quote=False),
    "__DAYS__": str(len(WEEK)),
    "__DATA__": json.dumps({"week": week, "ex": exercises}, separators=(",", ":"), ensure_ascii=False).replace("</", "<\\/"),
}.items():
    page = page.replace(key, value)
Path(args.out).write_text(page)
print(f"{len(exercises)} exercises, {sum(len(e['h']) for e in exercises.values())} sessions, {len(page) // 1024} KB")

"""Convert the Coach Pro PT export (2022-2026) into Trainoq v8 day documents.

The export is free text, so each note is transcribed by hand into a small line
format. This module checks every exercise name and value, then builds the
documents and catalog changes that `import_pt_history.mjs` sends through the
tRPC API. The raw note is kept as the session's notes.

Transcription format, one block per export note in export order:

    @ 13-Nov-25 22:04            stamp exactly as exported; "#2" marks a repeated stamp
    !skip duplicate stub         not imported (reason required)
    !comment                     raw note becomes a day comment at the stamp time
    !merge                       items join the start of the existing day's session
    !date 2025-11-12             overrides the session date
    [warmup] [main] [cooldown]   section for the following items (default main)
    Name: SETS | comment         one standalone exercise
    = 3 | 15 kg vest             superset with 3 rounds; the comment joins every member
      Name: SETS | comment       indented members: one set for every round, or one per round

SETS is a comma list of sets. A set is "w:" (warm-up) or "b:" (back-off) or no
prefix (working), then the values of the exercise's parameters in registry
order separated by "/", then an optional "*N" repeat. "-" is a missing value, or
a whole set without values. Time accepts seconds or m:ss. Examples for weight
and reps: "w:60/5, 80/3*2, b:60/8"; for band and time: "3/10*3"; for time: "1:35".

Transcription rules agreed with the athlete:
- Session date is the note's date; a note stamped 00:00-05:59 belongs to the previous day.
- Weights are kg per implement as written (dumbbell, kettlebell). Weighted chins
  and dips record the added weight, bodyweight is 0. "Per side" machine and frame
  loading (leg press, hack squat, Panatta, farmers frame pegs) is stored as the
  total, twice the written figure.
- Cable stack "plates": weight "-", plate count in the comment.
- "3x5" is three sets of five; "5,4,5" three sets; "x N sets/rounds" repeats.
- Ranges "70-80 kg x 10-6 x 3": the first set takes the low/first values, the
  rest the high/last values.
- A cross mark (failed) is a 0-rep set at that weight with "failed" in the comment.
- Laps of sled, carries, monkey bars and squat matrices are reps. Lunges written
  in laps get reps "-" and "2 laps" in the comment. "Per side" reps stay per side.
- A weighted vest worn for a whole circuit goes in the circuit comment. A vest
  tied to one exercise ("rope climbs 7 kg vest") is that exercise's weight.
- Box heights in cm are converted to inches. Hold tests "1.35" mean 1:35.
- Band is 0-5: 0 explicitly no band, 1 extra/ultra thin, 2 thin or light,
  3 medium/mid/yellow (or thin + ultra thin), 4 thick/purple/strong/black/green
  (or medium + light), 5 monster, doubled bands or thick + another band. A band
  exercise with no band size in the note gets "-". Keep the band words in the comment.
- "x N attempts" of a timed hold without a time is N sets of "-".
- Comments keep what the numbers cannot: band names, spot, failure, grip, tempo,
  per side, laps, plates, vest. Blocks with no named exercise ("loaded mobility",
  "conditioning x 3 rounds") stay in the raw note only.
"""

import json
import re
import sys
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

SYDNEY = ZoneInfo("Australia/Sydney")
NAMESPACE = uuid.UUID("6f1d3c2e-8a4b-4d5e-9f60-7a8b9c0d1e2f")
PARAM_ORDER = ["height", "edge", "band", "distance", "weight", "time", "reps"]
WHOLE = {"height", "edge", "band", "reps"}

WR, R, T, WT, BR, BT, WTR = ("weight", "reps"), ("reps",), ("time",), ("weight", "time"), ("band", "reps"), ("band", "time"), ("weight", "time", "reps")
# name: (existing ID or None for a new exercise, parameters in registry order)
EXERCISES = {
    # squat and lunge
    "Back squat": ("seed:0057", WR),
    "Box squat": (None, WR),
    "Pause squat": (None, WTR),
    "Pulse squat": (None, WR),
    "One-and-a-quarter squat": (None, WR),
    "Banded kettlebell back squat": (None, WR),
    "Cable Zercher squat": (None, WR),
    "Pendulum squat": (None, WR),
    "Hack squat": (None, WR),
    "Leg press": ("seed:0068", WR),
    "Landmine squat": (None, WR),
    "Goblet squat": ("seed:0059", WR),
    "Bodyweight squat": ("seed:0155", R),
    "Sissy squat": ("seed:0159", WR),
    "Pistol squat": ("seed:0156", WR),
    "Shrimp squat": ("seed:0157", R),
    "Cossack squat": ("seed:0158", R),
    "King squat": (None, R),
    "Dragon squat": (None, R),
    "Single-leg squat matrix": (None, R),
    "Bulgarian split squat": ("seed:0066", WR),
    "Safety bar Bulgarian split squat": (None, WR),
    "Front-foot-elevated split squat": (None, WR),
    "Split squat": (None, WR),
    "Dumbbell lunges": ("seed:0064", WR),
    "Barbell walking lunge": (None, WR),
    "Reverse lunge": ("seed:0065", WR),
    "Barbell reverse lunge": (None, WR),
    "Step-up": ("seed:0067", WR),
    "Wall sit": ("seed:0161", T),
    "Split lunge hold": (None, T),
    "Deep squat hold": (None, T),
    "Overhead squat hold": (None, T),
    "John Wayne squat hold": (None, T),
    "Box jump": ("seed:0164", ("height", "reps")),
    "Broad jump": ("seed:0165", R),
    "Hurdle jump": (None, R),
    "Agility ladder": (None, R),
    # hinge and hamstrings
    "Deadlift": ("seed:0060", WR),
    "Trap bar deadlift": ("seed:0062", WR),
    "Sumo deadlift": (None, WR),
    "Staggered-stance trap bar deadlift": (None, WR),
    "Drop deadlift": (None, WR),
    "Pause deadlift": (None, WTR),
    "Kettlebell deadlift": (None, WR),
    "Romanian deadlift": ("seed:0061", WR),
    "Dumbbell RDL": (None, WR),
    "Landmine RDL": (None, WR),
    "RDL to pistol swoop-through": (None, R),
    "Hip thrust": ("seed:0063", WR),
    "Single-leg hip thrust": (None, WR),
    "GHD back extension": (None, WR),
    "Nordic curl": ("seed:0071", R),
    "Reverse Nordic": ("seed:0160", R),
    "Leg curl": ("seed:0069", WR),
    "Leg extension": ("seed:0070", WR),
    "Standing single-leg curl": (None, WR),
    "Cable single-leg hamstring pulldown": (None, WR),
    "Swiss ball hamstring curl": (None, R),
    "Foam roller hamstring curl": (None, R),
    "Jefferson curl": ("seed:0030", WR),
    "Jefferson curl to squat": (None, WR),
    "Kettlebell windmill": (None, WR),
    "Kettlebell swing": ("seed:0073", WR),
    "American kettlebell swing": (None, WR),
    "Kettlebell clean and jerk": (None, WR),
    "Turkish get-up": (None, WR),
    # push
    "Bench press": ("seed:0037", WR),
    "Dumbbell bench press": ("seed:0039", WR),
    "Single-arm dumbbell bench press": (None, WR),
    "Single-arm kettlebell chest press": (None, WR),
    "Incline dumbbell press": ("seed:0040", WR),
    "Overhead press": ("seed:0041", WR),
    "Push press": (None, WR),
    "Dumbbell shoulder press": ("seed:0042", WR),
    "Neutral-grip dumbbell shoulder press": (None, WR),
    "Single-arm dumbbell shoulder press": (None, WR),
    "Dumbbell push press": (None, WR),
    "Single-arm kettlebell push press": (None, WR),
    "Machine shoulder press": (None, WR),
    "Bottoms-up kettlebell press": (None, WR),
    "Landmine press": (None, WR),
    "Single-arm landmine press": (None, WR),
    "Rotational landmine press": (None, WR),
    "Landmine thruster": (None, WR),
    "Single-arm landmine thruster": (None, WR),
    "Landmine clean and press": (None, WR),
    "Dumbbell thruster": (None, WR),
    "Push-up": ("seed:0043", WR),
    "Incline push-up": ("seed:0117", R),
    "Decline push-up": ("seed:0118", R),
    "Ring push-up": ("seed:0126", R),
    "Tiger push-up": (None, R),
    "Hindu push-up": (None, WR),
    "Russian push-up": (None, R),
    "Plank to push-up": (None, R),
    "Push-up hold": (None, T),
    "Pike push-up": ("seed:0121", ("height", "reps")),
    "Handstand push-up negative": (None, R),
    "Dips": ("seed:0044", WR),
    "Ring dip": ("seed:0127", WR),
    "Band-assisted dip": ("seed:0095", BR),
    "Dip negative": (None, R),
    "Jumping ring dip": (None, R),
    "Support hold": ("seed:0143", T),
    "Ring extension hold": (None, T),
    "Tuck planche": ("seed:0152", T),
    "Swiss ball planche lean": (None, R),
    "L-sit to tuck planche": (None, R),
    "Crow pose": ("seed:0150", T),
    "Frog stand to handstand": (None, T),
    "Ice cream maker": (None, BR),
    "Jackknife": (None, R),
    # pull
    "Chin-up": ("seed:0049", WR),
    "Neutral-grip chin-up": (None, WR),
    "Mixed-grip chin-up": (None, R),
    "Towel chin-up": (None, R),
    "Ring chin-up": (None, R),
    "Archer pull-up": ("seed:0131", R),
    "Pull-up": ("seed:0048", WR),
    "Negative pull-up": ("seed:0130", R),
    "High pull-up": (None, R),
    "Chin-up hold": (None, WT),
    "Ring chin-up hold": (None, BT),
    "Band-assisted one-arm chin-up": (None, BR),
    "Band-assisted one-arm chin-up hold": (None, BT),
    "Inverted row": ("seed:0054", R),
    "Single-arm ring row": (None, R),
    "Dumbbell row": ("seed:0052", WR),
    "Seated cable row": ("seed:0053", WR),
    "Single-arm cable row": (None, WR),
    "Plank cable row": (None, WR),
    "Plate-loaded lat pulldown": (None, WR),
    "Woodchop": ("seed:0100", WR),
    "Pallof press with overhead": ("dc2c22d1-22fa-42ec-8bd6-6a83db3252a7", R),
    "Scapular shrugs, single arm": ("legacy:scapular shrugs, single arm", WR),
    "Rope climb": (None, WR),
    "Vertical rope pull": (None, R),
    "Prone Y raise": (None, WR),
    # muscle-up
    "Muscle-up": ("seed:0133", R),
    "Band-assisted muscle-up": (None, BR),
    "Band-assisted ring muscle-up": (None, BR),
    "Ring muscle-up drill": (None, R),
    "Reverse muscle-up": (None, R),
    "Muscle-up negative": (None, R),
    "Bar pullover": (None, R),
    "Pullover to high pull": (None, R),
    "Pullover to reverse muscle-up": (None, R),
    # levers
    "Front lever": ("seed:0135", BT),
    "Tuck front lever": (None, BT),
    "Single-leg front lever": (None, BT),
    "Straddle front lever": (None, BT),
    "Front lever candlestick": (None, T),
    "Front lever negative": (None, R),
    "Tuck front lever negative": (None, R),
    "Straddle front lever negative": (None, R),
    "Single-leg front lever negative": (None, R),
    "Front lever raises": ("64d0d4ff-259a-466d-ab4f-f650ff9f3004", BR),
    "Reverse hanging knee tuck": (None, R),
    "Back lever": ("seed:0137", BT),
    "Tuck back lever": (None, BT),
    "Single-leg back lever": (None, BT),
    "Straddle back lever": (None, BT),
    "Back lever candlestick": (None, T),
    "Back lever against bar": (None, T),
    "Single-leg back lever negative": (None, R),
    "Dragon flag": ("seed:0145", R),
    "Dragon flag hold": (None, T),
    "Human flag": (None, T),
    "Skin the cat": ("seed:0138", R),
    "German hang": ("seed:0139", T),
    # hangs and bars
    "Dead hang": ("seed:0029", T),
    "One-arm hang": (None, T),
    "Hollow hang": (None, T),
    "360 hang": ("legacy:360 hang", R),
    "Swinatra": (None, R),
    "Single-arm hang hip tap": (None, R),
    "Monkey bars": (None, R),
    "Monkey bar jump": (None, R),
    "Rod shoulder extension": (None, R),
    "Rod hand walk": (None, R),
    "Hanging knee raise": ("seed:0074", R),
    "Hanging knee tuck hold": (None, T),
    "Toes to bar": ("seed:0144", R),
    # handstand
    "Handstand": ("seed:0148", T),
    "Chest-to-wall handstand": (None, T),
    "Pike handstand hold": (None, T),
    "Handstand kick-up": (None, R),
    "Handstand heel and toe pull": (None, R),
    "Chest-to-wall handstand tuck": (None, R),
    "Handstand shoulder tap": (None, R),
    "Parallette handstand knee tuck": (None, R),
    "Wall walk": ("seed:0149", R),
    "Headstand": (None, T),
    "Box shoulder stand": (None, R),
    # core and foundation
    "L-sit": ("seed:0142", T),
    "Tuck L-sit": (None, T),
    "Table top to L-sit": (None, R),
    "Hollow body hold": ("seed:0140", T),
    "Hollow rock": (None, T),
    "Side rock": (None, T),
    "Rock matrix": (None, T),
    "Hollow body roll": (None, R),
    "Arch hold": ("seed:0141", T),
    "Side arch hold": (None, T),
    "Side hollow hold": (None, T),
    "Side-over arch": (None, R),
    "Side oblique lift": (None, R),
    "Straddle hold": (None, T),
    "Ankle grab hold": (None, T),
    "Pike pulse": (None, R),
    "Side plank": ("seed:0007", T),
    "Side plank elbow twist": (None, R),
    "Copenhagen plank": ("seed:0014", T),
    "Plank shoulder tap": (None, R),
    "Bridge shoulder tap": (None, R),
    "Slider knee tuck": (None, R),
    "Stir the pot": (None, R),
    "Incline crunch": (None, WR),
    "Incline twisting sit-up": (None, WR),
    "Half-kneeling med ball throw": (None, R),
    "Lying quad extension": (None, R),
    "Lying glute extension": (None, R),
    "Side-lying hip circle": (None, R),
    "Lying hip flexion": (None, R),
    "Lying leg abduction and adduction": (None, R),
    "Reverse leg raise": (None, R),
    "Hamstring stretch": ("seed:0031", T),
    # carries, sled and conditioning
    "Farmer carry": ("seed:0077", WR),
    "Suitcase carry": ("seed:0078", WR),
    "Farmers frame carry": (None, WR),
    "Waiter carry": (None, WR),
    "Bottoms-up kettlebell carry": (None, WR),
    "Bottoms-up kettlebell hold": (None, WT),
    "Sled push": (None, WR),
    "Sled chest push": (None, WR),
    "Sled rope pull": (None, WR),
    "TRX sled row": (None, WR),
    "Dead ball shoulder throw": (None, WR),
    "Ball slam": (None, WR),
    "Rower": ("seed:0035", ("distance", "time")),
    "Ski erg": (None, ("distance", "time")),
}

# Carries default to weight x time; their PT laps are a history-only reading, so the default stays.
KEEP_DEFAULT = {"Farmer carry", "Suitcase carry"}

STAMP = re.compile(r"^(\d\d-[A-Z][a-z]{2}-\d\d \d\d:\d\d) Hours:.*$", re.M)
HEADER = re.compile(r"^@ (\d\d-[A-Z][a-z]{2}-\d\d \d\d:\d\d)(?: #(\d+))?$")


def exercise_id(name):
    known = EXERCISES[name][0]
    return known or str(uuid.uuid5(NAMESPACE, "exercise:" + name.lower()))


def number(param, text, line):
    if text == "-":
        return None
    try:
        if param == "time" and ":" in text:
            minutes, seconds = text.split(":")
            value = int(minutes) * 60 + float(seconds)
        else:
            value = float(text)
    except ValueError:
        raise ValueError(f"line {line}: {param} {text!r} is not a number") from None
    if param in WHOLE and not value.is_integer():
        raise ValueError(f"line {line}: {param} must be a whole number")
    if param == "band" and not 0 <= value <= 5:
        raise ValueError(f"line {line}: band must be 0-5")
    return int(value) if value.is_integer() else value


def parse_sets(spec, params, line):
    sets = []
    for part in spec.split(","):
        part = part.strip()
        kind = {"w:": "warmup", "b:": "backoff"}.get(part[:2], "working")
        if kind != "working":
            part = part[2:].strip()
        part, _, count = part.partition("*")
        part = part.strip()
        if part == "-":
            values = {key: None for key in params}
        else:
            raw = part.split("/")
            if len(raw) != len(params):
                raise ValueError(f"line {line}: expected {'/'.join(params)}, got {part!r}")
            values = {key: number(key, text.strip(), line) for key, text in zip(params, raw)}
        sets += [(kind, values)] * int(count or 1)
    return sets


def parse_item(text, line):
    head, _, comment = text.partition("|")
    name, colon, spec = head.partition(":")
    name = name.strip()
    if not colon:
        raise ValueError(f"line {line}: expected 'Name: sets'")
    if name not in EXERCISES:
        raise ValueError(f"line {line}: unknown exercise {name!r}")
    return {"name": name, "sets": parse_sets(spec.strip() or "-", EXERCISES[name][1], line), "comment": comment.strip()}


def parse_blocks(text):
    blocks, block, section, superset = [], None, "main", None
    for number_, raw in enumerate(text.splitlines(), 1):
        line = raw.rstrip()
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        header = HEADER.match(line)
        if header:
            block = {"stamp": header.group(1), "occurrence": int(header.group(2) or 1), "line": number_,
                     "directives": {}, "items": []}
            blocks.append(block)
            section, superset = "main", None
            continue
        if block is None:
            raise ValueError(f"line {number_}: content before the first '@' block")
        if raw[0].isspace():
            if superset is None:
                raise ValueError(f"line {number_}: indented line outside a superset")
            member = parse_item(line.strip(), number_)
            if len(member["sets"]) not in (1, superset["rounds"]):
                raise ValueError(f"line {number_}: give one set or {superset['rounds']} sets")
            superset["members"].append(member)
            continue
        superset = None
        if line.startswith("!"):
            key, _, value = line[1:].partition(" ")
            if key not in ("skip", "comment", "merge", "date") or (key in ("skip", "date") and not value.strip()):
                raise ValueError(f"line {number_}: unknown or incomplete directive {line!r}")
            block["directives"][key] = value.strip()
        elif line in ("[warmup]", "[main]", "[cooldown]"):
            section = line[1:-1]
        elif line.startswith("="):
            rounds, _, comment = line[1:].partition("|")
            superset = {"kind": "superset", "rounds": int(rounds), "comment": comment.strip(), "members": [], "line": number_}
            block["items"].append((section, superset))
        else:
            block["items"].append((section, {"kind": "exercise", **parse_item(line, number_)}))
    for block in blocks:
        for _, item in block["items"]:
            if item["kind"] == "superset" and not item["members"]:
                raise ValueError(f"line {item['line']}: superset without members")
    return blocks


def split_export(text):
    marks = list(STAMP.finditer(text))
    notes, seen = [], {}
    for index, mark in enumerate(marks):
        end = marks[index + 1].start() if index + 1 < len(marks) else len(text)
        stamp = mark.group(1)
        seen[stamp] = seen.get(stamp, 0) + 1
        notes.append(((stamp, seen[stamp]), text[mark.end():end].strip()))
    return notes


def iso(moment):
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


class Ids:
    def __init__(self, seed):
        self.seed, self.count = seed, 0

    def __call__(self):
        self.count += 1
        return str(uuid.uuid5(NAMESPACE, f"{self.seed}/{self.count}"))


def build_item(item, new_id):
    def record(member):
        params = EXERCISES[member["name"]][1]
        return {"id": new_id(), "exerciseId": exercise_id(member["name"]), "comment": member["comment"], "params": {"perSet": list(params)}}

    if item["kind"] == "exercise":
        return {"kind": "exercise", **record(item),
                "sets": [{"id": new_id(), "type": kind, **values} for kind, values in item["sets"]]}
    members = [(record(member), member) for member in item["members"]]
    types = []
    for index in range(item["rounds"]):
        kinds = {member["sets"][index if len(member["sets"]) > 1 else 0][0] for member in item["members"]}
        if len(kinds) != 1:
            raise ValueError(f"line {item['line']}: members disagree on round {index + 1} type")
        types.append(kinds.pop())
    rounds = [{"id": new_id(), "type": kind} for kind in types]
    results = [{"memberId": doc["id"], "roundId": round_["id"], **member["sets"][index if len(member["sets"]) > 1 else 0][1]}
               for doc, member in members for index, round_ in enumerate(rounds)]
    for doc, _ in members:
        doc["comment"] = "; ".join(part for part in (item["comment"], doc["comment"]) if part)
    return {"kind": "superset", "id": new_id(), "members": [doc for doc, _ in members], "rounds": rounds, "results": results}


def build(export_text, blocks):
    notes = split_export(export_text)
    raw = dict(notes)
    keys = [(block["stamp"], block["occurrence"]) for block in blocks]
    missing = [f"{stamp}" + (f" #{n}" if n > 1 else "") for stamp, n in raw if (stamp, n) not in keys]
    extra = [f"{stamp} #{n}" for stamp, n in keys if (stamp, n) not in raw]
    repeated = {key for key in keys if keys.count(key) > 1}
    if missing or extra or repeated:
        raise ValueError(f"notes not transcribed: {missing}; unknown blocks: {extra}; repeated: {sorted(repeated)}")

    days, merges, used = {}, [], {}
    for block in sorted(blocks, key=lambda block: keys.index((block["stamp"], block["occurrence"]))):
        directives = block["directives"]
        if "skip" in directives:
            continue
        written = datetime.strptime(block["stamp"], "%d-%b-%y %H:%M").replace(tzinfo=SYDNEY)
        date = written.date() - timedelta(days=1) if written.hour < 6 else written.date()
        if "date" in directives:
            date = datetime.strptime(directives["date"], "%Y-%m-%d").date()
        key = date.isoformat()
        text = raw[(block["stamp"], block["occurrence"])]
        new_id = Ids(f"{key}/{block['stamp']}/{block['occurrence']}")
        sections = {"warmup": [], "main": [], "cooldown": []}
        for section, item in block["items"]:
            sections[section].append(build_item(item, new_id))
            for member in item.get("members", [item]):
                used[member["name"]] = True
        notes_text = f"PT notes (Coach Pro, {block['stamp']}):\n{text}"
        if "merge" in directives:
            merges.append({"date": key, **sections, "notes": notes_text})
            continue
        day = days.setdefault(key, {"v": 8, "date": key, "comments": [], "events": [], "ignoredGarminSourceKeys": [], "totalCalories": None})
        if "comment" in directives:
            day["comments"].append({"id": new_id(), "time": written.strftime("%H:%M"), "text": text})
            continue
        start = datetime.combine(date, datetime.min.time(), SYDNEY).replace(hour=10)
        if written.date() == date and written.hour < 11:
            start = written - timedelta(hours=1)
        session = {"id": new_id(), "startedAt": iso(start), "endedAt": iso(start + timedelta(hours=1)),
                   **sections, "calories": None, "notes": notes_text}
        day["events"].append({"id": new_id(), "title": None, "notes": "", "entries": [{"kind": "session", "session": session}]})

    exercises = [{"id": exercise_id(name), "name": name, "params": {"perSet": list(EXERCISES[name][1])}, "new": EXERCISES[name][0] is None,
                  **({"keepDefault": True} if name in KEEP_DEFAULT else {})}
                 for name in EXERCISES if name in used]
    return {"exercises": exercises, "days": [{"date": key, "doc": days[key]} for key in sorted(days)], "merges": merges}


def report(out):
    """Per-exercise history as text, for reviewing the transcription."""
    names = {exercise["id"]: exercise["name"] for exercise in out["exercises"]}
    rows = {}
    sessions = [(day["date"], entry["session"]) for day in out["days"] for event in day["doc"]["events"] for entry in event["entries"]]
    sessions += [(merge["date"], merge) for merge in out["merges"]]
    for date, session in sessions:
        for section in ("warmup", "main", "cooldown"):
            for item in session[section]:
                for member in ([item] if item["kind"] == "exercise" else item["members"]):
                    sets = item["sets"] if item["kind"] == "exercise" else [
                        {**result, "type": round_["type"]} for round_ in item["rounds"] for result in item["results"]
                        if result["memberId"] == member["id"] and result["roundId"] == round_["id"]]
                    values = ", ".join(("w:" if s["type"] == "warmup" else "b:" if s["type"] == "backoff" else "")
                                       + "/".join("-" if s[key] is None else str(s[key]) for key in member["params"]["perSet"])
                                       for s in sets)
                    rows.setdefault(names[member["exerciseId"]], []).append(f"  {date}  {values}  {member['comment']}".rstrip())
    return "\n".join(f"{name} ({'/'.join(EXERCISES[name][1])})\n" + "\n".join(lines) for name, lines in sorted(rows.items())) + "\n"


def main(argv):
    if len(argv) < 4 or argv[1] not in ("check", "build"):
        sys.exit("usage: import_pt_history.py check|build EXPORT OUT_DIR|- DSL...")
    blocks = []
    for path in argv[4:]:
        try:
            blocks += parse_blocks(open(path, encoding="utf-8").read())
        except ValueError as error:
            sys.exit(f"{path}: {error}")
    if argv[1] == "check":
        print(f"{len(blocks)} blocks parsed")
        return
    out = build(open(argv[2], encoding="utf-8").read(), blocks)
    with open(f"{argv[3]}/history.json", "w", encoding="utf-8") as file:
        json.dump(out, file, ensure_ascii=False, indent=1)
    with open(f"{argv[3]}/report.txt", "w", encoding="utf-8") as file:
        file.write(report(out))
    print(f"{len(out['days'])} days, {len(out['merges'])} merges, {len(out['exercises'])} exercises "
          f"({sum(e['new'] for e in out['exercises'])} new)")


if __name__ == "__main__":
    main(sys.argv)

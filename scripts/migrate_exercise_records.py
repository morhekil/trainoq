"""One-off conversion of the audited September–October 2026 session records.

The live D1 export remains the before snapshot. This module only prepares
documents and history rows; the caller checks the old document and timestamp
before applying any write.
"""

import json
import re


TIME_EXERCISES = {
    "seed:0007",  # Side plank
    "seed:0020",  # Foam rolling – back
    "seed:0029",  # Dead hang
    "seed:0143",  # Support hold
    "legacy:knee hang",
    "c51fd543-6082-442d-a983-deda7ac92764",  # Back to box hand stand
}


def convert_day(doc):
    if doc["v"] != 7:
        raise ValueError("Expected an unchanged v7 day")
    date = doc["date"]
    doc["v"] = 8
    for event in doc["events"]:
        for entry in event["entries"]:
            if entry["kind"] != "session":
                continue
            session = entry["session"]
            for section in ("warmup", "main", "cooldown"):
                for item in session[section]:
                    records = [item] if item["kind"] == "exercise" else item["members"]
                    for record in records:
                        sets = item["sets"] if item["kind"] == "exercise" else [
                            row for row in item["results"] if row["memberId"] == record["id"]
                        ]
                        convert_record(date, record, sets)
    return doc


def convert_record(date, record, sets):
    exercise_id = record["exerciseId"]
    comment = record["comment"]
    if exercise_id == "seed:0048" and date == "2026-09-24" and comment == "30s":
        if len(sets) != 1 or sets[0]["weight"] is not None or sets[0]["reps"] is not None:
            raise ValueError("Unexpected Pull-up hold source")
        record["exerciseId"] = "legacy:pull-up hold"
        params = ["weight", "time"]
        sets[0]["weight"] = 0
        sets[0]["time"] = 30
    elif exercise_id == "seed:0079":
        params = ["edge", "time", "reps"]
        if date == "2026-09-23" and comment == "Density hangs 40s 30mm" and len(sets) == 1:
            sets[0].update(edge=30, time=40)
        elif date == "2026-09-25" and comment == "40s density hangs warmup, then 15s 20mm edge" and len(sets) == 4:
            for index, row in enumerate(sets):
                row.update(edge=None if index == 0 else 20, time=40 if index == 0 else 15)
        else:
            raise ValueError("Unexpected Hangboard source")
    elif exercise_id == "seed:0121":
        params = ["height", "reps"]
        if date == "2026-09-28" and comment == '20" box warmup, 24" working set' and len(sets) == 4:
            heights = [20, 24, 24, 24]
        elif date == "2026-10-05" and comment == "20 inch box deficit " and len(sets) == 1:
            heights = [20]
        elif date == "2026-10-05" and comment == "24 inch box deficit, RIR none" and len(sets) == 3:
            heights = [24, 24, 24]
        else:
            raise ValueError("Unexpected Pike push-up source")
        for row, height in zip(sets, heights):
            row["height"] = height
    elif exercise_id == "legacy:active hang":
        if comment != "5s hangs":
            raise ValueError("Unexpected Active hang source")
        params = ["time", "reps"]
        for row in sets:
            row["time"] = 5
    elif exercise_id == "seed:0036":
        if comment != "2  X 3 min" or len(sets) != 1 or sets[0]["reps"] is not None:
            raise ValueError("Unexpected Skipping source")
        params = ["time", "reps"]
        sets[0].update(time=180, reps=2)
    elif exercise_id in TIME_EXERCISES:
        params = ["time"]
        match = re.fullmatch(r"(?:Bodyweight )?(\d+)s", comment)
        if comment and not match and exercise_id != "seed:0020":
            raise ValueError("Unexpected timed hold comment")
        for row in sets:
            row["time"] = int(match.group(1)) if match else None
    elif exercise_id == "legacy:handstand scapular pushup":
        params = ["reps"]
        if any(row["weight"] not in (None, 0) for row in sets):
            raise ValueError("Unexpected Handstand scapular pushup weight")
    else:
        params = ["weight", "reps"] if any(row["weight"] is not None for row in sets) else ["reps"]

    angle = None
    if exercise_id == "seed:0038":
        match = re.search(r"(\d+)(?:°|deg) bench", comment)
        angle = int(match.group(1)) if match else None
    elif exercise_id == "legacy:bench prone w into y":
        match = re.search(r"(\d+)deg bench", comment)
        if not match:
            raise ValueError("Unexpected bench prone W into Y source")
        angle = int(match.group(1))
    elif exercise_id == "seed:0042" and comment.startswith("Bench at "):
        match = re.search(r"Bench at (\d+)", comment)
        angle = int(match.group(1)) if match else None
    if exercise_id in ("seed:0038", "legacy:bench prone w into y") or angle is not None:
        record["params"] = {"setup": ["angle"], "perSet": params}
        record["setup"] = {"angle": angle}
    else:
        record["params"] = {"perSet": params}

    for row in sets:
        for key in ("weight", "reps"):
            if key not in params:
                row.pop(key, None)
        if any(key not in params for key in ("height", "edge", "distance", "time") if key in row):
            raise ValueError("Value outside selected parameters")


def session_log_rows(doc, names):
    rows = []
    for event in doc["events"]:
        for entry in event["entries"]:
            if entry["kind"] != "session":
                continue
            session = entry["session"]
            for section in ("warmup", "main", "cooldown"):
                for item in session[section]:
                    for record in ([item] if item["kind"] == "exercise" else item["members"]):
                        if item["kind"] == "exercise":
                            sets = [{k: v for k, v in row.items() if k != "id"} for row in item["sets"]]
                        else:
                            sets = [{**round_, **{key: result.get(key) for key in record["params"]["perSet"]}}
                                    for round_ in item["rounds"]
                                    for result in item["results"]
                                    if result["memberId"] == record["id"] and result["roundId"] == round_["id"]]
                        detail = {"params": record["params"]}
                        if record.get("setup"):
                            detail["setup"] = record["setup"]
                        detail.update(sets=sets, superset=item["kind"] == "superset")
                        rows.append({"section": section, "exercise_id": record["exerciseId"],
                                     "name": names[record["exerciseId"]], "detail": detail})
    return rows


def update_sql(date, old_raw, old_stamp, doc, new_stamp, names):
    def q(value):
        return "'" + value.replace("'", "''") + "'"

    new_raw = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
    guard = f"EXISTS (SELECT 1 FROM days WHERE date = {q(date)} AND updated_at = {q(new_stamp)})"
    statements = [
        f"UPDATE days SET doc = {q(new_raw)}, updated_at = {q(new_stamp)} "
        f"WHERE date = {q(date)} AND doc = {q(old_raw)} AND updated_at = {q(old_stamp)};",
        "SELECT changes() AS day_changes;",
    ]
    if any(row["exercise_id"] == "legacy:pull-up hold" for row in session_log_rows(doc, names)):
        statements.extend([
            f"INSERT OR IGNORE INTO exercise_catalog (id, name, name_key) "
            f"SELECT 'legacy:pull-up hold', 'Pull-up hold', 'pull-up hold' WHERE {guard};",
            f"INSERT OR IGNORE INTO exercise_params (exercise_id, params, updated_at) "
            f"SELECT 'legacy:pull-up hold', '{{\"perSet\":[\"weight\",\"time\"]}}', "
            f"{q(new_stamp.split('Z:')[0] + 'Z' if 'Z:' in new_stamp else new_stamp)} WHERE {guard};",
        ])
    statements.append(f"DELETE FROM exercise_log WHERE date = {q(date)} AND section != 'activity' AND {guard};")
    for order, row in enumerate(session_log_rows(doc, names)):
        name = row["name"]
        detail = json.dumps(row["detail"], ensure_ascii=False, separators=(",", ":"))
        values = ", ".join(q(value) for value in (date, row["section"], name, " ".join(name.lower().split()), detail))
        statements.append(
            "INSERT INTO exercise_log (date, section, name, name_key, detail, ord, exercise_id) "
            f"SELECT {values}, {order}, {q(row['exercise_id'])} WHERE {guard};"
        )
    return "\n".join(statements) + "\n"

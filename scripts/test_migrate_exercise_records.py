import copy
import unittest

from migrate_exercise_records import convert_day, session_log_rows


def day(date, items):
    return {
        "v": 7, "date": date, "totalCalories": None,
        "ignoredGarminSourceKeys": [], "comments": [],
        "events": [{"id": "event", "title": None, "notes": "", "entries": [
            {"kind": "session", "session": {
                "id": "session", "startedAt": "2026-09-25T10:00:00.000Z",
                "endedAt": None, "calories": None, "notes": "",
                "warmup": [], "main": items, "cooldown": [],
            }},
        ]}],
    }


class RecordConversionTest(unittest.TestCase):
    def test_hangboard_rounds_and_original_comment(self):
        member = {"id": "hang", "exerciseId": "seed:0079", "comment": "40s density hangs warmup, then 15s 20mm edge"}
        item = {"kind": "superset", "id": "group", "members": [member],
                "rounds": [{"id": str(n), "type": "working"} for n in range(4)],
                "results": [{"memberId": "hang", "roundId": str(n), "weight": None, "reps": 3} for n in range(4)]}
        original = day("2026-09-25", [item])
        saved = copy.deepcopy(original)
        result = convert_day(saved)
        self.assertEqual(original["v"], 7)
        self.assertEqual(result["v"], 8)
        converted = result["events"][0]["entries"][0]["session"]["main"][0]
        self.assertEqual(converted["members"][0]["comment"], member["comment"])
        self.assertEqual(converted["members"][0]["params"], {"perSet": ["edge", "time", "reps"]})
        self.assertEqual([(r["edge"], r["time"], r["reps"]) for r in converted["results"]],
                         [(None, 40, 3), (20, 15, 3), (20, 15, 3), (20, 15, 3)])
        self.assertTrue(all("weight" not in r for r in converted["results"]))
        self.assertEqual(session_log_rows(result, {"seed:0079": "Hangboard"})[0]["detail"]["sets"][0]["time"], 40)

    def test_box_height_and_bench_angle_are_per_record(self):
        pike = {"kind": "exercise", "id": "pike", "exerciseId": "seed:0121", "comment": '20" box warmup, 24" working set',
                "sets": [{"id": str(n), "type": "warmup" if n == 0 else "working", "weight": None, "reps": 6 if n == 0 else 5} for n in range(4)]}
        bench = {"kind": "exercise", "id": "bench", "exerciseId": "seed:0038", "comment": "50deg bench",
                 "sets": [{"id": "1", "type": "working", "weight": 45, "reps": 4}]}
        result = convert_day(day("2026-09-28", [pike, bench]))
        pike, bench = result["events"][0]["entries"][0]["session"]["main"]
        self.assertEqual([s["height"] for s in pike["sets"]], [20, 24, 24, 24])
        self.assertEqual(bench["setup"], {"angle": 50})
        self.assertEqual(bench["params"], {"setup": ["angle"], "perSet": ["weight", "reps"]})

    def test_bodyweight_hold_becomes_a_distinct_exercise(self):
        hold = {"kind": "exercise", "id": "hold", "exerciseId": "seed:0048", "comment": "30s",
                "sets": [{"id": "1", "type": "warmup", "weight": None, "reps": None}]}
        result = convert_day(day("2026-09-24", [hold]))
        record = result["events"][0]["entries"][0]["session"]["main"][0]
        self.assertEqual(record["exerciseId"], "legacy:pull-up hold")
        self.assertEqual(record["params"], {"perSet": ["weight", "time"]})
        self.assertEqual(record["sets"][0]["weight"], 0)
        self.assertEqual(record["sets"][0]["time"], 30)
        self.assertEqual(record["comment"], "30s")


if __name__ == "__main__":
    unittest.main()

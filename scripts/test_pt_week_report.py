import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).parent / "pt_week_report.py"


def squat_day(started_at, kg, **extra):
    session = {
        "startedAt": started_at, "endedAt": None, "warmup": [], "cooldown": [],
        "main": [{"kind": "exercise", "exerciseId": "squat", "comment": "",
                  "sets": [{"type": "working", "weight": kg, "reps": 5}]}],
    }
    return {"events": [{"title": None, "entries": [{"kind": "session", "session": session}]}],
            "comments": [], "totalCalories": None, **extra}


def build(days, *args):
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        rows = [{"date": date, "doc": json.dumps(doc)} for date, doc in days.items()]
        (tmp / "days.json").write_text(json.dumps([{"results": rows}]))
        (tmp / "log.json").write_text(json.dumps([{"results": [{"exercise_id": "squat", "name": "Back squat"}]}]))
        subprocess.run([sys.executable, "-I", SCRIPT, tmp / "days.json", tmp / "log.json", tmp / "out.html", *args],
                       check=True, capture_output=True)
        page = (tmp / "out.html").read_text()
    return page, json.loads(re.search(r"^const D = (.*);$", page, re.M).group(1))


class PtWeekReportTest(unittest.TestCase):
    def setUp(self):
        back = [{"time": "08:00", "text": "", "score": {"metric": "Back", "value": 2}}]
        self.page, self.data = build({
            "2026-10-01": squat_day("2026-09-30T22:00:00.000Z", 50),
            "2026-10-31": squat_day("2026-10-30T22:00:00.000Z", 60, comments=back),
            "2026-11-03": squat_day("2026-11-02T22:00:00.000Z", 70),
        }, "--from", "2026-10-31", "--to", "2026-11-02", "--pt", "2026-10-31", "--note", "Test note.")

    def test_week_spans_months_and_tags_pt_days(self):
        week = self.data["week"]
        self.assertEqual([d["date"] for d in week], ["2026-10-31", "2026-11-01", "2026-11-02"])
        self.assertEqual([d["pt"] for d in week], [True, False, False])

    def test_session_time_and_back_score_come_from_the_day(self):
        day = self.data["week"][0]
        self.assertEqual(day["sessions"][0]["t"], "09:00")
        self.assertEqual(day["pain"], [2])

    def test_history_keeps_earlier_days_and_stops_at_the_last_day(self):
        self.assertEqual([row[0] for row in self.data["ex"]["squat"]["h"]], ["2026-10-01", "2026-10-31"])

    def test_page_names_the_range_and_fits_every_day(self):
        self.assertIn("<title>Training Week 31 Oct–2 Nov</title>", self.page)
        self.assertIn("Saturday 31 October to Monday 2 November 2026: Test note.", self.page)
        self.assertIn("repeat(3, minmax(0, 1fr))", self.page)
        self.assertNotRegex(self.page, r"__[A-Z]+__")


if __name__ == "__main__":
    unittest.main()

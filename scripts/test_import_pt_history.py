import pathlib
import re
import unittest

from import_pt_history import EXERCISES, PARAM_ORDER, build, parse_blocks

EXPORT = """\
13-Nov-25 22:04 Hours: 1.00 (unbilled)  Meeting type: in-person

Trap bar DL- 110-3x6
BB S- 80- 2x3 x

17-May-23 00:08 Hours: 1.00 (unbilled)  Meeting type: in-person

Sled push 35 kg x 4 laps/push ups x 10 x 2 rounds

17-May-23 00:08 Hours: 1.00 (unbilled)  Meeting type: in-person

Copy of the note above

21-Dec-22 09:55 Hours: 1.00 (unbilled)  Meeting type: in-person

Deload

15-Jan-26 10:38 Hours: 1.00 (unbilled)  Meeting type: in-person

2026 bench mark exercises
"""

DSL = """\
@ 13-Nov-25 22:04
Trap bar deadlift: 110/6*3
Back squat: w:60/5, 80/3*2, 80/0 | third set failed
[cooldown]
Wall sit: 1:49

@ 17-May-23 00:08
= 2 | 20 kg vest
  Sled push: 35/4 | laps
  Push-up: 0/10, 0/8

@ 17-May-23 00:08 #2
!skip duplicate of the note above

@ 21-Dec-22 09:55

@ 15-Jan-26 10:38
!comment
"""


def session(day):
    return day["doc"]["events"][0]["entries"][0]["session"]


class ImportTest(unittest.TestCase):
    def setUp(self):
        self.out = build(EXPORT, parse_blocks(DSL))
        self.days = {day["date"]: day for day in self.out["days"]}

    def test_sets_expand_with_types_and_values_in_parameter_order(self):
        main = session(self.days["2025-11-13"])["main"]
        self.assertEqual(main[0]["exerciseId"], "seed:0062")
        self.assertEqual(main[0]["params"], {"perSet": ["weight", "reps"]})
        self.assertEqual([(s["type"], s["weight"], s["reps"]) for s in main[0]["sets"]],
                         [("working", 110, 6)] * 3)
        squat = main[1]
        self.assertEqual([(s["type"], s["weight"], s["reps"]) for s in squat["sets"]],
                         [("warmup", 60, 5), ("working", 80, 3), ("working", 80, 3), ("working", 80, 0)])
        self.assertEqual(squat["comment"], "third set failed")
        cooldown = session(self.days["2025-11-13"])["cooldown"]
        self.assertEqual(cooldown[0]["sets"][0]["time"], 109)
        self.assertNotIn("weight", cooldown[0]["sets"][0])

    def test_superset_spreads_one_value_or_one_value_per_round(self):
        item = session(self.days["2023-05-16"])["main"][0]
        self.assertEqual(item["kind"], "superset")
        self.assertEqual(len(item["rounds"]), 2)
        sled, push = item["members"]
        self.assertEqual(sled["comment"], "20 kg vest; laps")
        self.assertEqual(push["comment"], "20 kg vest")
        rows = lambda member: [(r["weight"], r["reps"]) for round_ in item["rounds"]
                               for r in item["results"] if r["memberId"] == member["id"] and r["roundId"] == round_["id"]]
        self.assertEqual(rows(sled), [(35, 4), (35, 4)])
        self.assertEqual(rows(push), [(0, 10), (0, 8)])

    def test_dates_follow_the_note_with_early_morning_notes_on_the_previous_day(self):
        self.assertIn("2023-05-16", self.days)
        start = session(self.days["2023-05-16"])["startedAt"]
        self.assertEqual(start, "2023-05-16T00:00:00.000Z")  # 10:00 in Sydney
        self.assertEqual(session(self.days["2023-05-16"])["endedAt"], "2023-05-16T01:00:00.000Z")
        self.assertEqual(session(self.days["2022-12-21"])["startedAt"], "2022-12-20T21:55:00.000Z")

    def test_raw_note_is_kept_and_notes_without_exercises_still_record_a_session(self):
        deload = session(self.days["2022-12-21"])
        self.assertIn("Deload", deload["notes"])
        self.assertEqual(deload["main"], [])
        self.assertIn("Trap bar DL- 110-3x6", session(self.days["2025-11-13"])["notes"])

    def test_comment_directive_records_a_timed_day_comment(self):
        day = self.days["2026-01-15"]["doc"]
        self.assertEqual(day["events"], [])
        self.assertEqual(day["comments"][0]["time"], "10:38")
        self.assertIn("bench mark", day["comments"][0]["text"])

    def test_new_exercises_get_stable_ids_and_their_parameters(self):
        again = build(EXPORT, parse_blocks(DSL))
        self.assertEqual(again, self.out)
        sled = next(e for e in self.out["exercises"] if e["name"] == "Sled push")
        self.assertTrue(sled["new"])
        self.assertRegex(sled["id"], r"^[0-9a-f-]{36}$")
        self.assertEqual(sled["params"], {"perSet": ["weight", "reps"]})

    def test_every_note_must_be_transcribed_once(self):
        with self.assertRaisesRegex(ValueError, "21-Dec-22 09:55"):
            build(EXPORT, parse_blocks(DSL.replace("@ 21-Dec-22 09:55\n", "")))

    def test_unknown_names_and_wrong_value_counts_name_their_line(self):
        with self.assertRaisesRegex(ValueError, "line 2: unknown exercise 'Trap DL'"):
            parse_blocks("@ 13-Nov-25 22:04\nTrap DL: 110/6\n")
        with self.assertRaisesRegex(ValueError, "line 2: expected weight/reps"):
            parse_blocks("@ 13-Nov-25 22:04\nTrap bar deadlift: 110\n")
        with self.assertRaisesRegex(ValueError, "line 2: band must be 0-5"):
            parse_blocks("@ 13-Nov-25 22:04\nBand-assisted muscle-up: 6/5\n")

    def test_merge_directive_returns_items_for_an_existing_day(self):
        export = "24-Sep-26 10:13 Hours: 1.00 (unbilled)  Meeting type: in-person\n\nChins +15\n"
        out = build(export, parse_blocks("@ 24-Sep-26 10:13\n!merge\nChin-up: 15/4*3\n"))
        self.assertEqual(out["days"], [])
        self.assertEqual(out["merges"][0]["date"], "2026-09-24")
        self.assertEqual(out["merges"][0]["main"][0]["sets"][0]["weight"], 15)
        self.assertIn("Chins +15", out["merges"][0]["notes"])


class CatalogTest(unittest.TestCase):
    def test_seed_ids_match_seed_names_and_new_names_do_not_shadow_seeds(self):
        source = (pathlib.Path(__file__).parent.parent / "shared/exercises/seed.ts").read_text()
        seeds = dict(re.findall(r'\["(seed:\d{4})", "([^"]+)"', source))
        seed_keys = {name.lower() for name in seeds.values()}
        for name, (exercise_id, params) in EXERCISES.items():
            if exercise_id and exercise_id.startswith("seed:"):
                self.assertEqual(seeds[exercise_id], name)
            elif exercise_id is None:
                self.assertNotIn(name.lower(), seed_keys)
            self.assertEqual(list(params), [key for key in PARAM_ORDER if key in params], name)


if __name__ == "__main__":
    unittest.main()

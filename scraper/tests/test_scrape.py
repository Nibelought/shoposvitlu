import sys
import unittest
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import scrape  # noqa: E402

FIXTURE = (HERE / "fixture_outage.html").read_text(encoding="utf-8")
TODAY = date(2026, 11, 7)


class ParseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.entries = scrape.parse_page(FIXTURE, TODAY)
        cls.days = scrape.newest_per_date(cls.entries)

    def test_skips_posts_without_queue_schedule(self):
        ids = {e["postId"] for e in self.entries}
        self.assertNotIn(392801, ids)  # empty post
        self.assertNotIn(392655, ids)  # business-only notice

    def test_dates_found(self):
        self.assertEqual(
            sorted(self.days),
            ["2026-10-26", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"],
        )

    def test_full_day(self):
        d = self.days["2026-11-07"]
        self.assertEqual(d["postId"], 392885)
        self.assertEqual(set(d["queues"]), set(scrape.QUEUES))
        self.assertEqual(d["queues"]["1.1"], ["00:00-02:00", "06:00-11:00", "15:00-20:00"])
        self.assertEqual(d["queues"]["2.2"][-1], "22:30-24:00")
        self.assertEqual(len(d["notes"]), 2)
        self.assertIn("ГОП", d["notes"][0])

    def test_newest_update_wins(self):
        d = self.days["2026-11-05"]
        self.assertEqual(d["postId"], 392873)
        self.assertEqual(d["updatedAt"], "21:25")
        self.assertEqual(d["queues"]["1.2"][0], "00:00-00:30")

    def test_partial_day_leaves_other_queues_empty(self):
        # The original 3 Nov post (392766) lists only 8 of the 12 queues.
        d = next(e for e in self.entries if e["postId"] == 392766)
        self.assertEqual(set(d["queues"]), set(scrape.QUEUES))
        self.assertEqual(sum(1 for q in scrape.QUEUES if d["queues"][q]), 8)
        self.assertEqual(d["queues"]["1.1"], [])
        self.assertEqual(d["queues"]["1.2"], ["12:00-16:00"])

    def test_time_is_not_mistaken_for_date(self):
        # "(оновлено 21:25)" must not be parsed as a day number
        for e in self.entries:
            self.assertIn(e["date"][:4], ("2026",))


class YearInferenceTests(unittest.TestCase):
    def test_year_rollover(self):
        self.assertEqual(scrape.infer_date(2, 1, date(2026, 12, 31)), date(2027, 1, 2))
        self.assertEqual(scrape.infer_date(30, 12, date(2027, 1, 2)), date(2026, 12, 30))

    def test_invalid_date(self):
        self.assertIsNone(scrape.infer_date(31, 2, date(2026, 1, 1)))


class MergeTests(unittest.TestCase):
    def test_keeps_old_days_and_prunes_ancient(self):
        existing = {"days": {"2026-11-01": {"postId": 1}, "2025-01-01": {"postId": 2}}}
        scraped = {"2026-11-07": {"date": "2026-11-07", "postId": 9, "queues": {}}}
        merged = scrape.merge(existing, scraped, TODAY)
        self.assertEqual(sorted(merged["days"]), ["2026-11-01", "2026-11-07"])
        self.assertNotIn("date", merged["days"]["2026-11-07"])

    def test_older_post_does_not_overwrite_newer(self):
        existing = {"days": {"2026-11-07": {"postId": 10, "marker": "keep"}}}
        scraped = {"2026-11-07": {"date": "2026-11-07", "postId": 5}}
        merged = scrape.merge(existing, scraped, TODAY)
        self.assertEqual(merged["days"]["2026-11-07"]["marker"], "keep")


if __name__ == "__main__":
    unittest.main()

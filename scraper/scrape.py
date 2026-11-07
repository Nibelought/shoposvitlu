#!/usr/bin/env python3
"""Scrape power-outage schedules (ГПВ) from https://www.zoe.com.ua/outage/.

The source publishes one WordPress post per update, newest first. The target
date only appears in the post title ("7 ЛИСТОПАДА ПО ЗАПОРІЗЬКІЙ ОБЛАСТІ ..."),
so the year is inferred from the date the scraper runs. For every target date
the newest post wins. Results are merged into data/schedules.json so days that
scroll off the first page of the source are kept.

Standard library only.
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

SOURCE_URL = "https://www.zoe.com.ua/outage/"
PAGES_TO_FETCH = 2
KEEP_DAYS = 60
USER_AGENT = "ShoPoSvitlu/1.0 (+https://github.com/Nibelought/shoposvitlu)"
KYIV = ZoneInfo("Europe/Kyiv")

QUEUES = [f"{n}.{s}" for n in range(1, 7) for s in (1, 2)]

MONTHS = {
    "СІЧНЯ": 1, "ЛЮТОГО": 2, "БЕРЕЗНЯ": 3, "КВІТНЯ": 4, "ТРАВНЯ": 5, "ЧЕРВНЯ": 6,
    "ЛИПНЯ": 7, "СЕРПНЯ": 8, "ВЕРЕСНЯ": 9, "ЖОВТНЯ": 10, "ЛИСТОПАДА": 11, "ГРУДНЯ": 12,
}

ARTICLE_RE = re.compile(r'<article id="post-(\d+)">(.*?)</article>', re.S)
TITLE_RE = re.compile(r"<h2>(.*?)</h2>", re.S)
CONTENT_RE = re.compile(r'<div class="content">(.*?)</div>', re.S)
DATE_RE = re.compile(r"(\d{1,2})\s+(" + "|".join(MONTHS) + r")", re.I)
UPDATED_RE = re.compile(r"оновлено\s+(\d{1,2}:\d{2})", re.I)
QUEUE_LINE_RE = re.compile(r"^\s*([1-6])\.([12])\s*:\s*(.*)$")
INTERVAL_RE = re.compile(r"(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})")


def fetch(url: str, retries: int = 3) -> str:
    last: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except Exception as exc:  # noqa: BLE001 - report and retry any network error
            last = exc
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"failed to fetch {url}: {last}")


def to_text(fragment: str) -> str:
    """HTML fragment -> plain text with line breaks preserved."""
    s = re.sub(r"<br\s*/?>", "\n", fragment, flags=re.I)
    s = re.sub(r"</p\s*>", "\n\n", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s).replace("\xa0", " ")
    return s.strip()


def hhmm(h: str, m: str) -> str:
    return f"{int(h):02d}:{m}"


def infer_date(day: int, month: int, today: date) -> date | None:
    """Pick the year that puts the date closest to `today`."""
    best: date | None = None
    for year in (today.year - 1, today.year, today.year + 1):
        try:
            cand = date(year, month, day)
        except ValueError:
            continue
        if best is None or abs((cand - today).days) < abs((best - today).days):
            best = cand
    return best


def parse_article(post_id: int, inner: str, today: date) -> dict | None:
    """Return a day entry for one post, or None if it carries no queue schedule."""
    title_m = TITLE_RE.search(inner)
    content_m = CONTENT_RE.search(inner)
    if not title_m or not content_m:
        return None
    title = to_text(title_m.group(1))
    body = to_text(content_m.group(1))

    queues: dict[str, list[str]] = {}
    last_queue_line = -1
    lines = body.split("\n")
    for i, line in enumerate(lines):
        m = QUEUE_LINE_RE.match(line)
        if not m:
            continue
        intervals = [
            f"{hhmm(a, b)}-{hhmm(c, d)}" for a, b, c, d in INTERVAL_RE.findall(m.group(3))
        ]
        queues[f"{m.group(1)}.{m.group(2)}"] = intervals
        last_queue_line = i
    if not queues:
        return None  # e.g. "ДО УВАГИ ПРОМИСЛОВОСТІ ТА БІЗНЕСУ" or an empty post

    # Target date: title first, then the body.
    dm = DATE_RE.search(title) or DATE_RE.search(body)
    if not dm:
        return None
    target = infer_date(int(dm.group(1)), MONTHS[dm.group(2).upper()], today)
    if target is None:
        return None

    # Notes = paragraphs after the schedule block (ГОП, forecast for tomorrow...).
    tail = "\n".join(lines[last_queue_line + 1:])
    notes = [re.sub(r"\s+", " ", p).strip() for p in re.split(r"\n\s*\n", tail)]
    notes = [p for p in notes if p]

    um = UPDATED_RE.search(title)
    return {
        "date": target.isoformat(),
        "postId": post_id,
        "title": title,
        "updatedAt": um.group(1) if um else None,
        "queues": {q: queues.get(q, []) for q in QUEUES},
        "notes": notes,
    }


def parse_page(page_html: str, today: date) -> list[dict]:
    out = []
    for post_id, inner in ARTICLE_RE.findall(page_html):
        entry = parse_article(int(post_id), inner, today)
        if entry:
            out.append(entry)
    return out


def newest_per_date(entries: list[dict]) -> dict[str, dict]:
    best: dict[str, dict] = {}
    for e in entries:
        cur = best.get(e["date"])
        if cur is None or e["postId"] > cur["postId"]:
            best[e["date"]] = e
    return best


def merge(existing: dict, scraped: dict[str, dict], today: date) -> dict:
    days = dict(existing.get("days", {}))
    for key, entry in scraped.items():
        old = days.get(key)
        if old is None or entry["postId"] >= old.get("postId", 0):
            days[key] = {k: v for k, v in entry.items() if k != "date"}
    cutoff = (today - timedelta(days=KEEP_DAYS)).isoformat()
    days = {k: v for k, v in sorted(days.items()) if k >= cutoff}
    return {"source": SOURCE_URL, "days": days}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default="data/schedules.json")
    ap.add_argument("--meta", default="data/meta.json")
    ap.add_argument("--from-file", help="parse a saved HTML file instead of fetching")
    args = ap.parse_args(argv)

    now = datetime.now(timezone.utc)
    today = now.astimezone(KYIV).date()

    if args.from_file:
        pages = [Path(args.from_file).read_text(encoding="utf-8")]
    else:
        pages = []
        for n in range(1, PAGES_TO_FETCH + 1):
            url = SOURCE_URL if n == 1 else f"{SOURCE_URL}page/{n}/"
            try:
                pages.append(fetch(url))
            except RuntimeError as exc:
                if n == 1:
                    print(exc, file=sys.stderr)
                    return 1
                print(f"warning: {exc}", file=sys.stderr)

    entries = [e for p in pages for e in parse_page(p, today)]
    if not entries:
        print("error: no schedules found - the page layout may have changed", file=sys.stderr)
        return 1
    scraped = newest_per_date(entries)

    out_path = Path(args.out)
    existing = json.loads(out_path.read_text("utf-8")) if out_path.exists() else {}
    merged = merge(existing, scraped, today)

    new_text = json.dumps(merged, ensure_ascii=False, indent=1) + "\n"
    if not out_path.exists() or out_path.read_text("utf-8") != new_text:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(new_text, encoding="utf-8")
        print(f"updated {out_path}: {len(merged['days'])} days")
    else:
        print("no changes")

    # Last successful check; deployed with the site but not committed.
    meta_path = Path(args.meta)
    meta_path.parent.mkdir(parents=True, exist_ok=True)
    meta_path.write_text(json.dumps({"checkedAt": now.isoformat(timespec="seconds")}) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())

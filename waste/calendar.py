"""Privacy-safe parsing and selection for official iCalendar collection feeds."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any


WASTE_TYPES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("rest", "Restmüll", ("restmüll", "restmuell", "restabfall")),
    ("bio", "Biomüll", ("biotonne", "biomüll", "biomuell", "bioabfall")),
    ("paper", "Papier", ("papier", "papiertonne", "altpapier")),
    ("yellow", "Gelber Sack", ("gelber sack", "gelbe tonne", "leichtverpack")),
)


def _unfold_ical_lines(content: str) -> list[str]:
    lines: list[str] = []
    for raw_line in content.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if raw_line.startswith((" ", "\t")) and lines:
            lines[-1] += raw_line[1:]
        else:
            lines.append(raw_line)
    return lines


def _waste_type(summary: str) -> tuple[str, str] | None:
    normalized = summary.casefold().strip()
    for key, label, needles in WASTE_TYPES:
        if any(needle in normalized for needle in needles):
            return key, label
    return None


def parse_collection_calendar(content: str) -> list[dict[str, Any]]:
    """Return supported collection events without exposing their street location."""
    events: list[dict[str, Any]] = []
    current: dict[str, str] | None = None
    for line in _unfold_ical_lines(content):
        if line == "BEGIN:VEVENT":
            current = {}
            continue
        if line == "END:VEVENT":
            if current is not None:
                kind = _waste_type(current.get("SUMMARY", ""))
                raw_date = current.get("DTSTART", "")[:8]
                try:
                    collection_date = datetime.strptime(raw_date, "%Y%m%d").date()
                except ValueError:
                    collection_date = None
                if kind and collection_date is not None:
                    events.append({
                        "key": kind[0],
                        "label": kind[1],
                        "date": collection_date,
                    })
            current = None
            continue
        if current is None or ":" not in line:
            continue
        name, value = line.split(":", 1)
        current[name.split(";", 1)[0].upper()] = value.strip()
    return sorted(events, key=lambda item: (item["date"], item["label"]))


def next_collection_payload(
    events: list[dict[str, Any]],
    today: date,
) -> dict[str, Any]:
    """Select every supported waste type collected on the nearest date."""
    upcoming = [event for event in events if event["date"] >= today]
    if not upcoming:
        return {
            "available": False,
            "stale": False,
            "error": "Keine kommenden Abfuhrtermine im Kalender",
            "collection_date": None,
            "days_until": None,
            "is_today": False,
            "items": [],
        }

    next_date = min(event["date"] for event in upcoming)
    selected: list[dict[str, str]] = []
    seen: set[str] = set()
    for event in upcoming:
        if event["date"] != next_date or event["key"] in seen:
            continue
        seen.add(event["key"])
        selected.append({"key": event["key"], "label": event["label"]})

    days_until = (next_date - today).days
    return {
        "available": True,
        "stale": False,
        "error": None,
        "collection_date": next_date.isoformat(),
        "days_until": days_until,
        "is_today": days_until == 0,
        "items": selected,
    }

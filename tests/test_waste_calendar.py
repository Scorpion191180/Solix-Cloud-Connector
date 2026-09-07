import unittest
from datetime import date

from waste.calendar import next_collection_payload, parse_collection_calendar


SAMPLE_CALENDAR = """BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART;VALUE=DATE:20260918
LOCATION:Private address that must not be returned
SUMMARY;LANGUAGE=de:Biotonne
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20261001
SUMMARY;LANGUAGE=de:Restmüll
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20261001
SUMMARY;LANGUAGE=de:Gelber Sack
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20261002
SUMMARY;LANGUAGE=de:Gartenabfälle
END:VEVENT
END:VCALENDAR
"""


class WasteCalendarTests(unittest.TestCase):
    def test_parser_keeps_only_supported_types_and_omits_location(self):
        events = parse_collection_calendar(SAMPLE_CALENDAR)

        self.assertEqual([event["key"] for event in events], ["bio", "yellow", "rest"])
        self.assertNotIn("Private address", repr(events))

    def test_next_date_returns_every_collection_on_that_day(self):
        payload = next_collection_payload(
            parse_collection_calendar(SAMPLE_CALENDAR),
            date(2026, 9, 19),
        )

        self.assertTrue(payload["available"])
        self.assertEqual(payload["collection_date"], "2026-10-01")
        self.assertEqual(payload["days_until"], 12)
        self.assertEqual({item["key"] for item in payload["items"]}, {"rest", "yellow"})

    def test_today_is_identified(self):
        payload = next_collection_payload(
            parse_collection_calendar(SAMPLE_CALENDAR),
            date(2026, 9, 18),
        )

        self.assertTrue(payload["is_today"])
        self.assertEqual(payload["days_until"], 0)
        self.assertEqual(payload["items"], [{"key": "bio", "label": "Biomüll"}])


if __name__ == "__main__":
    unittest.main()

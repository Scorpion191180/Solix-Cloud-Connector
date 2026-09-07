"""Cached access to the household's official AWB iCalendar subscription."""

from __future__ import annotations

import asyncio
from datetime import datetime
import os
import time
from typing import Any
from zoneinfo import ZoneInfo

import certifi
import httpx

from waste.calendar import next_collection_payload, parse_collection_calendar


class WasteCalendarClient:
    """Fetch only the next collection date; never return the configured URL/address."""

    def __init__(self, calendar_url: str | None = None) -> None:
        self.calendar_url = (
            calendar_url if calendar_url is not None else os.getenv("WASTE_ICS_URL", "")
        ).strip()
        self.timezone = os.getenv("APP_TIMEZONE", "Europe/Berlin")
        try:
            self.cache_seconds = max(900, int(os.getenv("WASTE_CACHE_SECONDS", "21600")))
        except ValueError:
            self.cache_seconds = 21600
        self._last_fetch = 0.0
        self._last_events: list[dict[str, Any]] | None = None
        self._lock = asyncio.Lock()
        self._client: httpx.AsyncClient | None = None

    async def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                verify=certifi.where(),
                timeout=12,
                follow_redirects=True,
                headers={"User-Agent": "Solix-Cloud-Connector/1.0"},
            )
        return self._client

    def _today(self):
        try:
            zone = ZoneInfo(self.timezone)
        except Exception:
            zone = ZoneInfo("Europe/Berlin")
        return datetime.now(zone).date()

    def _decorate(self, payload: dict[str, Any], *, stale: bool = False) -> dict[str, Any]:
        result = dict(payload)
        result["stale"] = stale
        result["source"] = "AWB Landkreis Freudenstadt"
        return result

    async def _fetch_events(self) -> list[dict[str, Any]]:
        client = await self._ensure_client()
        response = await client.get(self.calendar_url)
        response.raise_for_status()
        return parse_collection_calendar(response.text)

    async def get_live(self) -> dict[str, Any]:
        if not self.calendar_url:
            return {
                "available": False,
                "stale": False,
                "error": "Abfallkalender ist nicht eingerichtet",
                "source": "AWB Landkreis Freudenstadt",
                "collection_date": None,
                "days_until": None,
                "is_today": False,
                "items": [],
            }

        async with self._lock:
            now = time.monotonic()
            if self._last_events is not None and now - self._last_fetch < self.cache_seconds:
                return self._decorate(
                    next_collection_payload(self._last_events, self._today())
                )
            try:
                events = await self._fetch_events()
                self._last_events = events
                self._last_fetch = now
                return self._decorate(next_collection_payload(events, self._today()))
            except Exception:
                if self._last_events is not None:
                    payload = next_collection_payload(self._last_events, self._today())
                    payload["error"] = "Abfallkalender vorübergehend nicht erreichbar"
                    return self._decorate(payload, stale=True)
                return {
                    "available": False,
                    "stale": True,
                    "error": "Abfallkalender vorübergehend nicht erreichbar",
                    "source": "AWB Landkreis Freudenstadt",
                    "collection_date": None,
                    "days_until": None,
                    "is_today": False,
                    "items": [],
                }

    async def close(self) -> None:
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()
        self._client = None

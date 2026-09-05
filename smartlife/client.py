"""Small, optional Tuya OpenAPI client for a Smart Life garage controller.

Nothing is sent unless every required environment variable is present and
garage control was explicitly enabled.  The device-specific command code and
values deliberately remain configuration: Smart Life garage modules expose
different data points and guessing one would be unsafe.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import time
from typing import Any
from urllib.parse import urlparse

import httpx


_ALLOWED_ENDPOINTS = {
    "https://openapi.tuyaeu.com",
    "https://openapi.tuyaus.com",
    "https://openapi-ueaz.tuyaus.com",
    "https://openapi-weaz.tuyaus.com",
    "https://openapi.tuyacn.com",
    "https://openapi.tuyain.com",
}


def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def _json_value(raw: str) -> Any:
    """Parse booleans/numbers/JSON while preserving ordinary enum strings."""
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return raw


class SmartLifeGarageClient:
    """Authenticated Tuya requests limited to the configured garage device."""

    def __init__(self, *, transport: httpx.AsyncBaseTransport | None = None) -> None:
        endpoint = os.getenv("TUYA_API_ENDPOINT", "https://openapi.tuyaeu.com").strip().rstrip("/")
        parsed = urlparse(endpoint)
        self.endpoint = endpoint if parsed.scheme == "https" and endpoint in _ALLOWED_ENDPOINTS else ""
        self.access_id = os.getenv("TUYA_ACCESS_ID", "").strip()
        self.access_secret = os.getenv("TUYA_ACCESS_SECRET", "").strip()
        self.device_id = os.getenv("TUYA_GARAGE_MIDDLE_DEVICE_ID", "").strip()
        self.command_code = os.getenv("TUYA_GARAGE_MIDDLE_COMMAND_CODE", "").strip()
        self.status_code = os.getenv("TUYA_GARAGE_MIDDLE_STATUS_CODE", "").strip()
        self.open_value_raw = os.getenv("TUYA_GARAGE_MIDDLE_OPEN_VALUE", "").strip()
        self.close_value_raw = os.getenv("TUYA_GARAGE_MIDDLE_CLOSE_VALUE", "").strip()
        self.enabled = _truthy(os.getenv("GARAGE_CONTROL_ENABLED"))
        self._transport = transport
        self._client: httpx.AsyncClient | None = None
        self._token = ""
        self._token_expires_at = 0.0
        self._token_lock = asyncio.Lock()

    @property
    def configured(self) -> bool:
        return bool(
            self.enabled
            and self.endpoint
            and self.access_id
            and self.access_secret
            and self.device_id
            and self.command_code
            and self.open_value_raw
            and self.close_value_raw
        )

    def public_status(self) -> dict[str, Any]:
        missing = []
        values = {
            "GARAGE_CONTROL_ENABLED": self.enabled,
            "TUYA_API_ENDPOINT": bool(self.endpoint),
            "TUYA_ACCESS_ID": bool(self.access_id),
            "TUYA_ACCESS_SECRET": bool(self.access_secret),
            "TUYA_GARAGE_MIDDLE_DEVICE_ID": bool(self.device_id),
            "TUYA_GARAGE_MIDDLE_COMMAND_CODE": bool(self.command_code),
            "TUYA_GARAGE_MIDDLE_OPEN_VALUE": bool(self.open_value_raw),
            "TUYA_GARAGE_MIDDLE_CLOSE_VALUE": bool(self.close_value_raw),
        }
        for name, present in values.items():
            if not present:
                missing.append(name)
        return {
            "provider": "Smart Life / Tuya",
            "configured": self.configured,
            "middle": {
                "configured": self.configured,
                "status": "unknown",
                "status_available": bool(self.status_code),
            },
            "left": {"configured": False, "status": "visual_only"},
            "missing_configuration": missing,
        }

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.endpoint or "https://openapi.tuyaeu.com",
                timeout=httpx.Timeout(12.0),
                transport=self._transport,
            )
        return self._client

    def _signed_headers(self, method: str, path: str, body: bytes, token: str = "") -> dict[str, str]:
        timestamp = str(int(time.time() * 1000))
        content_hash = hashlib.sha256(body).hexdigest()
        string_to_sign = f"{method.upper()}\n{content_hash}\n\n{path}"
        sign_payload = f"{self.access_id}{token}{timestamp}{string_to_sign}"
        signature = hmac.new(
            self.access_secret.encode("utf-8"),
            sign_payload.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest().upper()
        headers = {
            "client_id": self.access_id,
            "sign": signature,
            "sign_method": "HMAC-SHA256",
            "t": timestamp,
            "lang": "de",
        }
        if token:
            headers["access_token"] = token
        return headers

    async def _access_token(self) -> str:
        if self._token and time.time() < self._token_expires_at - 60:
            return self._token
        async with self._token_lock:
            if self._token and time.time() < self._token_expires_at - 60:
                return self._token
            path = "/v1.0/token?grant_type=1"
            response = await self._http().get(
                path,
                headers=self._signed_headers("GET", path, b""),
            )
            payload = self._validated_payload(response)
            result = payload.get("result") or {}
            token = str(result.get("access_token") or "")
            if not token:
                raise RuntimeError("Tuya hat kein Zugriffstoken geliefert")
            self._token = token
            self._token_expires_at = time.time() + max(120, int(result.get("expire_time") or 7200))
            return token

    @staticmethod
    def _validated_payload(response: httpx.Response) -> dict[str, Any]:
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict) or payload.get("success") is not True:
            message = payload.get("msg") if isinstance(payload, dict) else "ungültige Antwort"
            raise RuntimeError(f"Tuya-Anfrage fehlgeschlagen: {message}")
        return payload

    async def _request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        token = await self._access_token()
        body = b"" if payload is None else json.dumps(
            payload, ensure_ascii=False, separators=(",", ":")
        ).encode("utf-8")
        response = await self._http().request(
            method,
            path,
            content=body if body else None,
            headers={
                **self._signed_headers(method, path, body, token),
                **({"Content-Type": "application/json"} if body else {}),
            },
        )
        return self._validated_payload(response)

    async def get_middle_status(self) -> dict[str, Any]:
        result = self.public_status()
        if not self.configured or not self.status_code:
            return result
        payload = await self._request("GET", f"/v1.0/devices/{self.device_id}/status")
        rows = payload.get("result") or []
        value = next((row.get("value") for row in rows if row.get("code") == self.status_code), None)
        result["middle"]["raw_status"] = value
        result["middle"]["status"] = "open" if value == _json_value(self.open_value_raw) else (
            "closed" if value == _json_value(self.close_value_raw) else "unknown"
        )
        return result

    async def set_middle_open(self, opened: bool) -> dict[str, Any]:
        if not self.configured:
            raise RuntimeError("Smart-Life-Garagentor ist nicht vollständig eingerichtet")
        value = _json_value(self.open_value_raw if opened else self.close_value_raw)
        payload = await self._request(
            "POST",
            f"/v1.0/devices/{self.device_id}/commands",
            {"commands": [{"code": self.command_code, "value": value}]},
        )
        return {
            "ok": True,
            "provider": "Smart Life / Tuya",
            "door": "middle",
            "requested_state": "open" if opened else "closed",
            "accepted": bool(payload.get("result")),
        }

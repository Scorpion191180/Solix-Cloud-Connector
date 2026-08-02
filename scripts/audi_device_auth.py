#!/usr/bin/env python3
"""Create an Audi device authorization and store only its refresh token."""

from __future__ import annotations

import argparse
import asyncio
import os
import ssl
import stat
import sys
import time
from pathlib import Path

import aiohttp
import certifi

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from audi.vendor.audi_connect.api import AudiAPI
from audi.vendor.audi_connect.auth import AudiAuth


class MemoryTokenStore:
    """Keep the temporary full OAuth state out of the filesystem."""

    def load(self):
        return None

    def save(self, _state) -> None:
        return None

    def clear(self) -> None:
        return None


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--country", default="DE")
    parser.add_argument("--api-level", default=1, type=int)
    parser.add_argument("--token-output", required=True, type=Path)
    return parser.parse_args()


def write_secret(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value, encoding="utf-8")
    if os.name != "nt":
        path.chmod(stat.S_IRUSR | stat.S_IWUSR)


async def authorize(options: argparse.Namespace) -> None:
    ssl_context = ssl.create_default_context(cafile=certifi.where())
    async with aiohttp.ClientSession(
        connector=aiohttp.TCPConnector(ssl=ssl_context)
    ) as session:
        auth = AudiAuth(
            AudiAPI(session),
            country=options.country,
            api_level=options.api_level,
            token_store=MemoryTokenStore(),
        )
        device = await auth.request_device_code()
        verification_url = device.get("verification_uri_complete") or device.get(
            "verification_uri"
        )
        print(f"VERIFICATION_URL:{verification_url}", flush=True)
        print(f"USER_CODE:{device.get('user_code', '')}", flush=True)

        interval = max(5, int(device.get("interval", 5)))
        deadline = time.monotonic() + int(device.get("expires_in", 600))
        while time.monotonic() < deadline:
            await asyncio.sleep(interval)
            try:
                status, vehicles = await auth.poll_device_token(device["device_code"])
            except Exception:
                if auth.refresh_token:
                    write_secret(options.token_output, auth.refresh_token)
                    print("AUTHORIZED", flush=True)
                    return
                raise

            if status == "ok":
                if not auth.refresh_token:
                    raise RuntimeError("Audi returned no refresh token")
                write_secret(options.token_output, auth.refresh_token)
                print("AUTHORIZED", flush=True)
                print(f"VEHICLE_COUNT:{len(vehicles or [])}", flush=True)
                return
            if status == "slow_down":
                interval += 5
            elif status in {"expired", "denied", "error"}:
                raise RuntimeError(f"Audi device authorization ended with: {status}")

        raise TimeoutError("Audi device authorization expired")


if __name__ == "__main__":
    asyncio.run(authorize(arguments()))

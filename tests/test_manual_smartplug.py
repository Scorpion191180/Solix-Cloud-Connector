import os
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app import (
    ManualSmartPlugCommand,
    audi_client,
    charging_automation,
    client,
    manual_smartplug,
)


class ManualSmartPlugTests(unittest.IsolatedAsyncioTestCase):
    def settings(self):
        return patch.dict(
            os.environ,
            {
                "SMARTPLUG_MANUAL_CONTROL": "true",
                "SMARTPLUG_CONTROL_TOKEN": "correct-secret",
            },
            clear=False,
        )

    async def test_authorized_on_requires_connected_audi_and_safe_solix_soc(self):
        result = {
            "available": True,
            "name": "Smart Plug",
            "model": "A17X8",
            "state": True,
        }
        with (
            self.settings(),
            patch.object(
                audi_client,
                "get_live",
                AsyncMock(return_value={"available": True, "plug_connected": True}),
            ),
            patch.object(
                client,
                "get_live",
                AsyncMock(return_value={"battery_percent": 25}),
            ),
            patch.object(
                client,
                "set_smartplug_power",
                AsyncMock(return_value=result),
            ) as set_power,
            patch.object(charging_automation, "record_manual_result") as record,
        ):
            response = await manual_smartplug(
                ManualSmartPlugCommand(enabled=True), "correct-secret"
            )

        set_power.assert_awaited_once_with(True)
        record.assert_called_once_with(result, True)
        self.assertTrue(response["ok"])

    async def test_wrong_code_never_sends_command(self):
        with (
            self.settings(),
            patch.object(client, "set_smartplug_power", AsyncMock()) as set_power,
        ):
            with self.assertRaises(HTTPException) as error:
                await manual_smartplug(
                    ManualSmartPlugCommand(enabled=True), "wrong-secret"
                )

        self.assertEqual(error.exception.status_code, 401)
        set_power.assert_not_awaited()

    async def test_on_is_blocked_when_audi_is_disconnected(self):
        with (
            self.settings(),
            patch.object(
                audi_client,
                "get_live",
                AsyncMock(return_value={"available": True, "plug_connected": False}),
            ),
            patch.object(client, "set_smartplug_power", AsyncMock()) as set_power,
        ):
            with self.assertRaises(HTTPException) as error:
                await manual_smartplug(
                    ManualSmartPlugCommand(enabled=True), "correct-secret"
                )

        self.assertEqual(error.exception.status_code, 409)
        set_power.assert_not_awaited()

    async def test_on_is_blocked_when_solix_data_is_stale(self):
        with (
            self.settings(),
            patch.object(
                audi_client,
                "get_live",
                AsyncMock(return_value={"available": True, "plug_connected": True}),
            ),
            patch.object(
                client,
                "get_live",
                AsyncMock(return_value={"battery_percent": 80, "stale": True}),
            ),
            patch.object(client, "set_smartplug_power", AsyncMock()) as set_power,
        ):
            with self.assertRaises(HTTPException) as error:
                await manual_smartplug(
                    ManualSmartPlugCommand(enabled=True), "correct-secret"
                )

        self.assertEqual(error.exception.status_code, 409)
        self.assertIn("veralteten", error.exception.detail)
        set_power.assert_not_awaited()

    async def test_off_is_always_allowed_with_correct_code(self):
        result = {
            "available": True,
            "name": "Smart Plug",
            "model": "A17X8",
            "state": False,
        }
        with (
            self.settings(),
            patch.object(
                client,
                "set_smartplug_power",
                AsyncMock(return_value=result),
            ) as set_power,
            patch.object(charging_automation, "record_manual_result"),
        ):
            response = await manual_smartplug(
                ManualSmartPlugCommand(enabled=False), "correct-secret"
            )

        set_power.assert_awaited_once_with(False)
        self.assertFalse(response["requested_state"])


if __name__ == "__main__":
    unittest.main()

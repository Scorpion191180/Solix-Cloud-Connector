import os
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app import (
    AutomationSettingsUpdate,
    charging_automation,
    update_automation_settings,
)


class AutomationSettingsTests(unittest.IsolatedAsyncioTestCase):
    def settings(self):
        return patch.dict(
            os.environ,
            {
                "SMARTPLUG_MANUAL_CONTROL": "true",
                "SMARTPLUG_CONTROL_TOKEN": "correct-secret",
            },
            clear=False,
        )

    async def test_authorized_user_can_select_20_percent(self):
        updated_status = {"on_threshold_percent": 20}
        with (
            self.settings(),
            patch.object(
                charging_automation,
                "set_on_threshold",
                AsyncMock(return_value=updated_status),
            ) as set_threshold,
        ):
            response = await update_automation_settings(
                AutomationSettingsUpdate(on_threshold_percent=20),
                "correct-secret",
            )

        set_threshold.assert_awaited_once_with(20)
        self.assertTrue(response["ok"])
        self.assertEqual(response["on_threshold_percent"], 20)
        self.assertTrue(response["applies_on_next_evaluation"])

    async def test_wrong_code_does_not_change_threshold(self):
        with (
            self.settings(),
            patch.object(
                charging_automation,
                "set_on_threshold",
                AsyncMock(),
            ) as set_threshold,
        ):
            with self.assertRaises(HTTPException) as error:
                await update_automation_settings(
                    AutomationSettingsUpdate(on_threshold_percent=20),
                    "wrong-secret",
                )

        self.assertEqual(error.exception.status_code, 401)
        set_threshold.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()

import json
import os
import unittest
from contextlib import ExitStack
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import HTTPException

from app import GarageDoorCommand, garage_client, garage_middle
from smartlife.client import SmartLifeGarageClient


class SmartLifeClientTests(unittest.IsolatedAsyncioTestCase):
    def configuration(self):
        return patch.dict(os.environ, {
            "GARAGE_CONTROL_ENABLED": "true",
            "TUYA_ACCESS_ID": "client-id",
            "TUYA_ACCESS_SECRET": "client-secret",
            "TUYA_GARAGE_MIDDLE_DEVICE_ID": "door-device",
            "TUYA_GARAGE_MIDDLE_COMMAND_CODE": "door_control",
            "TUYA_GARAGE_MIDDLE_STATUS_CODE": "door_control",
            "TUYA_GARAGE_MIDDLE_OPEN_VALUE": "true",
            "TUYA_GARAGE_MIDDLE_CLOSE_VALUE": "false",
        }, clear=False)

    async def test_signed_command_uses_device_specific_code_and_value(self):
        requests = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            self.assertEqual(request.headers["sign_method"], "HMAC-SHA256")
            self.assertTrue(request.headers["sign"])
            if request.url.path == "/v1.0/token":
                return httpx.Response(200, json={
                    "success": True,
                    "result": {"access_token": "access-token", "expire_time": 7200},
                })
            return httpx.Response(200, json={"success": True, "result": True})

        with self.configuration():
            client = SmartLifeGarageClient(transport=httpx.MockTransport(handler))
            result = await client.set_middle_open(True)
            await client.close()

        self.assertTrue(result["ok"])
        self.assertEqual(len(requests), 2)
        command = requests[1]
        self.assertEqual(command.url.path, "/v1.0/devices/door-device/commands")
        self.assertEqual(command.headers["access_token"], "access-token")
        self.assertEqual(json.loads(command.content), {
            "commands": [{"code": "door_control", "value": True}]
        })

    def test_incomplete_configuration_never_becomes_active(self):
        with patch.dict(os.environ, {"GARAGE_CONTROL_ENABLED": "false"}, clear=True):
            client = SmartLifeGarageClient()

        status = client.public_status()
        self.assertFalse(client.configured)
        self.assertFalse(status["configured"])
        self.assertNotIn("client-secret", json.dumps(status).lower())


class GarageEndpointTests(unittest.IsolatedAsyncioTestCase):
    def configured_client(self):
        return (
            patch.object(garage_client, "enabled", True),
            patch.object(garage_client, "endpoint", "https://openapi.tuyaeu.com"),
            patch.object(garage_client, "access_id", "id"),
            patch.object(garage_client, "access_secret", "secret"),
            patch.object(garage_client, "device_id", "device"),
            patch.object(garage_client, "command_code", "door"),
            patch.object(garage_client, "open_value_raw", "true"),
            patch.object(garage_client, "close_value_raw", "false"),
        )

    async def test_wrong_control_code_does_not_send_garage_command(self):
        with ExitStack() as stack:
            for setting in self.configured_client():
                stack.enter_context(setting)
            stack.enter_context(patch.dict(
                os.environ, {"GARAGE_CONTROL_TOKEN": "correct"}, clear=False
            ))
            command = stack.enter_context(patch.object(
                garage_client, "set_middle_open", AsyncMock()
            ))
            with self.assertRaises(HTTPException) as error:
                await garage_middle(GarageDoorCommand(open=True), "wrong")

        self.assertEqual(error.exception.status_code, 401)
        command.assert_not_awaited()

    async def test_correct_control_code_sends_exact_requested_state(self):
        response = {"ok": True, "door": "middle", "requested_state": "open"}
        with ExitStack() as stack:
            for setting in self.configured_client():
                stack.enter_context(setting)
            stack.enter_context(patch.dict(
                os.environ, {"GARAGE_CONTROL_TOKEN": "correct"}, clear=False
            ))
            command = stack.enter_context(patch.object(
                garage_client, "set_middle_open", AsyncMock(return_value=response)
            ))
            result = await garage_middle(GarageDoorCommand(open=True), "correct")

        command.assert_awaited_once_with(True)
        self.assertEqual(result, response)


if __name__ == "__main__":
    unittest.main()

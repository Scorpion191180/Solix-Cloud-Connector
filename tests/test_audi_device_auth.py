import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from audi.vendor.audi_connect.oauth import AudiOAuth


class AudiDeviceAuthTests(unittest.IsolatedAsyncioTestCase):
    async def test_device_code_request_uses_discovered_endpoint(self):
        api = SimpleNamespace(
            use_token=lambda _value: None,
            set_xclient_id=lambda _value: None,
            request=AsyncMock(
                side_effect=[
                    {
                        "countries": {
                            "countrySpecifications": {
                                "DE": {"defaultLanguage": "de"}
                            }
                        }
                    },
                    {
                        "idkClientIDAndroidLive": "client-id",
                        "idkLoginServiceConfigurationURLProduction": "https://idk/config",
                    },
                    {
                        "token_endpoint": "https://idk/token",
                        "device_authorization_endpoint": "https://idk/device",
                    },
                    (
                        SimpleNamespace(cookies={}),
                        json.dumps(
                            {
                                "device_code": "device-code",
                                "user_code": "ABCD-EFGH",
                                "verification_uri": "https://idk/activate",
                            }
                        ),
                    ),
                ]
            ),
        )
        oauth = AudiOAuth(api, "DE")

        result = await oauth.request_device_code()

        self.assertEqual(result["device_code"], "device-code")
        request = api.request.await_args_list[3]
        self.assertEqual(request.args[1], "https://idk/device")
        self.assertNotIn("X-QMAuth", request.kwargs["headers"])

    async def test_pending_device_approval_is_not_an_error(self):
        api = SimpleNamespace(
            request=AsyncMock(
                return_value=(
                    SimpleNamespace(cookies={}),
                    json.dumps({"error": "authorization_pending"}),
                )
            )
        )
        oauth = AudiOAuth(api, "DE")
        oauth._device_context = {
            "client_id": "client-id",
            "token_endpoint": "https://idk/token",
        }

        status, tokens = await oauth.poll_device_token("device-code")

        self.assertEqual(status, "authorization_pending")
        self.assertIsNone(tokens)

    async def test_refresh_token_grant_does_not_use_attestation_header(self):
        api = SimpleNamespace(
            request=AsyncMock(
                return_value=(
                    SimpleNamespace(cookies={}),
                    json.dumps(
                        {
                            "access_token": "access",
                            "id_token": "id",
                            "refresh_token": "rotated",
                        }
                    ),
                )
            )
        )
        oauth = AudiOAuth(api, "DE")
        context = {
            "client_id": "client-id",
            "token_endpoint": "https://idk/token",
        }
        oauth._discover_endpoints = AsyncMock(return_value=context)
        oauth._finalize_session = AsyncMock(return_value={"session": "ok"})

        result = await oauth.login_with_refresh_token("refresh")

        self.assertEqual(result, {"session": "ok"})
        request = api.request.await_args
        self.assertNotIn("X-QMAuth", request.kwargs["headers"])
        self.assertIn("grant_type=refresh_token", request.args[2])


if __name__ == "__main__":
    unittest.main()

import os
import time
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from anker_solix_api.apitypes import API_HEADERS
from anker_solix_api.errors import AuthorizationError

from solix.client import SolixClient


class FakeMqttDevice:
    def __init__(self, result=None):
        self.result = result or {"ac_output_switch": 1}
        self.commands = []

    async def set_ac_output(self, enabled):
        self.commands.append(enabled)
        return self.result


class FakeRefreshApi:
    def __init__(self):
        self.calls = []

    async def update_sites(self):
        self.calls.append("sites")

    async def update_site_details(self):
        self.calls.append("site_details")

    async def update_device_details(self):
        self.calls.append("device_details")

    async def update_device_energy(self):
        self.calls.append("device_energy")


class AuthorizationFailingApi(FakeRefreshApi):
    async def update_sites(self):
        self.calls.append("sites")
        raise AuthorizationError("(401) token error")


class CloudFailingApi(FakeRefreshApi):
    async def update_sites(self):
        self.calls.append("sites")
        raise RuntimeError("cloud offline")


class LoginFailingApi(CloudFailingApi):
    def __init__(self):
        super().__init__()
        self.apisession = SimpleNamespace(get_login_info=lambda _key: None)


class FakeTelemetrySession:
    def __init__(self):
        self.topics = []

    def is_connected(self):
        return True

    def get_topic_prefix(self, deviceDict):
        return "dt/app/A17X8/SECRET-SERIAL/"

    def subscribe(self, topic):
        self.topics.append(topic)


class FakeTelemetryApi:
    def __init__(self, devices):
        self.devices = devices
        self.mqttsession = FakeTelemetrySession()
        self.merged = 0

    async def startMqttSession(self):
        return self.mqttsession

    def update_device_mqtt(self):
        self.merged += 1


class FakeTelemetryDevice:
    def __init__(self, device):
        self.device = device
        self.requests = 0

    async def status_request(self):
        self.requests += 1
        self.device.setdefault("mqtt_data", {}).update(
            {"power": 2318.4, "current": 10.08, "voltage": 230.0}
        )
        return {}


class FakeSolarbankTelemetryApi(FakeRefreshApi):
    def __init__(self, devices):
        super().__init__()
        self.devices = devices
        self.mqttsession = FakeTelemetrySession()
        self.merged = 0

    async def startMqttSession(self):
        return self.mqttsession

    def update_device_mqtt(self):
        self.merged += 1


class FakeSolarbankTelemetryDevice:
    def __init__(self):
        self.realtime_timeouts = []
        self.status_requests = 0

    async def realtime_trigger(self, timeout):
        self.realtime_timeouts.append(timeout)
        return {}

    async def status_request(self):
        self.status_requests += 1
        return {}


class SolixSmartPlugTests(unittest.IsolatedAsyncioTestCase):
    def make_client(self, devices):
        client = SolixClient()
        client.api = SimpleNamespace(devices=devices)
        client._last_refresh = time.monotonic()
        return client

    async def test_single_smartplug_is_selected_without_exposing_serial(self):
        client = self.make_client(
            {
                "SECRET-SERIAL": {
                    "type": "smartplug",
                    "device_pn": "A17X8",
                    "alias_name": "Wallbox",
                    "mqtt_data": {"ac_output_switch": 0},
                }
            }
        )

        status = await client.get_smartplug_status()

        self.assertEqual(
            status,
            {
                "available": True,
                "name": "Wallbox",
                "model": "A17X8",
                "state": False,
                "power_w": None,
                "current_a": None,
                "voltage_v": None,
                "measurement_source": None,
            },
        )
        self.assertNotIn("serial", status)

    async def test_smartplug_exposes_mqtt_power_current_and_voltage(self):
        client = self.make_client(
            {
                "SECRET-SERIAL": {
                    "type": "smartplug",
                    "device_pn": "A17X8",
                    "mqtt_data": {
                        "ac_output_switch": 1,
                        "power": 2274.6,
                        "current": 9.89,
                        "voltage": 230.1,
                    },
                    "current_power": "2100",
                }
            }
        )

        status = await client.get_smartplug_status()

        self.assertEqual(status["power_w"], 2274.6)
        self.assertEqual(status["current_a"], 9.89)
        self.assertEqual(status["voltage_v"], 230.1)
        self.assertEqual(status["measurement_source"], "mqtt")

    async def test_smartplug_uses_cloud_power_when_mqtt_has_no_measurement(self):
        client = self.make_client(
            {
                "SECRET-SERIAL": {
                    "type": "smartplug",
                    "device_pn": "A17X8",
                    "mqtt_data": {"ac_output_switch": 1},
                    "current_power": "2.3 kW",
                }
            }
        )

        status = await client.get_smartplug_status()

        self.assertEqual(status["power_w"], 2300)
        self.assertEqual(status["measurement_source"], "cloud")

    async def test_smartplug_requests_non_switching_live_telemetry(self):
        device = {
            "type": "smartplug",
            "device_pn": "A17X8",
            "device_sn": "SECRET-SERIAL",
            "mqtt_supported": True,
            "mqtt_data": {"ac_output_switch": 1},
        }
        client = SolixClient()
        client.api = FakeTelemetryApi({"SECRET-SERIAL": device})
        client._last_refresh = time.monotonic()
        telemetry_device = FakeTelemetryDevice(device)

        with (
            patch(
                "anker_solix_api.mqtt_factory.SolixMqttDeviceFactory"
            ) as factory,
            patch("solix.client.asyncio.sleep", new=AsyncMock()),
        ):
            factory.return_value.create_device.return_value = telemetry_device
            status = await client.get_smartplug_status()

        self.assertEqual(telemetry_device.requests, 1)
        self.assertEqual(
            client.api.mqttsession.topics,
            ["dt/app/A17X8/SECRET-SERIAL/#"],
        )
        self.assertEqual(client.api.merged, 1)
        self.assertEqual(status["power_w"], 2318.4)
        self.assertEqual(status["current_a"], 10.08)
        self.assertEqual(status["voltage_v"], 230)

    async def test_set_power_uses_supported_mqtt_device(self):
        client = self.make_client(
            {
                "SECRET-SERIAL": {
                    "type": "smartplug",
                    "device_pn": "A17X8",
                    "alias_name": "Wallbox",
                    "mqtt_data": {},
                }
            }
        )
        mqtt_device = FakeMqttDevice()

        with patch(
            "anker_solix_api.mqtt_factory.SolixMqttDeviceFactory"
        ) as factory:
            factory.return_value.create_device.return_value = mqtt_device
            status = await client.set_smartplug_power(True)

        self.assertEqual(mqtt_device.commands, [True])
        self.assertIs(status["state"], True)

    async def test_multiple_smartplugs_require_explicit_selection(self):
        client = self.make_client(
            {
                "ONE": {"type": "smartplug", "device_pn": "A17X8"},
                "TWO": {"type": "smartplug", "device_pn": "A17X8"},
            }
        )

        with self.assertRaisesRegex(RuntimeError, "Mehrere Smart Plugs"):
            await client.get_smartplug_status()

    async def test_live_refresh_skips_unused_energy_history(self):
        client = SolixClient()
        client.api = FakeRefreshApi()

        await client.refresh(force=True)

        self.assertEqual(
            client.api.calls,
            ["sites", "site_details", "device_details"],
        )

    async def test_live_refresh_actively_triggers_solarbank_telemetry(self):
        device = {
            "type": "solarbank",
            "device_pn": "A17C5",
            "mqtt_supported": True,
            "battery_soc": "42",
        }
        client = SolixClient()
        client.api = FakeSolarbankTelemetryApi({"SOLARBANK-SERIAL": device})
        telemetry_device = FakeSolarbankTelemetryDevice()

        with (
            patch(
                "anker_solix_api.mqtt_factory.SolixMqttDeviceFactory"
            ) as factory,
            patch("solix.client.asyncio.sleep", new=AsyncMock()),
        ):
            factory.return_value.create_device.return_value = telemetry_device
            await client.refresh(force=True)

        self.assertEqual(telemetry_device.realtime_timeouts, [75])
        self.assertEqual(telemetry_device.status_requests, 1)
        self.assertEqual(client.api.merged, 1)
        self.assertEqual(
            client.api.mqttsession.topics,
            ["dt/app/A17X8/SECRET-SERIAL/#"],
        )

    async def test_rejected_token_rebuilds_session_and_retries_once(self):
        client = SolixClient()
        rejected = AuthorizationFailingApi()
        recovered = FakeRefreshApi()
        client.api = rejected

        async def discard():
            client.api = None

        async def ensure():
            if client.api is None:
                client.api = recovered

        with (
            patch.object(client, "_discard_api_locked", AsyncMock(side_effect=discard)),
            patch.object(client, "_ensure_api_locked", AsyncMock(side_effect=ensure)),
        ):
            await client.refresh(force=True)

        self.assertEqual(rejected.calls, ["sites"])
        self.assertEqual(
            recovered.calls,
            ["sites", "site_details", "device_details"],
        )
        self.assertIsNone(client._last_refresh_error)

    async def test_discard_removes_rejected_tokens_from_library_headers(self):
        client = SolixClient()
        client.api = None
        client._session = None

        with patch.dict(
            API_HEADERS,
            {"x-auth-token": "REJECTED", "gtoken": "REJECTED-HASH"},
            clear=False,
        ):
            await client._discard_api_locked()

            self.assertNotIn("x-auth-token", API_HEADERS)
            self.assertNotIn("gtoken", API_HEADERS)

    async def test_failed_refresh_returns_last_valid_live_payload(self):
        devices = {
            "MAIN-SECRET": {
                "type": "solarbank",
                "device_pn": "AE103",
                "battery_soc": "42",
                "battery_energy": "4368",
                "battery_capacity": "10400",
                "solar_power_1": "210",
            }
        }
        client = self.make_client(devices)
        client._last_refresh_at = datetime.now(timezone.utc)
        fresh = await client.get_live()
        failing = CloudFailingApi()
        client.api = failing
        client._last_refresh = 0

        stale = await client.get_live()
        cached_again = await client.get_live()

        self.assertFalse(fresh["stale"])
        self.assertTrue(stale["stale"])
        self.assertEqual(stale["battery_percent"], 42)
        self.assertEqual(stale["pv1"], 210)
        self.assertIn("vorübergehend", stale["error"])
        self.assertEqual(failing.calls, ["sites"])
        self.assertTrue(cached_again["stale"])

    async def test_initial_failed_refresh_returns_safe_unavailable_payload(self):
        client = SolixClient()
        failing = CloudFailingApi()
        client.api = failing

        result = await client.get_live()

        self.assertTrue(result["stale"])
        self.assertIsNone(result["battery_percent"])
        self.assertIsNone(result["pv_total"])
        self.assertEqual(result["battery_flow_direction"], "unknown")
        self.assertIn("vorübergehend", result["error"])
        self.assertEqual(failing.calls, ["sites"])

    async def test_failed_fresh_login_uses_long_backoff_without_retries(self):
        client = SolixClient()
        rejected = AuthorizationFailingApi()
        fresh_login_rejected = AuthorizationFailingApi()
        client.api = rejected

        async def discard():
            client.api = None

        async def ensure():
            if client.api is None:
                client.api = fresh_login_rejected

        with (
            patch.object(client, "_discard_api_locked", AsyncMock(side_effect=discard)),
            patch.object(client, "_ensure_api_locked", AsyncMock(side_effect=ensure)),
        ):
            first = await client.get_live()
            second = await client.get_live()

        self.assertTrue(first["stale"])
        self.assertTrue(second["stale"])
        self.assertGreater(first["refresh_retry_seconds"], 5 * 60)
        self.assertEqual(rejected.calls, ["sites"])
        self.assertEqual(fresh_login_rejected.calls, ["sites"])

    async def test_login_request_error_without_token_uses_long_backoff(self):
        client = SolixClient()
        failing = LoginFailingApi()
        client.api = failing

        with patch.object(client, "_discard_api_locked", AsyncMock()) as discard:
            first = await client.get_live()
            second = await client.get_live()

        self.assertTrue(first["stale"])
        self.assertTrue(second["stale"])
        self.assertGreater(first["refresh_retry_seconds"], 5 * 60)
        self.assertEqual(failing.calls, ["sites"])
        discard.assert_awaited_once()

    async def test_configured_model_selects_solarbank_4(self):
        devices = {
            "SMALL-SECRET": {
                "type": "solarbank",
                "device_pn": "A17C5",
                "battery_soc": "92",
                "battery_capacity": "2688",
                "battery_energy": "2473",
                "bat_charge_power": "310",
                "bat_discharge_power": "0",
                "output_power": "150",
                "solar_power_1": "220",
                "solar_power_2": "240",
                "sub_package_num": 0,
            },
            "MAIN-SECRET": {
                "type": "solarbank",
                "device_pn": "AE103",
                "battery_soc": "18",
                "battery_energy": "2712",
                "battery_capacity": "15072",
                "bat_charge_power": "0",
                "bat_discharge_power": "740",
                "output_power": "920",
                "charging_status_desc": "bypass_discharge",
                "sub_package_num": 2,
            },
        }
        with patch.dict(
            os.environ,
            {
                "SOLIX_SOLARBANK_PN": "AE103",
                "SOLIX_BATTERY_CAPACITY_WH": "10400",
            },
        ):
            client = self.make_client(devices)
        client._last_refresh_at = datetime.now(timezone.utc)

        result = await client.get_live()

        self.assertEqual(result["solarbank_model"], "AE103")
        self.assertEqual(result["battery_percent"], 18)
        self.assertEqual(result["battery_energy_wh"], 1872)
        self.assertEqual(result["battery_capacity_wh"], 10400)
        self.assertEqual(result["battery_capacity_source"], "configured")
        self.assertEqual(result["battery_power"], -740)
        self.assertEqual(result["battery_discharge_power"], 740)
        self.assertEqual(result["battery_charge_power"], 0)
        self.assertEqual(result["battery_flow_direction"], "discharging")
        self.assertEqual(result["system_output_power"], 920)
        self.assertEqual(result["charging_status"], "bypass_discharge")
        self.assertEqual(result["solarbank_count"], 2)
        self.assertEqual(result["selection"], "configured_model")
        self.assertEqual(
            result["secondary_solarbank"],
            {
                "available": True,
                "status": None,
                "model": "A17C5",
                "battery_percent": 92,
                "battery_energy_wh": 2473,
                "battery_capacity_wh": 2688,
                "battery_power": 310,
                "battery_charge_power": 310,
                "battery_discharge_power": 0,
                "battery_flow_direction": "charging",
                "system_output_power": 150,
                "charging_status": None,
                "pv_total": 460,
                "pv1": 220,
                "pv2": 240,
                "firmware": None,
                "wifi_signal": 0,
                "last_update": result["last_update"],
            },
        )
        self.assertNotIn("MAIN-SECRET", str(result))
        self.assertNotIn("SMALL-SECRET", str(result))

    async def test_multiple_banks_fallback_to_largest_system(self):
        devices = {
            "SMALL-SECRET": {
                "type": "solarbank",
                "device_pn": "A17C5",
                "battery_soc": "92",
                "battery_capacity": "2688",
                "sub_package_num": 0,
            },
            "MAIN-SECRET": {
                "type": "solarbank",
                "device_pn": "AE103",
                "battery_soc": "18",
                "battery_capacity": "15072",
                "sub_package_num": 2,
            },
        }
        with patch.dict(
            os.environ,
            {"SOLIX_SOLARBANK_PN": "", "SOLIX_SOLARBANK_SN": ""},
        ):
            client = self.make_client(devices)
        client._last_refresh_at = datetime.now(timezone.utc)

        result = await client.get_live()

        self.assertEqual(result["solarbank_model"], "AE103")
        self.assertEqual(result["selection"], "auto_largest_system")

    def test_pv_telemetry_builds_conservative_daily_curve(self):
        client = SolixClient()
        start = datetime(2026, 8, 6, 8, 0, tzinfo=timezone.utc)

        first_energy, first_curve, first_strings = client._record_pv_telemetry(
            300, start, [75, 75, 75, 75]
        )
        second_energy, second_curve, second_strings = client._record_pv_telemetry(
            600, start + timedelta(minutes=10), [150, 150, 150, 150]
        )
        after_gap_energy, third_curve, third_strings = client._record_pv_telemetry(
            900, start + timedelta(minutes=30), [225, 225, 225, 225]
        )

        self.assertEqual(first_energy, 0)
        self.assertEqual(second_energy, 75)
        self.assertEqual(after_gap_energy, 75)
        self.assertEqual(len(first_curve), 1)
        self.assertEqual(len(second_curve), 2)
        self.assertEqual(len(third_curve), 3)
        self.assertEqual(third_curve[-1]["watts"], 900)
        self.assertEqual(first_strings, [0, 0, 0, 0])
        self.assertEqual(second_strings, [19, 19, 19, 19])
        self.assertEqual(third_strings, [19, 19, 19, 19])


if __name__ == "__main__":
    unittest.main()

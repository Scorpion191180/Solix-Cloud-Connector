import os
import aiohttp

from anker_solix_api.api import AnkerSolixApi


class SolixClient:
    def __init__(self):
        self.api = None

    async def connect(self):
        session = aiohttp.ClientSession()

        self.api = AnkerSolixApi(
            email=os.getenv("ANKER_EMAIL"),
            password=os.getenv("ANKER_PASSWORD"),
            countryId=os.getenv("ANKER_COUNTRY"),
            websession=session,
        )

        # Daten aus der Cloud laden
        await self.api.update_sites()
        await self.api.update_site_details()
        await self.api.update_device_details()
        await self.api.update_device_energy()

        return self.api

    async def get_status(self):
        if self.api is None:
            await self.connect()

        return {
            "sites": self.api.sites,
            "devices": self.api.devices,
        }

    async def get_site(self):
        if self.api is None:
            await self.connect()

        return self.api.sites

    async def get_devices(self):
        if self.api is None:
            await self.connect()

        return self.api.devices

    async def get_live(self):
    if self.api is None:
        await self.connect()

    # Erste Solarbank suchen
    solarbank = None
    for device in self.api.devices.values():
        if device.get("type") == "solarbank":
            solarbank = device
            break

    if solarbank is None:
        return {"error": "Keine Solarbank gefunden"}

    def to_int(value):
        try:
            return int(value)
        except (TypeError, ValueError):
            return 0

    return {
        "status": solarbank.get("status_desc"),

        "battery_percent": to_int(solarbank.get("battery_soc")),
        "battery_energy_wh": to_int(solarbank.get("battery_energy")),

        # Vorläufig fest auf deine Anlage angepasst
        "battery_capacity_wh": 10400,

        "battery_power": to_int(solarbank.get("bat_charge_power")),

        "pv_total": (
            to_int(solarbank.get("solar_power_1"))
            + to_int(solarbank.get("solar_power_2"))
            + to_int(solarbank.get("solar_power_3"))
            + to_int(solarbank.get("solar_power_4"))
        ),

        "pv1": to_int(solarbank.get("solar_power_1")),
        "pv2": to_int(solarbank.get("solar_power_2")),
        "pv3": to_int(solarbank.get("solar_power_3")),
        "pv4": to_int(solarbank.get("solar_power_4")),

        "home_load": to_int(solarbank.get("to_home_load")),
        "grid_power": to_int(solarbank.get("grid_to_battery_power")),

        "firmware": solarbank.get("sw_version"),
        "wifi_signal": to_int(solarbank.get("wifi_signal")),
    }

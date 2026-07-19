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

import os

from anker_solix_api.api import AnkerSolixApi
from aiohttp import ClientSession


class SolixClient:

    def __init__(self):
        self.api = None

    async def connect(self):
        session = ClientSession()

        self.api = AnkerSolixApi(
            session=session,
            email=os.getenv("ANKER_EMAIL"),
            password=os.getenv("ANKER_PASSWORD"),
            country=os.getenv("ANKER_COUNTRY", "DE"),
        )

    async def get_status(self):
        return {
            "connected": self.api is not None
        }

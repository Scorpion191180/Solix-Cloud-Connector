from datetime import datetime
from .models import SystemStatus


class SolixClient:

    def __init__(self):
        self.connected = False

    async def connect(self):
        # Hier kommt später der Login zur Anker Cloud
        self.connected = True

    async def get_status(self):

        return SystemStatus(
            online=self.connected,
            timestamp=datetime.utcnow(),

            battery=0,
            pv=0,
            load=0,
            grid=0,
            today=0,

            system="Solarbank 4 Pro",
            expansion_batteries=2
        )

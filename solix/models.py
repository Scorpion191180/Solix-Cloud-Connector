from pydantic import BaseModel
from datetime import datetime


class SystemStatus(BaseModel):
    online: bool
    timestamp: datetime

    battery: int
    pv: int
    load: int
    grid: int
    today: float

    system: str
    expansion_batteries: int

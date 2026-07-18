from solix.client import SolixClient
import asyncio

from fastapi import FastAPI
from datetime import datetime

app = FastAPI(
    title="Solix Cloud Connector",
    version="1.1.0"
)

client = SolixClient()

@app.on_event("startup")
async def startup():
    await client.connect()

# Demo-Daten
system_data = {
    "online": True,
    "battery": 0,
    "pv": 0,
    "load": 0,
    "grid": 0,
    "today": 0,
    "system": "Solarbank 4 Pro",
    "expansion_batteries": 2
}


@app.get("/")
def root():
    return {
        "name": "Solix Cloud Connector",
        "version": "1.1.0",
        "status": "running"
    }


@app.get("/health")
def health():
    return {
        "status": "ok",
        "timestamp": datetime.utcnow().isoformat()
    }


@app.get("/api/status")
def status():
    return {
        **system_data,
        "timestamp": datetime.utcnow().isoformat()
    }


@app.get("/api/info")
def info():
    return {
        "system": "Anker Solarbank 4 Pro",
        "battery_modules": 2,
        "capacity_kwh": 10.376,
        "reserve_percent": 5,
        "refresh_seconds": 30
    }


@app.post("/api/refresh")
def refresh():
    return {
        "success": True,
        "message": "Refresh requested",
        "timestamp": datetime.utcnow().isoformat()
    }
    

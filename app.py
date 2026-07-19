from fastapi import FastAPI
from solix.client import SolixClient

app = FastAPI()

client = SolixClient()


@app.get("/")
async def root():
    return {"status": "online"}


@app.get("/api/status")
async def status():
    return await client.get_status()

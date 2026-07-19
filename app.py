from fastapi import FastAPI
from solix.client import SolixClient

app = FastAPI()

client = SolixClient()


@app.get("/")
async def root():
    return {"status": "online"}


@app.get("/api/status")
async def status():
    data = await client.get_status()

    return {
        "site_count": len(data["sites"]),
        "device_count": len(data["devices"]),
        "sites": list(data["sites"].keys()),
        "devices": list(data["devices"].keys()),
    }
@app.get("/api/site")
async def site():
    return await client.get_site()


@app.get("/api/device")
async def device():
    return await client.get_devices()

@app.get("/api/live")
async def live():
    try:
        return await client.get_live()
    except Exception as e:
        import traceback

        return {
            "error": str(e),
            "traceback": traceback.format_exc()
        }
